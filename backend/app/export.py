from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

from .store import ManifestStore


def build_manifest_rows(
    store: ManifestStore,
    *,
    alert_rule_id: str | None = None,
    feedback: str | None = None,
    from_timestamp: int | None = None,
    to_timestamp: int | None = None,
    labeled_only: bool = True,
) -> list[dict[str, Any]]:
    rows = store.list(
        alert_rule_id=alert_rule_id,
        feedback=feedback,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
        unlabeled_only=False,
    )
    if labeled_only:
        rows = [r for r in rows if r.get("feedback") is not None]
    return rows


def label_mix(rows: list[dict[str, Any]]) -> dict[str, int]:
    mix = {"like": 0, "dislike": 0, "neutral": 0, "unlabeled": 0}
    for row in rows:
        fb = row.get("feedback")
        if fb is None:
            mix["unlabeled"] += 1
        elif fb in mix:
            mix[fb] += 1
    return mix


def build_export_zip(
    store: ManifestStore,
    *,
    alert_rule_id: str | None = None,
    feedback: str | None = None,
    from_timestamp: int | None = None,
    to_timestamp: int | None = None,
    labeled_only: bool = True,
) -> bytes:
    rows = build_manifest_rows(
        store,
        alert_rule_id=alert_rule_id,
        feedback=feedback,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
        labeled_only=labeled_only,
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        manifest_lines: list[str] = []
        for row in rows:
            alert_id = row.get("alert_id")
            image_file: Path | None = None
            if row.get("local_image"):
                candidate = Path(row["local_image"])
                if candidate.exists():
                    image_file = candidate
            if image_file is None and alert_id:
                image_file = store.find_image(alert_id)

            image_name = image_file.name if image_file else None
            export_row = {
                "alert_id": alert_id,
                "alert_rule_id": row.get("alert_rule_id"),
                "document_id": row.get("document_id"),
                "camera_id": row.get("camera_id"),
                "camera_name": row.get("camera_name"),
                "timestamp": row.get("timestamp"),
                "score": row.get("score"),
                "hits": row.get("hits"),
                "query_text": row.get("query_text"),
                "category_id": row.get("category_id"),
                "category_name": row.get("category_name"),
                "feedback": row.get("feedback"),
                "feedback_type": row.get("feedback_type"),
                "image": f"images/{image_name}" if image_name else None,
            }
            manifest_lines.append(json.dumps(export_row, ensure_ascii=False))
            if image_file and image_file.exists():
                zf.write(image_file, arcname=f"images/{image_file.name}")

        zf.writestr(
            "manifest.jsonl",
            "\n".join(manifest_lines) + ("\n" if manifest_lines else ""),
        )
    return buffer.getvalue()
