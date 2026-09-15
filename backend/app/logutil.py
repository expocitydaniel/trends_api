from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOGGER_NAME = "trends.collect"


def configure_collect_logging(log_path: Path) -> logging.Logger:
    """Log collect traffic to stdout and data/collect.log (survives remote UI use)."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(logging.INFO)
    logger.propagate = True

    target = str(log_path.resolve())
    already = any(
        isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", None) == target
        for h in logger.handlers
    )
    if already:
        return logger

    formatter = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)
    return logger


def get_collect_logger() -> logging.Logger:
    return logging.getLogger(LOGGER_NAME)


def iso_utc(epoch: int | float | None) -> str:
    if epoch is None:
        return "—"
    try:
        value = float(epoch)
    except (TypeError, ValueError):
        return repr(epoch)
    if value > 1_000_000_000_000:
        return (
            datetime.fromtimestamp(value / 1000.0, tz=timezone.utc).isoformat()
            + " (epoch looks like milliseconds)"
        )
    if value > 1_000_000_000:
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    return f"{epoch} (epoch too small to be Unix seconds)"


def summarize(value: Any, *, limit: int = 1200) -> str:
    """Compact JSON-ish summary: keys, counts, no image bytes or secrets."""
    try:
        text = json.dumps(_shape(value), ensure_ascii=False, default=str)
    except Exception:
        text = repr(value)
    if len(text) > limit:
        return text[:limit] + "…"
    return text


def _shape(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        if isinstance(value, str) and len(value) > 180:
            return value[:180] + f"…({len(value)} chars)"
        return value
    if isinstance(value, (bytes, bytearray)):
        return f"<bytes {len(value)}>"
    if isinstance(value, list):
        if not value:
            return {"type": "list", "len": 0}
        return {
            "type": "list",
            "len": len(value),
            "first": _shape(value[0]),
        }
    if isinstance(value, dict):
        shaped: dict[str, Any] = {"type": "dict", "keys": list(value.keys())}
        for key in ("count", "hits", "message", "page", "size"):
            if key in value:
                shaped[key] = value[key]
        alerts = value.get("alerts")
        if isinstance(alerts, list):
            shaped["alerts_len"] = len(alerts)
            if alerts and isinstance(alerts[0], dict):
                shaped["first_alert_keys"] = list(alerts[0].keys())
                shaped["first_alert_id"] = alerts[0].get("alert_id") or alerts[0].get(
                    "id"
                )
        elif "alerts" in value:
            shaped["alerts"] = _shape(alerts)
        return shaped
    return repr(value)
