import json

import numpy as np
import pandas as pd
import pytest

from backend.analysis import (
    MAX_BYTES,
    AnalysisError,
    analyze,
    column_kind,
    demo_frame,
    make_charts,
    parse_csv,
    profile_columns,
)
from backend.reports import markdown_report


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (b"", "empty"),
        (b"a,b\n", "no data rows"),
        (b"a,a\n1,2\n", "unique"),
        (b"a, a \n1,2\n", "unique"),
        (b",b\n1,2\n", "non-empty header"),
        (b"a,b\n1,2,3\n", "fields"),
        (b"a,b\n1\n", "fields"),
        (b'a,b\n"hello,2\n', "parse"),
        (b"a\n\xff\n", "UTF-8"),
        (b"a\n\x00\n", "null bytes"),
    ],
)
def test_invalid_csv_is_actionable(content, message):
    with pytest.raises(AnalysisError, match=message):
        parse_csv(content, "test.csv")


def test_encoding_delimiters_and_preserving_legitimate_na():
    frame, _ = parse_csv(
        "\ufeffcity;region;count\nChennai;NA;3\nMadurai;South;4\n".encode(), "places.CSV"
    )
    assert list(frame.columns) == ["city", "region", "count"]
    assert frame.loc[0, "region"] == "NA"
    assert frame["count"].sum() == 7


def test_quoted_values_and_normalized_missingness():
    frame, _ = parse_csv(b'name,comment,x\n"A, B","line one\nline two",1\nZ,   ,NaN\n', "ok.csv")
    assert frame.loc[0, "name"] == "A, B"
    assert frame.loc[0, "comment"] == "line one\nline two"
    assert frame.iloc[1].isna().sum() == 2


def test_infinite_values_are_explicitly_reported():
    frame, notes = parse_csv(b"number\n1\ninf\n-inf\n2\n", "values.csv")
    assert frame["number"].isna().sum() == 2
    assert "2 infinite" in notes[0]
    json.dumps(analyze(frame, "values"), allow_nan=False)


def test_file_and_shape_limits(monkeypatch):
    with pytest.raises(AnalysisError, match="15 MB"):
        parse_csv(b"x" * (MAX_BYTES + 1), "large.csv")
    with pytest.raises(AnalysisError, match=".csv"):
        parse_csv(b"a\n1", "example.xlsx")
    monkeypatch.setattr("backend.analysis.MAX_ROWS", 2)
    with pytest.raises(AnalysisError, match="at most 2 rows"):
        parse_csv(b"a\n1\n2\n3", "data.csv")
    monkeypatch.setattr("backend.analysis.MAX_COLUMNS", 2)
    with pytest.raises(AnalysisError, match="2 columns"):
        parse_csv(b"a,b,c\n1,2,3", "data.csv")


@pytest.mark.parametrize(
    ("name", "values", "expected"),
    [
        ("amount", [1.1, 2.5, 3.6], "numeric"),
        ("id", ["x1", "x2", "x3"], "identifier"),
        ("order_id", [100, 101, 102], "identifier"),
        ("date", ["2026-01-01", "2026-02-02"], "date"),
        ("empty", [np.nan, np.nan], "empty"),
        ("kind", ["A", "A", "B"], "categorical"),
        ("flag", [True, False, True], "boolean"),
    ],
)
def test_inferred_types(name, values, expected):
    assert column_kind(name, pd.Series(values)) == expected


def test_quality_formula_and_no_silent_row_deletion():
    frame = pd.DataFrame({"a": [1, 1, 3, np.nan], "b": ["x", "x", None, "y"]})
    original = frame.copy(deep=True)
    p = analyze(frame, "test")
    assert p["row_count"] == 4
    assert p["missing_cells"] == 2
    assert p["duplicate_rows"] == 1
    assert p["completeness"] == 75
    assert p["quality_score"] == 75
    pd.testing.assert_frame_equal(frame, original)


def test_profile_serializes_empty_constant_and_mixed_columns():
    frame = pd.DataFrame({"empty": [np.nan] * 12, "constant": [7] * 12, "tag": ["<script>"] * 12})
    p = analyze(frame, "constant.csv")
    json.dumps(p, allow_nan=False)
    assert p["correlations"] == []
    assert any(i["kind"] == "quality" for i in p["insights"])
    assert p["columns"][1]["outliers"] == 0


def test_time_chart_aggregation_and_missing_periods():
    frame = pd.DataFrame(
        {"date": ["2026-01-01", "2026-01-15", "2026-05-02"], "revenue": [10, 30, 100]}
    )
    cols = profile_columns(frame)
    chart = make_charts(frame, cols, "revenue")
    assert [p["value"] for p in chart["trend"]] == [40, None, None, None, 100]
    assert [p["count"] for p in chart["trend"]] == [2, 0, 0, 0, 1]
    assert chart["change_pct"] is None  # No fabricated comparison across missing months.
    means = make_charts(frame, cols, "revenue", "mean")
    assert [p["value"] for p in means["trend"]] == [20, None, None, None, 100]
    assert means["total"] == pytest.approx(46.6667)


def test_no_dates_uses_histogram():
    frame = pd.DataFrame({"x": np.arange(100)})
    chart = make_charts(frame, profile_columns(frame))
    assert chart["kind"] == "histogram"
    assert sum(p["count"] for p in chart["trend"]) == 100


def test_category_aggregation_preserves_total_and_never_averages_means():
    frame = pd.DataFrame({"category": list("abcdefghijk"), "amount": np.arange(1, 12)})
    cols = profile_columns(frame)
    chart = make_charts(frame, cols)
    assert sum(p["value"] for p in chart["breakdown"]) == 66
    assert chart["breakdown"][-1]["label"] == "Other categories"
    means = make_charts(frame, cols, aggregation="mean")
    assert len(means["breakdown"]) == 6
    assert all(p["label"] != "Other categories" for p in means["breakdown"])


def test_categorical_only_dataset_still_has_a_chart():
    frame = pd.DataFrame({"color": ["blue", "green", "blue", None]})
    p = analyze(frame, "colors.csv")
    assert p["charts"]["kind"] == "category"
    assert sum(point["value"] for point in p["charts"]["trend"]) == 4


def test_correlations_report_pair_counts_and_exclude_identifiers():
    frame = pd.DataFrame(
        {
            "row_id": np.arange(30),
            "a": np.arange(30),
            "b": np.arange(30, dtype=float) * -2,
            "constant": 9,
        }
    )
    frame.loc[0, "b"] = np.nan
    p = analyze(frame, "pairs.csv")
    assert len(p["correlations"]) == 1
    assert p["correlations"][0] == {"first": "a", "second": "b", "value": -1.0, "n": 29}
    assert "not evidence of causation" in next(
        i["description"] for i in p["insights"] if i["kind"] == "relationship"
    )


def test_invalid_dates_are_disclosed():
    dates = ["2026-01-01"] * 19 + ["2026-30-30"]
    p = analyze(pd.DataFrame({"date": dates, "amount": np.arange(20)}), "dates.csv")
    assert p["columns"][0]["kind"] == "date"
    assert p["columns"][0]["invalid_dates"] == 1
    assert any(i["title"] == "Some dates could not be parsed" for i in p["insights"])


def test_report_escapes_user_controlled_markdown():
    p = analyze(pd.DataFrame({"evil|column": [1, 2]}), "<script>alert(1)</script>.csv")
    report = markdown_report(p)
    assert "<script>" not in report
    assert "evil\\|column" in report
    assert "Methods & limitations" in report


def test_demo_is_reproducible_and_explicitly_synthetic():
    first, second = demo_frame(), demo_frame()
    pd.testing.assert_frame_equal(first, second)
    profile = analyze(first, "demo", demo=True)
    assert profile["row_count"] == 2412
    assert profile["duplicate_rows"] == 12
    assert profile["is_demo"] is True
    assert len(profile["insights"]) >= 5


def test_large_constant_histogram_does_not_overflow():
    frame = pd.DataFrame({"amount": [1e20] * 15})
    profile = analyze(frame, "large-constant")
    assert profile["charts"]["trend"][0]["value"] == 15
    json.dumps(profile, allow_nan=False)


def test_centuries_of_dates_use_bounded_yearly_chart():
    frame = pd.DataFrame({"date": ["1700-01-01", "2200-01-01"], "amount": [1, 4]})
    profile = analyze(frame, "long-time")
    assert profile["charts"]["period"] == "year"
    assert len(profile["charts"]["trend"]) == 501
    assert profile["charts"]["change_pct"] is None


def test_extreme_magnitudes_rejected_before_numeric_overflow():
    with pytest.raises(AnalysisError, match="Rescale"):
        parse_csv(b"value\n-1e308\n1e308", "huge.csv")


def test_identifier_leading_zeros_preserved():
    frame, _ = parse_csv(b"order_id,value\n001,3\n002,4\n003,5\n", "ids.csv")
    assert frame["order_id"].tolist() == ["001", "002", "003"]
    assert analyze(frame, "ids")["columns"][0]["kind"] == "identifier"


def test_small_nonzero_statistics_are_not_rounded_to_zero():
    frame, _ = parse_csv(b"value\n1e-16\n2e-16\n", "small.csv")
    profile = analyze(frame, "small")
    assert profile["columns"][0]["stats"]["min"] == 1e-16
    assert profile["charts"]["total"] == 3e-16


def test_nearby_large_integers_still_have_a_valid_histogram():
    frame, _ = parse_csv(b"value\n9223372036854775807\n9223372036854775808", "large.csv")
    chart = analyze(frame, "large")["charts"]
    assert chart["trend"][0]["count"] == 2


def test_date_resampling_at_nanosecond_boundary():
    frame, _ = parse_csv(b"date,x\n2262-04-10,1\n2262-04-11,2", "boundary.csv")
    chart = analyze(frame, "boundary")["charts"]
    assert [point["value"] for point in chart["trend"]] == [1, 2]
