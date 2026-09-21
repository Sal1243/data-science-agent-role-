"""Bounded, single-user in-memory workspace. No uploaded datasets are persisted."""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass

import pandas as pd
from fastapi import HTTPException

from .analysis import analyze, demo_frame


@dataclass
class Dataset:
    frame: pd.DataFrame
    profile: dict
    touched_at: float
    model: dict | None = None


class DatasetStore:
    def __init__(self, capacity: int = 4, ttl: int = 7200):
        self.capacity = capacity
        self.ttl = ttl
        self._items: dict[str, Dataset] = {}
        self._lock = threading.RLock()

    def _expire(self) -> None:
        now = time.monotonic()
        for key in list(self._items):
            if key != "demo" and now - self._items[key].touched_at > self.ttl:
                del self._items[key]

    def expire(self) -> None:
        with self._lock:
            self._expire()

    def add(self, frame: pd.DataFrame, name: str, notes: list[str] | None = None) -> dict:
        profile = analyze(frame, name, notes)
        key = uuid.uuid4().hex
        profile["id"] = key
        with self._lock:
            self._expire()
            uploads = [k for k in self._items if k != "demo"]
            if len(uploads) >= self.capacity:
                oldest = min(uploads, key=lambda k: self._items[k].touched_at)
                del self._items[oldest]
            self._items[key] = Dataset(frame, profile, time.monotonic())
        return profile

    def demo(self) -> dict:
        with self._lock:
            if "demo" not in self._items:
                frame = demo_frame()
                profile = analyze(
                    frame,
                    "Commerce performance.csv",
                    demo=True,
                    notes=[
                        "Synthetic demonstration data, generated with seed 41. Not real transactions.",
                        "Demo revenue is calculated from units, unit_price and discount_pct. A revenue model illustrates a known formula, not future business performance.",
                        "Currency is unspecified; amounts are displayed without a currency symbol.",
                    ],
                )
                profile["id"] = "demo"
                self._items["demo"] = Dataset(frame, profile, time.monotonic())
            return self._items["demo"].profile

    def get(self, key: str) -> Dataset:
        with self._lock:
            self._expire()
            if key not in self._items:
                raise HTTPException(
                    404, "Dataset not found or expired. Upload it again to continue."
                )
            self._items[key].touched_at = time.monotonic()
            return self._items[key]

    def list(self) -> list[dict]:
        with self._lock:
            self._expire()
            return [
                {k: item.profile[k] for k in ["id", "name", "row_count", "created_at", "is_demo"]}
                for item in self._items.values()
            ]

    def delete(self, key: str) -> None:
        with self._lock:
            if key == "demo":
                raise HTTPException(
                    400, "The synthetic demo stays available. You can delete uploaded datasets."
                )
            if key not in self._items:
                raise HTTPException(404, "This dataset has already been removed or expired.")
            del self._items[key]


store = DatasetStore()
