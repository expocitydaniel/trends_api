from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Iterator


def make_dataset_id(alert_rule_id: str, from_timestamp: int, to_timestamp: int) -> str:
    """Stable id for one rule + inclusive time window."""
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", str(alert_rule_id)).strip("-") or "rule"
    if len(safe) > 64:
        digest = hashlib.sha1(str(alert_rule_id).encode("utf-8")).hexdigest()[:8]
        safe = f"{safe[:48]}-{digest}"
    return f"{safe}_{int(from_timestamp)}_{int(to_timestamp)}"


def _stats_for_rows(rows: list[dict[str, Any]], images_dir: Path) -> dict[str, Any]:
    labeled = 0
    by_label: dict[str, int] = {"like": 0, "dislike": 0, "neutral": 0}
    images_cached = 0
    for row in rows:
        fb = row.get("feedback")
        if fb is not None:
            labeled += 1
            if fb in by_label:
                by_label[fb] += 1
        if row.get("local_image") and Path(row["local_image"]).exists():
            images_cached += 1
        elif row.get("alert_id"):
            if list(images_dir.glob(f"{row['alert_id']}.*")):
                images_cached += 1
    return {
        "alerts": len(rows),
        "labeled": labeled,
        "unlabeled": len(rows) - labeled,
        "by_label": by_label,
        "images_cached": images_cached,
        "export_ready": labeled > 0 and images_cached > 0,
    }


class ManifestStore:
    """Local JSONL of collected alerts, grouped into per-rule time-window datasets."""

    def __init__(
        self,
        path: Path,
        images_dir: Path,
        datasets_path: Path | None = None,
    ):
        self.path = path
        self.images_dir = images_dir
        self.datasets_path = datasets_path or path.parent / "datasets.jsonl"
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.images_dir.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.touch()
        if not self.datasets_path.exists():
            self.datasets_path.touch()

    def _read_jsonl(self, path: Path) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        if not path.exists():
            return rows
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return rows

    def _write_jsonl(self, path: Path, rows: list[dict[str, Any]]) -> None:
        with path.open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    def _read_all(self) -> list[dict[str, Any]]:
        return self._read_jsonl(self.path)

    def _write_all(self, rows: list[dict[str, Any]]) -> None:
        self._write_jsonl(self.path, rows)

    def _read_datasets(self) -> list[dict[str, Any]]:
        return self._read_jsonl(self.datasets_path)

    def _write_datasets(self, rows: list[dict[str, Any]]) -> None:
        self._write_jsonl(self.datasets_path, rows)

    def upsert(self, row: dict[str, Any]) -> dict[str, Any]:
        alert_id = row["alert_id"]
        with self._lock:
            rows = self._read_all()
            replaced = False
            for i, existing in enumerate(rows):
                if existing.get("alert_id") == alert_id:
                    incoming = dict(row)
                    # Keep local ML labels if Central Brain still has none.
                    if not incoming.get("feedback") and existing.get("feedback"):
                        incoming["feedback"] = existing["feedback"]
                        incoming["feedback_type"] = existing.get("feedback_type")
                    merged = {**existing, **incoming}
                    rows[i] = merged
                    replaced = True
                    row = merged
                    break
            if not replaced:
                rows.append(row)
            self._write_all(rows)
        return row

    def update_feedback(
        self,
        alert_id: str,
        feedback: str | None,
        feedback_type: str = "user",
    ) -> dict[str, Any] | None:
        with self._lock:
            rows = self._read_all()
            for i, row in enumerate(rows):
                if row.get("alert_id") == alert_id:
                    rows[i] = {
                        **row,
                        "feedback": feedback,
                        "feedback_type": feedback_type if feedback is not None else None,
                    }
                    self._write_all(rows)
                    return rows[i]
        return None

    def register_dataset(
        self,
        *,
        alert_rule_id: str,
        from_timestamp: int,
        to_timestamp: int,
        query_text: str | None = None,
        category_id: str | None = None,
        category_name: str | None = None,
    ) -> dict[str, Any]:
        dataset_id = make_dataset_id(alert_rule_id, from_timestamp, to_timestamp)
        now = int(time.time())
        with self._lock:
            datasets = self._read_datasets()
            existing: dict[str, Any] | None = None
            index = -1
            for i, row in enumerate(datasets):
                if row.get("dataset_id") == dataset_id:
                    existing = row
                    index = i
                    break
            meta = {
                **(existing or {}),
                "dataset_id": dataset_id,
                "alert_rule_id": alert_rule_id,
                "from_timestamp": int(from_timestamp),
                "to_timestamp": int(to_timestamp),
                "query_text": query_text
                if query_text is not None
                else (existing or {}).get("query_text"),
                "category_id": category_id
                if category_id is not None
                else (existing or {}).get("category_id"),
                "category_name": category_name
                if category_name is not None
                else (existing or {}).get("category_name"),
                "created_at": (existing or {}).get("created_at") or now,
                "updated_at": now,
            }
            if index >= 0:
                datasets[index] = meta
            else:
                datasets.append(meta)
            self._write_datasets(datasets)
        return self.summarize_dataset(meta)

    def _infer_datasets_locked(self) -> list[dict[str, Any]]:
        datasets = self._read_datasets()
        known_ids = {row.get("dataset_id") for row in datasets}
        inferred: dict[tuple[str, int, int], dict[str, Any]] = {}
        fallback_rows: dict[str, list[dict[str, Any]]] = {}
        for row in self._read_all():
            rule_id = row.get("alert_rule_id")
            if not rule_id:
                continue
            from_ts = row.get("from_timestamp")
            to_ts = row.get("to_timestamp")
            if from_ts is None or to_ts is None:
                fallback_rows.setdefault(str(rule_id), []).append(row)
                continue
            key = (str(rule_id), int(from_ts), int(to_ts))
            if key not in inferred:
                inferred[key] = {
                    "alert_rule_id": str(rule_id),
                    "from_timestamp": int(from_ts),
                    "to_timestamp": int(to_ts),
                    "query_text": row.get("query_text"),
                    "category_id": row.get("category_id"),
                    "category_name": row.get("category_name"),
                }
        for rule_id, rows in fallback_rows.items():
            timestamps = [r.get("timestamp") for r in rows if r.get("timestamp") is not None]
            if not timestamps:
                continue
            sample = rows[0]
            key = (rule_id, int(min(timestamps)), int(max(timestamps)))
            inferred.setdefault(
                key,
                {
                    "alert_rule_id": rule_id,
                    "from_timestamp": int(min(timestamps)),
                    "to_timestamp": int(max(timestamps)),
                    "query_text": sample.get("query_text"),
                    "category_id": sample.get("category_id"),
                    "category_name": sample.get("category_name"),
                },
            )
        now = int(time.time())
        changed = False
        for spec in inferred.values():
            dataset_id = make_dataset_id(
                spec["alert_rule_id"], spec["from_timestamp"], spec["to_timestamp"]
            )
            if dataset_id in known_ids:
                continue
            datasets.append(
                {
                    **spec,
                    "dataset_id": dataset_id,
                    "created_at": now,
                    "updated_at": now,
                }
            )
            known_ids.add(dataset_id)
            changed = True
        if changed:
            self._write_datasets(datasets)
        return datasets

    def list_datasets(self) -> list[dict[str, Any]]:
        with self._lock:
            datasets = self._infer_datasets_locked()
        summaries = [self.summarize_dataset(meta) for meta in datasets]
        summaries.sort(key=lambda row: row.get("updated_at") or 0, reverse=True)
        return summaries

    def get_dataset(self, dataset_id: str) -> dict[str, Any] | None:
        with self._lock:
            datasets = self._infer_datasets_locked()
        for row in datasets:
            if row.get("dataset_id") == dataset_id:
                return self.summarize_dataset(row)
        return None

    def get_dataset_by_scope(
        self,
        alert_rule_id: str,
        from_timestamp: int,
        to_timestamp: int,
        *,
        persist: bool = False,
    ) -> dict[str, Any] | None:
        dataset_id = make_dataset_id(alert_rule_id, from_timestamp, to_timestamp)
        found = self.get_dataset(dataset_id)
        if found:
            return found
        if persist:
            return self.register_dataset(
                alert_rule_id=alert_rule_id,
                from_timestamp=from_timestamp,
                to_timestamp=to_timestamp,
            )
        rows = self.list(
            alert_rule_id=alert_rule_id,
            from_timestamp=from_timestamp,
            to_timestamp=to_timestamp,
        )
        sample = rows[0] if rows else {}
        meta = {
            "dataset_id": dataset_id,
            "alert_rule_id": alert_rule_id,
            "from_timestamp": int(from_timestamp),
            "to_timestamp": int(to_timestamp),
            "query_text": sample.get("query_text"),
            "category_id": sample.get("category_id"),
            "category_name": sample.get("category_name"),
        }
        return self.summarize_dataset(meta)

    def summarize_dataset(self, meta: dict[str, Any]) -> dict[str, Any]:
        rows = self.list(
            alert_rule_id=str(meta.get("alert_rule_id") or ""),
            from_timestamp=meta.get("from_timestamp"),
            to_timestamp=meta.get("to_timestamp"),
        )
        return {**meta, "stats": _stats_for_rows(rows, self.images_dir)}

    def collected_rules(self) -> list[dict[str, Any]]:
        seen: dict[str, dict[str, Any]] = {}
        for row in self._read_all():
            rule_id = row.get("alert_rule_id")
            if not rule_id or rule_id in seen:
                continue
            seen[rule_id] = {
                "alert_rule_id": rule_id,
                "query_text": row.get("query_text"),
                "category_id": row.get("category_id"),
                "category_name": row.get("category_name"),
            }
        return list(seen.values())

    def get(self, alert_id: str) -> dict[str, Any] | None:
        for row in self._read_all():
            if row.get("alert_id") == alert_id:
                return row
        return None

    def list(
        self,
        *,
        alert_rule_id: str | None = None,
        feedback: str | None = None,
        unlabeled_only: bool = False,
        from_timestamp: int | None = None,
        to_timestamp: int | None = None,
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for row in self._read_all():
            if alert_rule_id and row.get("alert_rule_id") != alert_rule_id:
                continue
            ts = row.get("timestamp")
            if from_timestamp is not None and (ts is None or ts < from_timestamp):
                continue
            if to_timestamp is not None and (ts is None or ts > to_timestamp):
                continue
            fb = row.get("feedback")
            if unlabeled_only and fb is not None:
                continue
            if feedback is not None:
                if feedback == "unlabeled":
                    if fb is not None:
                        continue
                elif fb != feedback:
                    continue
            results.append(row)
        results.sort(key=lambda r: r.get("timestamp") or 0, reverse=True)
        return results

    def stats(self, dataset_id: str | None = None) -> dict[str, Any]:
        if dataset_id:
            dataset = self.get_dataset(dataset_id)
            if dataset is None:
                return {
                    "alerts": 0,
                    "labeled": 0,
                    "unlabeled": 0,
                    "by_label": {"like": 0, "dislike": 0, "neutral": 0},
                    "rules": 0,
                    "images_cached": 0,
                    "export_ready": False,
                    "datasets": 0,
                    "dataset_summaries": [],
                }
            st = dataset["stats"]
            return {
                **st,
                "rules": 1,
                "datasets": 1,
                "dataset_summaries": [dataset],
            }
        rows = self._read_all()
        st = _stats_for_rows(rows, self.images_dir)
        datasets = self.list_datasets()
        rules = {row.get("alert_rule_id") for row in rows if row.get("alert_rule_id")}
        return {
            **st,
            "rules": len(rules),
            "datasets": len(datasets),
            "dataset_summaries": datasets,
            "export_ready": any(ds.get("stats", {}).get("export_ready") for ds in datasets),
        }

    def iter_rows(self) -> Iterator[dict[str, Any]]:
        yield from self._read_all()

    def image_path_for(self, alert_id: str, content_type: str = "image/jpeg") -> Path:
        ext = ".jpg"
        if "png" in content_type:
            ext = ".png"
        elif "webp" in content_type:
            ext = ".webp"
        elif "gif" in content_type:
            ext = ".gif"
        return self.images_dir / f"{alert_id}{ext}"

    def find_image(self, alert_id: str) -> Path | None:
        matches = list(self.images_dir.glob(f"{alert_id}.*"))
        return matches[0] if matches else None
