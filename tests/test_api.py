import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

import backend.app as app_module
from backend.analysis import MAX_BYTES
from backend.store import DatasetStore


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, "store", DatasetStore())
    with TestClient(app_module.app) as test_client:
        yield test_client


def upload(client, content=b"name,value\nalpha,5\nbeta,2\nalphabet,8\n", name="sample.csv"):
    response = client.post("/api/datasets", files={"file": (name, content, "text/csv")})
    assert response.status_code == 201, response.text
    return response.json()


def test_health_demo_and_schema(client):
    assert client.get("/api/health").json()["engine"] == "local"
    response = client.get("/api/demo")
    assert response.status_code == 200
    assert response.json()["is_demo"] is True
    assert response.json()["id"] == "demo"
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/api/datasets").json()[0]["id"] == "demo"
    assert response.headers["cache-control"] == "no-store"


def test_upload_list_filter_sort_pagination_and_delete(client):
    data = upload(client)
    key = data["id"]
    assert client.get(f"/api/datasets/{key}").json()["name"] == "sample.csv"
    rows = client.get(
        f"/api/datasets/{key}/rows",
        params={"search": "ALPHA", "sort": "value", "direction": "desc", "limit": 1},
    ).json()
    assert rows["total"] == 2
    assert rows["rows"][0] == {"name": "alphabet", "value": 8}
    second = client.get(f"/api/datasets/{key}/rows", params={"offset": 1, "limit": 1}).json()
    assert second["rows"][0]["name"] == "beta"
    assert len(client.get("/api/datasets").json()) == 1
    assert client.delete(f"/api/datasets/{key}").status_code == 204
    assert client.get(f"/api/datasets/{key}").status_code == 404
    assert client.get("/api/datasets").json() == []


def test_search_is_literal_not_regex(client):
    data = upload(client, b"name,value\na.b,5\naab,4\n", "literal.csv")
    rows = client.get(f"/api/datasets/{data['id']}/rows", params={"search": "."}).json()
    assert rows["total"] == 1


def test_filename_is_never_used_as_a_path(client):
    data = upload(client, name="../../orders.csv")
    assert data["name"] == "orders.csv"
    assert "/" not in data["id"]


def test_invalid_upload_and_request_limits(client):
    assert client.post("/api/datasets", files={"file": ("bad.csv", b"x,x\n1,2")}).status_code == 422
    assert client.post("/api/datasets").status_code == 422
    response = client.post(
        "/api/datasets", content=b"ignored", headers={"content-length": str(MAX_BYTES * 2)}
    )
    assert response.status_code == 413


def test_chunked_body_limit(client):
    def chunks():
        for _ in range(17):
            yield b"x" * 1024 * 1024

    response = client.post(
        "/api/datasets",
        content=chunks(),
        headers={"content-type": "multipart/form-data; boundary=x"},
    )
    assert response.status_code == 413


@pytest.mark.parametrize(
    "params", [{"offset": -1}, {"limit": 101}, {"direction": "bad"}, {"sort": "missing"}]
)
def test_invalid_row_parameters(client, params):
    key = upload(client)["id"]
    assert client.get(f"/api/datasets/{key}/rows", params=params).status_code == 422


def test_charts_reject_invalid_metric(client):
    key = upload(client)["id"]
    assert client.get(f"/api/datasets/{key}/charts?metric=name").status_code == 422
    assert client.get(f"/api/datasets/{key}/charts?aggregation=median").status_code == 422
    assert client.get(f"/api/datasets/{key}/charts?metric=value").json()["total"] == 15


def test_reports_are_downloadable_and_do_not_include_raw_rows(client):
    data = upload(client)
    root = f"/api/datasets/{data['id']}"
    markdown = client.get(root + "/report")
    assert "attachment;" in markdown.headers["content-disposition"]
    assert "text/markdown" in markdown.headers["content-type"]
    assert "# Fieldnote" in markdown.text
    report = client.get(root + "/report?format=json").json()
    assert report["analysis"]["id"] == data["id"]
    assert report["model"] is None
    assert "rows" not in report["analysis"]
    assert client.get(root + "/report?format=html").status_code == 422


def test_model_endpoint_and_report_capture(client):
    data = client.get("/api/demo").json()
    root = f"/api/datasets/{data['id']}"
    assert client.get(root + "/model").json() is None
    response = client.post(
        root + "/model",
        json={
            "target": "revenue",
            "features": ["units", "unit_price", "discount_pct"],
            "split": "time",
        },
    )
    assert response.status_code == 200, response.text
    model = response.json()
    assert model["metrics"]["mae"] < model["baseline_metrics"]["mae"]
    assert client.get(root + "/model").json() == model
    assert "Predictive baseline" in client.get(root + "/report").text
    structured = client.get(root + "/report?format=json").json()
    assert structured["model"]["target"] == "revenue"
    json.dumps(structured, allow_nan=False)


def test_model_validation_and_busy_guard(client):
    client.get("/api/demo")
    assert (
        client.post(
            "/api/datasets/demo/model", json={"target": "revenue", "task": "magic"}
        ).status_code
        == 422
    )
    assert client.post("/api/datasets/demo/model", json={"target": "missing"}).status_code == 422
    app_module.model_lock.acquire()
    try:
        assert (
            client.post("/api/datasets/demo/model", json={"target": "revenue"}).status_code == 409
        )
    finally:
        app_module.model_lock.release()


def test_not_found_and_demo_protection(client):
    assert client.get("/api/datasets/no-such-dataset").status_code == 404
    assert client.get("/api/not-real").status_code == 404
    assert client.delete("/api/datasets/demo").status_code == 400


def test_store_is_bounded_and_expires_uploads():
    store = DatasetStore(capacity=2, ttl=10)
    frame = pd.DataFrame({"x": [1, 2]})
    store.demo()
    first = store.add(frame, "first.csv")["id"]
    second = store.add(frame, "second.csv")["id"]
    third = store.add(frame, "third.csv")["id"]
    assert first not in {d["id"] for d in store.list()}
    assert second in {d["id"] for d in store.list()}
    store._items[third].touched_at -= 11
    assert third not in {d["id"] for d in store.list()}
    assert "demo" in {d["id"] for d in store.list()}


def test_unsafe_javascript_integers_are_returned_as_exact_strings(client):
    data = upload(client, b"value\n9223372036854775807\n9223372036854775808", "large.csv")
    rows = client.get(f"/api/datasets/{data['id']}/rows").json()["rows"]
    assert rows[0]["value"] == "9223372036854775807"
    assert rows[1]["value"] == "9223372036854775808"
