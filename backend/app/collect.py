from __future__ import annotations

from typing import Any

from .client import CentralBrainClient, CentralBrainError
from .store import ManifestStore


async def collect_alerts(
    client: CentralBrainClient,
    store: ManifestStore,
    *,
    alert_rule_id: str,
    from_timestamp: int,
    to_timestamp: int,
    page_size: int = 50,
    download_images: bool = True,
) -> dict[str, Any]:
    """Page all alerts for a rule/window, cache rows and optionally images."""
    rule = await client.get_rule(alert_rule_id, get_category=True)
    query_text = rule.get("query_text")
    category = rule.get("category") or {}
    category_id = rule.get("category_id") or category.get("alert_category_id")
    category_name = category.get("name")

    page = 1
    pages_fetched = 0
    alerts_collected = 0
    images_cached = 0
    images_missing = 0
    errors: list[str] = []

    while True:
        payload = await client.list_alerts(
            alert_rule_id=alert_rule_id,
            from_timestamp=from_timestamp,
            to_timestamp=to_timestamp,
            page=page,
            size=page_size,
            get_category=True,
        )
        alerts = payload.get("alerts") or []
        pages_fetched += 1
        if not alerts:
            break

        for alert in alerts:
            alert_id = alert.get("alert_id")
            if not alert_id:
                continue
            camera = alert.get("camera") or {}
            alert_rule = alert.get("alert_rule") or {}
            row: dict[str, Any] = {
                "alert_id": alert_id,
                "alert_rule_id": alert.get("alert_rule_id") or alert_rule_id,
                "document_id": alert.get("document_id"),
                "camera_id": alert.get("camera_id"),
                "camera_name": camera.get("name"),
                "timestamp": alert.get("timestamp"),
                "score": alert.get("score"),
                "hits": alert.get("hits"),
                "image_path": alert.get("image_path"),
                "feedback": alert.get("feedback"),
                "feedback_type": alert.get("feedback_type"),
                "status": alert.get("status"),
                "query_text": alert_rule.get("query_text") or query_text,
                "category_id": alert_rule.get("category_id") or category_id,
                "category_name": (alert_rule.get("category") or {}).get("name")
                or category_name,
                "from_timestamp": from_timestamp,
                "to_timestamp": to_timestamp,
            }

            if download_images and alert.get("image_path"):
                existing = store.find_image(alert_id)
                if existing:
                    row["local_image"] = str(existing)
                    images_cached += 1
                else:
                    try:
                        content, content_type = await client.download_image(
                            alert["image_path"]
                        )
                        dest = store.image_path_for(alert_id, content_type)
                        dest.write_bytes(content)
                        row["local_image"] = str(dest)
                        row["image_content_type"] = content_type
                        images_cached += 1
                    except CentralBrainError as exc:
                        images_missing += 1
                        row["image_error"] = exc.message
                    except Exception as exc:  # noqa: BLE001
                        images_missing += 1
                        row["image_error"] = str(exc)
                        errors.append(f"{alert_id}: {exc}")

            store.upsert(row)
            alerts_collected += 1

        if len(alerts) < page_size:
            break
        page += 1

    return {
        "alert_rule_id": alert_rule_id,
        "from_timestamp": from_timestamp,
        "to_timestamp": to_timestamp,
        "pages_fetched": pages_fetched,
        "alerts_collected": alerts_collected,
        "images_cached": images_cached,
        "images_missing": images_missing,
        "errors": errors[:20],
        "rule": {
            "alert_rule_id": alert_rule_id,
            "query_text": query_text,
            "category_id": category_id,
            "category_name": category_name,
            "is_preprocessed": rule.get("is_preprocessed"),
            "status": rule.get("status"),
        },
    }


async def poll_rule_ready(
    client: CentralBrainClient,
    alert_rule_id: str,
    *,
    max_attempts: int = 30,
    interval_seconds: float = 2.0,
) -> dict[str, Any]:
    import asyncio

    last: dict[str, Any] = {}
    for _ in range(max_attempts):
        last = await client.get_rule(alert_rule_id, get_category=True)
        if last.get("is_preprocessed"):
            return last
        await asyncio.sleep(interval_seconds)
    return last
