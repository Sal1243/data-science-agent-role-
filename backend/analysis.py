"""Deterministic, auditable dataset analysis. No generated claims or external AI calls."""

from __future__ import annotations

import csv
import io
import math
import re
import time
import warnings
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pandas as pd

MAX_BYTES = 15 * 1024 * 1024
MAX_ROWS = 50_000
MAX_COLUMNS = 60
ID_PATTERN = r"(^id$|_id$|^id_|identifier|^uuid$)"


class AnalysisError(ValueError):
    """A safe, actionable error that can be shown to the user."""


def finite(value: Any, digits: int | None = None) -> float | None:
    try:
        number = float(value)
        if not math.isfinite(number):
            return None
        return round(number, digits) if digits is not None else float(f"{number:.12g}")
    except (ValueError, TypeError, OverflowError):
        return None


def parse_csv(content: bytes, filename: str) -> tuple[pd.DataFrame, list[str]]:
    if not filename.lower().endswith(".csv"):
        raise AnalysisError("Please upload a .csv file saved with UTF-8 encoding.")
    if len(content) > MAX_BYTES:
        raise AnalysisError("This file exceeds the 15 MB limit. Try a smaller export or sample.")
    if not content.strip():
        raise AnalysisError("This file is empty. Include a header and at least one data row.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AnalysisError(
            "Could not read the encoding. Save the CSV as UTF-8 and try again."
        ) from exc
    if "\x00" in text:
        raise AnalysisError("This does not look like a text CSV file (it contains null bytes).")
    try:
        # Detect common separators without relying on a possibly malformed first data row.
        first_line = text.splitlines()[0]
        try:
            delimiter = csv.Sniffer().sniff(first_line, delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
        reader = csv.reader(io.StringIO(text), delimiter=delimiter, strict=True)
        headers = [h.strip() for h in next(reader)]
        if not headers or any(not h for h in headers):
            raise AnalysisError("Every column needs a non-empty header.")
        if len(headers) != len(set(headers)):
            raise AnalysisError("Column names must be unique. Rename duplicate headers and retry.")
        if len(headers) > MAX_COLUMNS:
            raise AnalysisError(f"Use at most {MAX_COLUMNS} columns per dataset.")
        if any(len(h) > 100 for h in headers):
            raise AnalysisError("Keep column names under 100 characters.")
        count = 0
        for line, row in enumerate(reader, start=2):
            if not row or all(not cell.strip() for cell in row):
                continue
            count += 1
            if len(row) != len(headers):
                raise AnalysisError(
                    f"Row {line:,} has {len(row)} fields, but the header has {len(headers)}. "
                    "Check separators and quoted values."
                )
            if count > MAX_ROWS:
                raise AnalysisError(f"Use at most {MAX_ROWS:,} rows. Try a representative sample.")
        frame = pd.read_csv(
            io.StringIO(text),
            sep=delimiter,
            header=0,
            names=headers,
            nrows=MAX_ROWS + 1,
            low_memory=False,
            dtype={name: "string" for name in headers if re.search(ID_PATTERN, name.lower())},
            # Preserve legitimate strings such as the region code "NA".
            keep_default_na=False,
            na_values=["", "null", "NULL", "NaN", "nan", "N/A"],
        )
    except (pd.errors.ParserError, pd.errors.EmptyDataError, csv.Error, StopIteration) as exc:
        raise AnalysisError(
            "Could not parse this CSV. Check the header, delimiters, and quotes."
        ) from exc
    if frame.empty:
        raise AnalysisError("This CSV has no data rows. Include at least one row below the header.")
    if len(frame) > MAX_ROWS:
        raise AnalysisError(f"Use at most {MAX_ROWS:,} rows. Try a representative sample.")
    notes: list[str] = []
    # Whitespace-only cells are missing; never execute expressions in cells.
    for column in frame.select_dtypes(include=["object", "string"]).columns:
        frame[column] = frame[column].replace(r"^\s*$", np.nan, regex=True)
    numeric = frame.select_dtypes(include=[np.number]).columns
    infinite_count = int(np.isinf(frame[numeric]).sum().sum()) if len(numeric) else 0
    if infinite_count:
        frame[numeric] = frame[numeric].replace([np.inf, -np.inf], np.nan)
        notes.append(f"{infinite_count:,} infinite numeric values were treated as missing.")
    if len(numeric) and (frame[numeric].abs() > 1e100).any().any():
        raise AnalysisError(
            "Numeric magnitudes above 1e100 are not supported. Rescale those values before uploading."
        )
    return frame, notes


def date_values(series: pd.Series) -> pd.Series:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        return pd.to_datetime(series, errors="coerce", format="mixed", utc=True)


def column_kind(name: str, series: pd.Series) -> str:
    nonnull = series.dropna()
    if nonnull.empty:
        return "empty"
    unique = nonnull.nunique()
    ratio = unique / len(nonnull)
    lowered = name.lower()
    if re.search(ID_PATTERN, lowered) and ratio > 0.9:
        return "identifier"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    sample = nonnull.head(300).astype(str)
    date_pattern = r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}"
    if sample.str.contains(date_pattern, regex=True).mean() >= 0.9:
        if date_values(sample).notna().mean() >= 0.9:
            return "date"
    if unique > 200 or (ratio > 0.8 and len(nonnull) > 40):
        return "text"
    return "categorical"


def profile_columns(frame: pd.DataFrame) -> list[dict]:
    columns = []
    for name in frame.columns:
        values = frame[name]
        kind = column_kind(name, values)
        missing = int(values.isna().sum())
        entry: dict = {
            "name": name,
            "kind": kind,
            "missing": missing,
            "missing_pct": round(missing / len(frame) * 100, 2),
            "unique": int(values.nunique()),
        }
        if kind == "numeric":
            entry["stats"] = {
                "min": finite(values.min()),
                "max": finite(values.max()),
                "mean": finite(values.mean()),
                "median": finite(values.median()),
                "std": finite(values.std()),
            }
            q1, q3 = values.quantile([0.25, 0.75])
            iqr = q3 - q1
            entry["outliers"] = (
                int(((values < q1 - 1.5 * iqr) | (values > q3 + 1.5 * iqr)).sum()) if iqr > 0 else 0
            )
        elif kind == "date":
            dates = date_values(values).dropna()
            entry["date_range"] = [dates.min().date().isoformat(), dates.max().date().isoformat()]
            entry["invalid_dates"] = int(values.notna().sum() - len(dates))
        elif kind in {"categorical", "boolean", "text"}:
            entry["top_values"] = [
                {"label": str(label)[:160], "count": int(count)}
                for label, count in values.value_counts().head(5).items()
            ]
        columns.append(entry)
    return columns


def default_metric(columns: list[dict]) -> str | None:
    numeric = [c["name"] for c in columns if c["kind"] == "numeric"]
    for word in ["revenue", "sales", "amount", "price", "profit", "income"]:
        match = next((n for n in numeric if word in n.lower()), None)
        if match:
            return match
    return numeric[0] if numeric else None


def make_charts(
    frame: pd.DataFrame,
    columns: list[dict],
    metric: str | None = None,
    aggregation: str = "sum",
    category: str | None = None,
) -> dict:
    if aggregation not in {"sum", "mean"}:
        raise AnalysisError("Aggregation must be sum or mean.")
    numeric = [c["name"] for c in columns if c["kind"] == "numeric"]
    if metric is not None and metric not in numeric:
        raise AnalysisError("Choose a numeric column for the chart.")
    metric = metric or default_metric(columns)
    dates = [c["name"] for c in columns if c["kind"] == "date"]
    categories = [c["name"] for c in columns if c["kind"] in {"categorical", "boolean"}]
    if category is not None and category not in categories:
        raise AnalysisError("Choose a categorical column for the breakdown.")
    category = (
        category
        or next((c for c in categories if "category" in c.lower()), None)
        or (categories[0] if categories else None)
    )
    trend: list[dict] = []
    chart_kind = "empty"
    period = None
    if dates and metric:
        date = date_values(frame[dates[0]])
        valid = pd.DataFrame({"date": date, "value": frame[metric]}).dropna()
        if not valid.empty:
            days = (valid["date"].max().to_pydatetime() - valid["date"].min().to_pydatetime()).days
            period = (
                "year"
                if days > 3650
                else ("month" if days > 90 else ("week" if days > 21 else "day"))
            )
            freq = {"year": "YS", "month": "MS", "week": "W-MON", "day": "D"}[period]
            indexed = valid.set_index("date")
            # Microsecond resolution prevents resample edges from overflowing the ns date range.
            indexed.index = indexed.index.as_unit("us")
            groups = indexed.resample(freq)["value"]
            totals = groups.sum(min_count=1) if aggregation == "sum" else groups.mean()
            counts = groups.count()
            trend = [
                {
                    "label": date.strftime(
                        "%Y" if period == "year" else ("%b %Y" if period == "month" else "%d %b %Y")
                    ),
                    "value": finite(value),
                    "count": int(counts.loc[date]),
                    "date": date.isoformat(),
                }
                for date, value in totals.items()
            ]
            chart_kind = "time"
    elif metric:
        values = frame[metric].dropna()
        if not values.empty:
            if float(values.min()) == float(values.max()):
                # np.histogram cannot expand a constant range at very large magnitudes.
                value = finite(values.iloc[0])
                bin_label = (
                    f"{value:,.4g}" if values.nunique() == 1 else f"{values.min()}–{values.max()}"
                )
                trend = [
                    {
                        "label": bin_label,
                        "value": len(values),
                        "count": len(values),
                        "start": value,
                        "end": value,
                    }
                ]
            else:
                try:
                    hist, edges = np.histogram(
                        values.to_numpy(dtype=float), bins=min(12, values.nunique())
                    )
                except ValueError:
                    # Nearly equal, large-magnitude floats may not support multiple finite-width bins.
                    hist, edges = np.histogram(values.to_numpy(dtype=float), bins=1)
                trend = [
                    {
                        "label": f"{left:,.4g}–{right:,.4g}",
                        "value": int(count),
                        "count": int(count),
                        "start": finite(left),
                        "end": finite(right),
                    }
                    for left, right, count in zip(edges[:-1], edges[1:], hist, strict=True)
                ]
            chart_kind = "histogram"
    breakdown: list[dict] = []
    if category:
        data = pd.DataFrame({"group": frame[category].fillna("(Missing)").astype(str)})
        if metric:
            data["value"] = frame[metric]
            groups = data.groupby("group", sort=False)["value"]
            totals = groups.sum(min_count=1) if aggregation == "sum" else groups.mean()
        else:
            totals = data.groupby("group", sort=False).size()
        totals = totals.dropna().sort_values(ascending=False)
        # No "Other" mean: averaging subgroup means would be mathematically wrong.
        top = totals.head(6)
        breakdown = [{"label": str(label), "value": finite(value)} for label, value in top.items()]
        if len(totals) > 6 and aggregation == "sum":
            breakdown.append({"label": "Other categories", "value": finite(totals.iloc[6:].sum())})
        if not metric:
            trend = breakdown
            chart_kind = "category"
    total = (
        finite(frame[metric].sum(min_count=1) if aggregation == "sum" else frame[metric].mean())
        if metric
        else len(frame)
    )
    change = None
    if (
        chart_kind == "time"
        and len(trend) >= 2
        and trend[-2]["value"]
        and trend[-1]["value"] is not None
    ):
        change = finite((trend[-1]["value"] / trend[-2]["value"] - 1) * 100, 1)
    return {
        "kind": chart_kind,
        "metric": metric,
        "aggregation": aggregation,
        "date_column": dates[0] if dates else None,
        "period": period,
        "trend": trend,
        "breakdown": breakdown,
        "category": category,
        "total": total,
        "change_pct": change,
        "valid_rows": int(frame[metric].notna().sum()) if metric else len(frame),
    }


def find_correlations(frame: pd.DataFrame, columns: list[dict]) -> list[dict]:
    numeric = [c["name"] for c in columns if c["kind"] == "numeric" and c["unique"] > 1]
    if len(numeric) < 2:
        return []
    corr = frame[numeric].corr(method="pearson", min_periods=10)
    pairs = []
    for i, first in enumerate(numeric):
        for second in numeric[i + 1 :]:
            value = finite(corr.loc[first, second])
            if value is not None:
                pairs.append(
                    {
                        "first": first,
                        "second": second,
                        "value": value,
                        "n": int(frame[[first, second]].dropna().shape[0]),
                    }
                )
    return sorted(pairs, key=lambda p: abs(p["value"]), reverse=True)[:15]


def analyze(
    frame: pd.DataFrame, name: str, notes: list[str] | None = None, demo: bool = False
) -> dict:
    started = time.perf_counter()
    columns = profile_columns(frame)
    profiled = time.perf_counter()
    charts = make_charts(frame, columns)
    correlations = find_correlations(frame, columns)
    rows, cols = frame.shape
    missing = int(frame.isna().sum().sum())
    duplicates = int(frame.duplicated().sum())
    completeness = (1 - missing / (rows * cols)) * 100
    uniqueness = (1 - duplicates / rows) * 100
    quality = round(0.8 * completeness + 0.2 * uniqueness, 1)
    insights: list[dict] = []

    def insight(
        kind: str, title: str, description: str, fields: list[str], importance: str = "info"
    ) -> None:
        insights.append(
            {
                "id": f"insight-{len(insights) + 1}",
                "kind": kind,
                "title": title,
                "description": description,
                "columns": fields,
                "importance": importance,
            }
        )

    if charts["kind"] == "time" and charts["change_pct"] is not None:
        change = charts["change_pct"]
        direction = "up" if change >= 0 else "down"
        insight(
            "trend",
            f"{charts['metric'].replace('_', ' ').capitalize()} is {direction} {abs(change):.1f}%",
            f"The latest {charts['period']}'s {charts['aggregation']} is {abs(change):.1f}% {direction} from the previous period. "
            "Period coverage can differ; this is a descriptive comparison, not a forecast.",
            [charts["date_column"], charts["metric"]],
        )
    if charts["breakdown"] and charts["metric"] and charts["aggregation"] == "sum":
        total = sum(p["value"] or 0 for p in charts["breakdown"])
        top = charts["breakdown"][0]
        if total > 0 and all((p["value"] or 0) >= 0 for p in charts["breakdown"]):
            share = top["value"] / total * 100
            insight(
                "distribution",
                f"{top['label']} leads the mix",
                f"{top['label']} accounts for {share:.1f}% of total {charts['metric']} "
                f"when grouped by {charts['category']}. Missing categories are included separately.",
                [charts["category"], charts["metric"]],
            )
    if missing:
        worst = max(columns, key=lambda c: c["missing"])
        insight(
            "quality",
            f"A few gaps in {worst['name'].replace('_', ' ')}",
            f"{worst['missing']:,} rows ({worst['missing_pct']:.1f}%) are missing {worst['name']}. "
            "Investigate why values are absent before choosing to impute or remove them.",
            [worst["name"]],
            "warning",
        )
    if duplicates:
        insight(
            "quality",
            f"{duplicates:,} duplicate rows to review",
            f"{duplicates:,} exact duplicate rows ({duplicates / rows * 100:.1f}%) were found. "
            "They may be valid repeated events; confirm the unit of observation before removing them.",
            [],
            "warning",
        )
    if correlations and abs(correlations[0]["value"]) >= 0.4:
        pair = correlations[0]
        insight(
            "relationship",
            f"{pair['first'].replace('_', ' ').capitalize()} and {pair['second'].replace('_', ' ')} are linked",
            f"Pearson r = {pair['value']:.2f} across {pair['n']:,} complete pairs. "
            "This is the strongest observed linear relationship, not evidence of causation.",
            [pair["first"], pair["second"]],
        )
    outlier_columns = [c for c in columns if c.get("outliers", 0) > 0]
    if outlier_columns:
        most = max(outlier_columns, key=lambda c: c["outliers"])
        insight(
            "distribution",
            f"Unusual values in {most['name'].replace('_', ' ')}",
            f"{most['outliers']:,} values fall outside 1.5 × IQR fences. "
            "These are statistical flags, not necessarily errors; skewed distributions often have them.",
            [most["name"]],
        )
    constants = [c["name"] for c in columns if c["unique"] <= 1]
    if constants:
        insight(
            "quality",
            f"{len(constants)} columns carry little variation",
            "Constant or entirely empty columns offer no predictive signal. Consider excluding them from models.",
            constants,
            "warning",
        )
    invalid_dates = sum(c.get("invalid_dates", 0) for c in columns)
    if invalid_dates:
        insight(
            "quality",
            "Some dates could not be parsed",
            f"{invalid_dates:,} non-empty date values could not be parsed and were excluded from time charts.",
            [c["name"] for c in columns if c.get("invalid_dates", 0)],
            "warning",
        )
    if not insights:
        insight(
            "quality",
            "A clean starting point",
            "No missing cells or exact duplicate rows were found. This does not verify accuracy, representativeness, or fairness.",
            [],
        )
    finished = time.perf_counter()
    overview = (
        f"{rows:,} rows. {cols} columns. A clearer starting point. "
        f"Your data is {completeness:.1f}% complete"
        + (
            f", with {duplicates:,} duplicate rows worth reviewing."
            if duplicates
            else ", with no exact duplicate rows."
        )
    )
    return {
        "name": name,
        "is_demo": demo,
        "created_at": datetime.now(UTC).isoformat(),
        "row_count": rows,
        "column_count": cols,
        "missing_cells": missing,
        "duplicate_rows": duplicates,
        "completeness": round(completeness, 2),
        "uniqueness": round(uniqueness, 2),
        "quality_score": quality,
        "numeric_count": sum(c["kind"] == "numeric" for c in columns),
        "categorical_count": sum(c["kind"] in {"categorical", "boolean"} for c in columns),
        "columns": columns,
        "charts": charts,
        "correlations": correlations,
        "insights": insights,
        "summary": overview,
        "notes": notes or [],
        "suggested_target": default_metric(columns),
        "steps": [
            {"name": "Profile every column", "duration_ms": round((profiled - started) * 1000)},
            {
                "name": "Find patterns & check quality",
                "duration_ms": round((finished - profiled) * 1000),
            },
            {"name": "Assemble evidence-backed report", "duration_ms": 0},
        ],
        "methodology": {
            "quality": "80% cell completeness + 20% exact-row uniqueness. Not a measure of accuracy or bias.",
            "relationships": "Pairwise Pearson correlation on complete pairs, at least 10 observations. Descriptive, unadjusted for multiple comparisons.",
            "outliers": "Values below Q1 − 1.5 × IQR or above Q3 + 1.5 × IQR. Zero-IQR columns are not flagged.",
            "privacy": "Processed in this server workspace. No external AI calls. Datasets expire after 2 hours without access, with cleanup within one minute. Upload parsing may use temporary files.",
            "parsing": "Empty and whitespace-only cells, null, NULL, NaN, nan, and N/A are missing. Infinite numeric values are also treated as missing. ID-named columns preserve leading zeros; other numeric types are inferred. Aggregate statistics use double precision (12 significant digits in reports), not arbitrary-precision arithmetic.",
        },
    }


def demo_frame() -> pd.DataFrame:
    """A reproducible, explicitly synthetic commerce dataset with realistic imperfections."""
    rng = np.random.default_rng(41)
    n = 2400
    # More orders later in the period; no live business data or fabricated real-world claims.
    days = np.arange(181)
    weights = np.linspace(0.75, 1.55, len(days))
    offsets = rng.choice(days, n, p=weights / weights.sum())
    category = rng.choice(
        ["Home & living", "Electronics", "Apparel", "Beauty", "Outdoors"],
        n,
        p=[0.30, 0.23, 0.22, 0.16, 0.09],
    )
    prices = {"Home & living": 78, "Electronics": 132, "Apparel": 49, "Beauty": 32, "Outdoors": 93}
    units = rng.choice([1, 2, 3, 4, 5], n, p=[0.40, 0.31, 0.18, 0.08, 0.03])
    price = np.array([prices[c] for c in category]) * rng.uniform(0.65, 1.4, n)
    discount = rng.choice([0, 5, 10, 15, 20], n, p=[0.48, 0.15, 0.19, 0.12, 0.06])
    revenue = np.round(units * price * (1 - discount / 100), 2)
    frame = pd.DataFrame(
        {
            "order_id": [f"FN-{i + 10001}" for i in range(n)],
            "order_date": (
                pd.Timestamp("2026-01-01") + pd.to_timedelta(offsets, unit="D")
            ).strftime("%Y-%m-%d"),
            "category": category,
            "channel": rng.choice(
                ["Online store", "Marketplace", "Retail"], n, p=[0.59, 0.26, 0.15]
            ),
            "region": rng.choice(["North", "South", "East", "West"], n, p=[0.24, 0.31, 0.20, 0.25]),
            "units": units,
            "unit_price": np.round(price, 2),
            "discount_pct": discount.astype(float),
            "revenue": revenue,
            "fulfillment_days": np.maximum(1, rng.poisson(3, n)).astype(float),
            "customer_type": rng.choice(["Returning", "New"], n, p=[0.62, 0.38]),
        }
    )
    frame.loc[rng.choice(n, 132, replace=False), "region"] = np.nan
    frame.loc[rng.choice(n, 84, replace=False), "discount_pct"] = np.nan
    frame.loc[rng.choice(n, 32, replace=False), "fulfillment_days"] = np.nan
    return pd.concat(
        [frame, frame.iloc[[12, 40, 61, 203, 421, 789, 932, 1003, 1200, 1458, 1710, 2131]]],
        ignore_index=True,
    )
