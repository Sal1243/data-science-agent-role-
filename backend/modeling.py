"""Leakage-conscious baseline experiments; deliberately not an AutoML production claim."""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    r2_score,
    root_mean_squared_error,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from threadpoolctl import threadpool_limits

from .analysis import AnalysisError, date_values, finite

MAX_MODEL_ROWS = 10_000


def train_baseline(
    frame: pd.DataFrame,
    columns: list[dict],
    target: str,
    task: str = "auto",
    split: str = "random",
    features: list[str] | None = None,
) -> dict:
    schema = {c["name"]: c for c in columns}
    if target not in schema:
        raise AnalysisError("The target column was not found in this dataset.")
    if task not in {"auto", "regression", "classification"}:
        raise AnalysisError("Choose auto, regression, or classification.")
    if split not in {"random", "time"}:
        raise AnalysisError("Choose a random or chronological split.")
    if schema[target]["kind"] in {"date", "identifier", "empty", "text"}:
        raise AnalysisError(
            "Choose a non-empty numeric or categorical target, not an identifier or free text."
        )
    if features is not None:
        if target in features or any(f not in schema for f in features):
            raise AnalysisError("Features must exist in the dataset and cannot include the target.")
        if len(features) != len(set(features)) or len(features) > 30:
            raise AnalysisError("Choose at most 30 distinct features.")

    notes = [
        "Exploratory holdout estimate, not a production guarantee. No hyperparameter search or confidence intervals.",
        "Imputation and category encoding are fitted on training data only. No test data is used for training.",
    ]
    data = frame.dropna(subset=[target]).copy()
    dropped_missing_target = len(frame) - len(data)
    duplicate_count = int(data.duplicated().sum())
    data = data.drop_duplicates()
    if duplicate_count:
        notes.append(
            f"{duplicate_count:,} exact duplicates were removed before splitting to reduce leakage."
        )
    if dropped_missing_target:
        notes.append(f"{dropped_missing_target:,} rows without a target were excluded.")
    date_column = next((c["name"] for c in columns if c["kind"] == "date"), None)
    if split == "time":
        if not date_column:
            raise AnalysisError("A chronological split requires a detected date column.")
        dates = date_values(data[date_column])
        invalid = int(dates.isna().sum())
        data = data.loc[dates.notna()].copy()
        data = data.loc[dates.dropna().sort_values(kind="stable").index]
        if invalid:
            notes.append(f"{invalid:,} rows without valid dates were excluded from the time split.")
    if len(data) > MAX_MODEL_ROWS:
        if split == "time":
            data = data.iloc[np.linspace(0, len(data) - 1, MAX_MODEL_ROWS, dtype=int)]
            notes.append("The time range was evenly subsampled to 10,000 rows to bound runtime.")
        else:
            data = data.sample(MAX_MODEL_ROWS, random_state=42)
            notes.append("A reproducible 10,000-row random sample was used to bound runtime.")
    if len(data) < 60:
        raise AnalysisError(
            "At least 60 usable, distinct rows with a target are needed for a baseline."
        )
    if data[target].nunique() < 2:
        raise AnalysisError(
            "The target is constant. Choose a column with at least two distinct values."
        )
    is_numeric = pd.api.types.is_numeric_dtype(data[target])
    if task == "auto":
        is_integer = is_numeric and bool((data[target] % 1 == 0).all())
        task = (
            "classification"
            if (not is_numeric or (is_integer and data[target].nunique() <= 12))
            else "regression"
        )
        notes.append(
            f"Auto task detection selected {task}; override the task if this does not match your question."
        )
    if task == "regression" and not is_numeric:
        raise AnalysisError("Regression needs a numeric target. Choose classification for labels.")
    y = data[target].astype(str) if task == "classification" else data[target].astype(float)
    if task == "classification":
        counts = y.value_counts()
        if len(counts) > 20:
            raise AnalysisError(
                "Classification supports at most 20 target classes. Consider regression or grouping labels."
            )
        if counts.min() < 5:
            raise AnalysisError(
                "Each target class needs at least 5 examples. Gather more data or combine rare classes."
            )

    candidates = (
        features if features is not None else [c["name"] for c in columns if c["name"] != target]
    )
    eligible = []
    excluded = []
    for name in candidates:
        kind = schema[name]["kind"]
        reason = None
        if kind in {"identifier", "date", "text", "empty"}:
            reason = f"{kind} columns are not used by this baseline"
        elif data[name].nunique() < 2:
            reason = "no usable variation"
        elif data[name].eq(data[target]).fillna(False).all():
            reason = "identical to the target (direct leakage)"
        elif len(eligible) >= 30:
            reason = "30-feature runtime limit"
        if reason:
            excluded.append({"name": name, "reason": reason})
        else:
            eligible.append(name)
    if not eligible:
        raise AnalysisError(
            "No usable features remain. Include a varying numeric or categorical column besides the target."
        )
    numeric = [
        n
        for n in eligible
        if pd.api.types.is_numeric_dtype(data[n]) and schema[n]["kind"] != "boolean"
    ]
    categorical = [n for n in eligible if n not in numeric]
    x = data[eligible].copy()
    # Make mixed and boolean categories consistent while retaining actual missing values.
    for name in categorical:
        x[name] = x[name].map(lambda value: str(value) if pd.notna(value) else np.nan)
    if split == "time":
        # A date belongs entirely to one partition, including datasets with repeated timestamps.
        ordered_dates = date_values(data[date_column])
        boundary = ordered_dates.iloc[int(len(data) * 0.8)]
        train_mask = ordered_dates < boundary
        test_mask = ~train_mask
        x_train, x_test = x.loc[train_mask], x.loc[test_mask]
        y_train, y_test = y.loc[train_mask], y.loc[test_mask]
        if len(x_train) < 30 or len(x_test) < 10:
            raise AnalysisError(
                "Not enough distinct time periods for a safe chronological split. Try a random split."
            )
        notes.append(
            f"Trained on earlier dates and evaluated from {boundary.date().isoformat()} onward using {date_column}. Equal timestamps stay together."
        )
    else:
        x_train, x_test, y_train, y_test = train_test_split(
            x,
            y,
            test_size=0.2,
            random_state=42,
            stratify=y if task == "classification" else None,
        )
        notes.append(
            "Seed-42 random 80/20 split. Use a chronological split for forecasting; repeated entities may need grouped validation."
        )
    if y_train.nunique() < 2:
        raise AnalysisError(
            "The training partition has only one target value. Try a different split or target."
        )
    if task == "classification" and (set(y_test) - set(y_train)):
        notes.append(
            "The test partition includes classes absent from training. Investigate class drift and validation representativeness."
        )
    for name in numeric:
        if is_numeric:
            paired = data[[name, target]].dropna()
            if len(paired) >= 10:
                correlation = paired[name].corr(paired[target])
                if pd.notna(correlation) and abs(correlation) > 0.95:
                    notes.append(
                        f"{name} is highly correlated with the target (|r| > 0.95). Check that it is available at prediction time."
                    )
    transformers = []
    if numeric:
        transformers.append(
            ("numeric", SimpleImputer(strategy="median", keep_empty_features=True), numeric)
        )
    if categorical:
        transformers.append(
            (
                "categorical",
                Pipeline(
                    [
                        (
                            "impute",
                            SimpleImputer(
                                strategy="constant",
                                fill_value="(Missing)",
                                keep_empty_features=True,
                            ),
                        ),
                        (
                            "encode",
                            OneHotEncoder(
                                handle_unknown="ignore", max_categories=20, sparse_output=True
                            ),
                        ),
                    ]
                ),
                categorical,
            )
        )
    if (x[numeric].abs() > 1e30).any().any() or (task == "regression" and y.abs().max() > 1e30):
        raise AnalysisError(
            "This baseline supports numeric magnitudes up to 1e30. Rescale large feature or target values first."
        )
    if task == "regression" and y_test.nunique() < 2:
        notes.append(
            "The holdout target is constant; R² is not meaningful and is omitted. Choose a more representative validation split."
        )
    preprocessing = ColumnTransformer(transformers)
    forest_args = {
        "n_estimators": 80,
        "max_depth": 12,
        "min_samples_leaf": 3,
        "random_state": 42,
        "n_jobs": 1,
    }
    estimator = (
        RandomForestClassifier(**forest_args, class_weight="balanced")
        if task == "classification"
        else RandomForestRegressor(**forest_args)
    )
    pipeline = Pipeline([("prepare", preprocessing), ("model", estimator)])
    with threadpool_limits(limits=1), warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        pipeline.fit(x_train, y_train)
        predicted = pipeline.predict(x_test)
        dummy = (
            DummyClassifier(strategy="most_frequent")
            if task == "classification"
            else DummyRegressor(strategy="mean")
        )
        dummy.fit(np.zeros((len(y_train), 1)), y_train)
        naive = dummy.predict(np.zeros((len(y_test), 1)))
        if task == "regression":

            def measure(actual, predictions):
                return {
                    "r2": finite(r2_score(actual, predictions)) if actual.nunique() > 1 else None,
                    "mae": finite(mean_absolute_error(actual, predictions)),
                    "rmse": finite(root_mean_squared_error(actual, predictions)),
                }
        else:

            def measure(actual, predictions):
                return {
                    "accuracy": finite(accuracy_score(actual, predictions)),
                    "balanced_accuracy": finite(balanced_accuracy_score(actual, predictions)),
                    "f1_weighted": finite(
                        f1_score(actual, predictions, average="weighted", zero_division=0)
                    ),
                }

        metrics = measure(y_test, predicted)
        baseline_metrics = measure(y_test, naive)
        importance_x = x_test.sample(min(300, len(x_test)), random_state=42)
        importance = permutation_importance(
            pipeline,
            importance_x,
            y_test.loc[importance_x.index],
            scoring="accuracy" if task == "classification" else "neg_mean_absolute_error",
            n_repeats=3,
            random_state=42,
            n_jobs=1,
        )
    feature_importance = sorted(
        [
            {"feature": name, "importance": finite(value), "std": finite(std)}
            for name, value, std in zip(
                eligible, importance.importances_mean, importance.importances_std, strict=True
            )
        ],
        key=lambda item: item["importance"] or 0,
        reverse=True,
    )
    notes.append(
        "Permutation importance: mean holdout score drop across 3 shuffles, at most 300 test rows. Correlated features can share or hide importance."
    )
    result = {
        "target": target,
        "task": task,
        "split": split,
        "model_name": "Random forest",
        "baseline_name": "Majority class" if task == "classification" else "Training mean",
        "train_rows": len(x_train),
        "test_rows": len(x_test),
        "features": eligible,
        "excluded": excluded,
        "metrics": metrics,
        "baseline_metrics": baseline_metrics,
        "feature_importance": feature_importance,
        "notes": notes,
        "seed": 42,
        "importance_unit": "accuracy" if task == "classification" else "MAE",
    }
    if task == "regression":
        result["predictions"] = [
            {"actual": finite(actual), "predicted": finite(prediction)}
            for actual, prediction in zip(y_test.iloc[:100], predicted[:100], strict=True)
        ]
    else:
        labels = sorted(set(y_test) | set(predicted))
        result["confusion"] = {
            "labels": labels,
            "matrix": confusion_matrix(y_test, predicted, labels=labels).tolist(),
        }
    return result
