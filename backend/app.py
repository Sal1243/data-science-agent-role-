from __future__ import annotations

import asyncio
import contextlib
import json
import re
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .analysis import MAX_BYTES, AnalysisError, make_charts, parse_csv
from .modeling import train_baseline
from .reports import markdown_report
from .store import store


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async def cleanup():
        while True:
            await asyncio.sleep(60)
            store.expire()

    task = asyncio.create_task(cleanup())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="Fieldnote API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
    lifespan=lifespan,
)
model_lock = threading.Semaphore(1)


class BodySizeLimit:
    """Bound multipart bodies, including chunked uploads, before they can fill temporary storage."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        size = 0
        limit = MAX_BYTES + 64 * 1024  # multipart framing allowance
        headers = dict(scope.get("headers", []))
        try:
            declared = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await JSONResponse({"detail": "Invalid content length."}, status_code=400)(
                scope, receive, send
            )
        if declared > limit:
            return await JSONResponse(
                {"detail": "Upload exceeds the 15 MB file limit."}, status_code=413
            )(scope, receive, send)

        async def bounded_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > limit:
                raise HTTPException(413, "Upload exceeds the 15 MB file limit.")
            return message

        return await self.app(scope, bounded_receive, send)


app.add_middleware(BodySizeLimit)


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(AnalysisError)
async def analysis_error(_request: Request, exc: AnalysisError):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.get("/api/health")
def health():
    return {"status": "ok", "engine": "local", "version": "1.0.0"}


@app.get("/api/demo")
def demo():
    return store.demo()


@app.get("/api/datasets")
def list_datasets():
    return store.list()


@app.post("/api/datasets", status_code=201)
async def upload_dataset(file: Annotated[UploadFile, File()]):
    try:
        content = await file.read(MAX_BYTES + 1)
        filename = re.split(r"[/\\]", file.filename or "dataset.csv")[-1][:120]
        frame, notes = await run_in_threadpool(parse_csv, content, filename)
        return await run_in_threadpool(store.add, frame, filename, notes)
    finally:
        await file.close()


@app.get("/api/datasets/{key}")
def get_dataset(key: str):
    return store.get(key).profile


@app.delete("/api/datasets/{key}", status_code=204)
def delete_dataset(key: str):
    store.delete(key)
    return Response(status_code=204)


@app.get("/api/datasets/{key}/rows")
def rows(
    key: str,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    search: Annotated[str, Query(max_length=200)] = "",
    sort: str | None = None,
    direction: Literal["asc", "desc"] = "asc",
):
    frame = store.get(key).frame
    if search:
        mask = (
            frame.astype(str)
            .apply(lambda column: column.str.contains(search, regex=False, case=False))
            .any(axis=1)
        )
        frame = frame.loc[mask]
    if sort:
        if sort not in frame.columns:
            raise HTTPException(422, "Sort column not found.")
        frame = frame.sort_values(
            sort, ascending=direction == "asc", na_position="last", kind="stable"
        )
    page = frame.iloc[offset : offset + limit].copy()
    # JSON numbers cannot preserve all 64-bit integers in a JavaScript client.
    for column in page.columns:
        if pd.api.types.is_integer_dtype(page[column]):
            page[column] = page[column].map(
                lambda value: str(value) if abs(int(value)) > 2**53 - 1 else int(value)
            )
    return {
        "total": len(frame),
        "offset": offset,
        "limit": limit,
        "rows": json.loads(page.to_json(orient="records", date_format="iso")),
    }


@app.get("/api/datasets/{key}/charts")
def charts(
    key: str,
    metric: str | None = None,
    aggregation: Literal["sum", "mean"] = "sum",
    category: str | None = None,
):
    dataset = store.get(key)
    return make_charts(dataset.frame, dataset.profile["columns"], metric, aggregation, category)


class ModelRequest(BaseModel):
    target: str = Field(min_length=1, max_length=100)
    task: Literal["auto", "regression", "classification"] = "auto"
    split: Literal["random", "time"] = "random"
    features: list[str] | None = Field(default=None, max_length=30)


@app.post("/api/datasets/{key}/model")
def model(key: str, settings: ModelRequest):
    dataset = store.get(key)
    if not model_lock.acquire(blocking=False):
        raise HTTPException(
            409, "Another experiment is running. Wait for it to finish and try again."
        )
    try:
        result = train_baseline(dataset.frame, dataset.profile["columns"], **settings.model_dump())
        dataset.model = result
        return result
    except (ValueError, TypeError) as exc:
        if isinstance(exc, AnalysisError):
            raise
        raise AnalysisError(
            "This experiment could not fit the data. Check the target and feature types, or try another split."
        ) from exc
    finally:
        model_lock.release()


@app.get("/api/datasets/{key}/model")
def latest_model(key: str):
    return store.get(key).model


@app.get("/api/datasets/{key}/report")
def report(key: str, format: Literal["markdown", "json"] = "markdown"):
    dataset = store.get(key)
    slug = (
        re.sub(r"[^a-zA-Z0-9_-]+", "-", dataset.profile["name"].removesuffix(".csv")).strip("-")[
            :80
        ]
        or "dataset"
    )
    if format == "json":
        return JSONResponse(
            {"analysis": dataset.profile, "model": dataset.model},
            headers={
                "Content-Disposition": f'attachment; filename="{slug}-report.json"',
            },
        )
    return Response(
        markdown_report(dataset.profile, dataset.model),
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{slug}-report.md"',
        },
    )


@app.get("/api/{path:path}", include_in_schema=False)
def missing_api(path: str):
    raise HTTPException(404, "API endpoint not found.")


# A built SPA can be served by this same process (one origin, no CORS required).
DIST = Path(__file__).resolve().parents[1] / "dist"
if (DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/favicon.svg", include_in_schema=False)
    def favicon():
        return FileResponse(DIST / "favicon.svg")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        asset = (DIST / path).resolve()
        if asset.is_relative_to(DIST.resolve()) and asset.is_file():
            return FileResponse(asset)
        return FileResponse(DIST / "index.html")
