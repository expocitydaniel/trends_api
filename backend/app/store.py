from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Iterator


class ManifestStore:
    """Local JSONL manifest of collected alerts for ML training."""

    def __init__(self, path: Path, images_dir: Path):
        self.path = path
        self.images_dir = images_dir
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.images_dir.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.touch()

    def _read_all(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        if not self.path.exists():
            return rows
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return rows

    def _write_all(self, rows: list[dict[str, Any]]) -> None:
        with self.path.open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    def upsert(self, row: dict[str, Any]) -> dict[str, Any]:
        alert_id = row["alert_id"]
        with self._lock:
            rows = self._read_all()
            replaced = False
            for i, existing in enumerate(rows):
                if existing.get("alert_id") == alert_id:
                    merged = {**existing, **row}
                    rows[i] = merged
                    replaced = True
                    row = merged
                    break
            if not replaced:
                rows.append(row)
            self._write_all(rows)
        return row

    def update_feedback(
        self, alert_id: str, feedback: str, feedback_type: str = "user"
    ) -> dict[str, Any] | None:
        with self._lock:
            rows = self._read_all()
            for i, row in enumerate(rows):
                if row.get("alert_id") == alert_id:
                    rows[i] = {
                        **row,
                        "feedback": feedback,
                        "feedback_type": feedback_type,
                    }
                    self._write_all(rows)
                    return rows[i]
        return None

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

    def stats(self) -> dict[str, Any]:
        rows = self._read_all()
        labeled = 0
        by_label: dict[str, int] = {"like": 0, "dislike": 0, "neutral": 0}
        rules: set[str] = set()
        images_cached = 0
        for row in rows:
            if row.get("alert_rule_id"):
                rules.add(row["alert_rule_id"])
            fb = row.get("feedback")
            if fb is not None:
                labeled += 1
                if fb in by_label:
                    by_label[fb] += 1
            if row.get("local_image") and Path(row["local_image"]).exists():
                images_cached += 1
            elif row.get("alert_id"):
                candidates = list(self.images_dir.glob(f"{row['alert_id']}.*"))
                if candidates:
                    images_cached += 1
        return {
            "alerts": len(rows),
            "labeled": labeled,
            "unlabeled": len(rows) - labeled,
            "by_label": by_label,
            "rules": len(rules),
            "images_cached": images_cached,
            "export_ready": labeled > 0 and images_cached > 0,
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
