import json

import numpy as np
import pandas as pd
import pytest
from sklearn.impute import SimpleImputer

from backend.analysis import AnalysisError, profile_columns
from backend.modeling import train_baseline


@pytest.fixture
def training_frame():
    rng = np.random.default_rng(12)
    n = 140
    x = rng.normal(20, 5, n)
    return pd.DataFrame(
        {
            "record_id": np.arange(n),
            "day": (
                pd.Timestamp("2026-01-01") + pd.to_timedelta(np.arange(n) // 2, unit="D")
            ).strftime("%Y-%m-%d"),
            "x": x,
            "category": rng.choice(["a", "b", "c"], n),
            "amount": 3 * x + rng.normal(0, 1, n),
            "class": np.where(x >= 20, "high", "low"),
        }
    )


def run(frame, target="amount", **settings):
    return train_baseline(frame, profile_columns(frame), target, **settings)


def test_regression_beats_naive_baseline_and_excludes_ids(training_frame):
    result = run(training_frame, features=None)
    assert result["task"] == "regression"
    assert result["metrics"]["mae"] < result["baseline_metrics"]["mae"]
    assert result["metrics"]["r2"] > 0.8
    assert "record_id" not in result["features"]
    assert "day" not in result["features"]
    assert "amount" not in result["features"]
    assert result["train_rows"] + result["test_rows"] == len(training_frame)
    json.dumps(result, allow_nan=False)


def test_classification_metrics_and_confusion_counts(training_frame):
    result = run(training_frame, target="class", features=["x", "category"], task="classification")
    assert result["metrics"]["accuracy"] > result["baseline_metrics"]["accuracy"]
    assert sum(sum(row) for row in result["confusion"]["matrix"]) == result["test_rows"]
    assert result["importance_unit"] == "accuracy"


def test_time_split_keeps_equal_dates_together(training_frame):
    result = run(training_frame, split="time")
    assert result["train_rows"] == 112
    assert result["test_rows"] == 28
    assert result["split"] == "time"
    assert any("Equal timestamps stay together" in n for n in result["notes"])


def test_preprocessing_is_fit_only_on_training_rows(training_frame, monkeypatch):
    seen = []
    original = SimpleImputer.fit

    def spy(self, x, y=None, **kwargs):
        seen.append(len(x))
        return original(self, x, y, **kwargs)

    monkeypatch.setattr(SimpleImputer, "fit", spy)
    result = run(training_frame, features=["x", "category"])
    assert seen and all(count == result["train_rows"] for count in seen)


def test_results_are_reproducible(training_frame):
    first = run(training_frame, features=["x", "category"])
    second = run(training_frame, features=["x", "category"])
    assert first["metrics"] == second["metrics"]
    assert first["feature_importance"] == second["feature_importance"]


def test_missing_targets_and_duplicates_removed_before_split(training_frame):
    frame = pd.concat([training_frame, training_frame.iloc[:15]], ignore_index=True)
    frame.loc[0, "amount"] = np.nan
    result = run(frame)
    assert result["train_rows"] + result["test_rows"] == 140
    assert any("exact duplicates" in note for note in result["notes"])
    assert any("without a target" in note for note in result["notes"])


@pytest.mark.parametrize(
    ("settings", "message"),
    [
        ({"target": "missing"}, "not found"),
        ({"target": "record_id"}, "identifier"),
        ({"target": "class", "task": "regression"}, "numeric target"),
        ({"features": ["amount", "x"]}, "cannot include"),
        ({"features": ["missing"]}, "must exist"),
        ({"features": ["x", "x"]}, "distinct features"),
        ({"features": []}, "No usable features"),
        ({"features": ["day", "record_id"]}, "No usable features"),
    ],
)
def test_invalid_experiments_fail_helpfully(training_frame, settings, message):
    with pytest.raises(AnalysisError, match=message):
        run(training_frame, **settings)


def test_too_little_data(training_frame):
    with pytest.raises(AnalysisError, match="60 usable"):
        run(training_frame.iloc[:40])


def test_constant_target(training_frame):
    frame = training_frame.assign(amount=2)
    with pytest.raises(AnalysisError, match="constant"):
        run(frame)


def test_rare_class_is_rejected(training_frame):
    frame = training_frame.copy()
    frame.loc[0, "class"] = "rare"
    with pytest.raises(AnalysisError, match="at least 5"):
        run(frame, target="class")


def test_chronological_split_requires_dates(training_frame):
    with pytest.raises(AnalysisError, match="requires a detected date"):
        run(training_frame.drop(columns=["day"]), split="time")


def test_direct_target_copy_is_excluded(training_frame):
    frame = training_frame.assign(copy=training_frame["amount"])
    result = run(frame, features=["copy", "x"])
    assert "copy" not in result["features"]
    assert any(
        item["name"] == "copy" and "leakage" in item["reason"] for item in result["excluded"]
    )


def test_no_time_leakage_when_only_one_timestamp(training_frame):
    frame = training_frame.assign(day="2026-01-01")
    with pytest.raises(AnalysisError, match="distinct time periods"):
        run(frame, split="time")


def test_undefined_holdout_r2_is_not_a_fabricated_score(training_frame):
    frame = training_frame.copy()
    frame.loc[112:, "amount"] = 7.0
    result = run(frame, task="regression", split="time")
    assert result["metrics"]["r2"] is None
    assert any("holdout target is constant" in note for note in result["notes"])


def test_unscalable_model_values_are_actionable(training_frame):
    frame = training_frame.assign(x=training_frame["x"] * 1e50)
    with pytest.raises(AnalysisError, match="Rescale"):
        run(frame, features=["x"])


def test_direct_target_copy_excluded_across_numeric_dtypes(training_frame):
    frame = training_frame.assign(amount=np.arange(len(training_frame)))
    frame["copy"] = frame["amount"].astype(float)
    result = run(frame, features=["copy", "x"], task="regression")
    assert result["features"] == ["x"]
