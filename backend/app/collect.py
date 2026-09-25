from __future__ import annotations

from typing import Any

from .client import CentralBrainClient, CentralBrainError
from .logutil import get_collect_logger, iso_utc, summarize
from .store import ManifestStore

log = get_collect_logger()


def _epoch_seconds(value: Any) -> int | None:
    """Accept epoch seconds, epoch milliseconds, or an ISO-8601 string."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        n = int(value)
        if n > 10_000_000_000:
            return n // 1000
        return n
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            return _epoch_seconds(int(text))
        from datetime import datetime

        try:
            return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
        except ValueError:
            return None
    return None


def _extract_alerts(payload: Any) -> list[Any]:
    """Read alert rows from the contract shape or the alternates we already detect."""
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    alerts = payload.get("alerts")
    if isinstance(alerts, list) and alerts:
        return alerts
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("alerts"), list) and data["alerts"]:
        return data["alerts"]
    if isinstance(data, list) and data:
        return data
    if isinstance(alerts, list):
        return alerts
    return []


def _payload_shape(payload: Any) -> dict[str, Any]:
    """Describe the list-alerts body without changing how we parse it."""
    info: dict[str, Any] = {
        "payload_type": type(payload).__name__,
        "keys": list(payload.keys()) if isinstance(payload, dict) else None,
        "count_field": payload.get("count") if isinstance(payload, dict) else None,
        "has_alerts_key": isinstance(payload, dict) and "alerts" in payload,
        "alerts_len": 0,
        "alt_list_len": None,
        "alt_path": None,
    }
    if isinstance(payload, list):
        info["alt_list_len"] = len(payload)
        info["alt_path"] = "root list"
        return info
    if not isinstance(payload, dict):
        return info
    alerts = payload.get("alerts")
    if isinstance(alerts, list):
        info["alerts_len"] = len(alerts)
    elif alerts is not None:
        info["alerts_value_type"] = type(alerts).__name__
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("alerts"), list):
        info["alt_list_len"] = len(data["alerts"])
        info["alt_path"] = "data.alerts"
        info["nested_data_keys"] = list(data.keys())
    elif isinstance(data, list):
        info["alt_list_len"] = len(data)
        info["alt_path"] = "data"
    return info


def _verdict(
    *,
    count: int | None,
    listed: int,
    collected: int,
    skipped_no_id: int,
    has_alerts_key: bool,
    payload_type: str,
    alt_list_len: int | None,
    alt_path: str | None,
) -> tuple[str, str]:
    if collected > 0 and listed > 0:
        return ("ok", f"Collected {collected} alert(s) from Central Brain.")
    if alt_list_len and listed == 0:
        return (
            "parse_mismatch",
            f"Rows exist at {alt_path} (len={alt_list_len}) but not at contract "
            "key alerts[]. This app only reads payload.alerts.",
        )
    if count == 0 and listed == 0 and collected == 0:
        return (
            "no_data",
            "Central Brain returned 0 alerts for this rule and time window. "
            "Not a local cache bug.",
        )
    if payload_type != "dict" or not has_alerts_key:
        if listed == 0 and (count or 0) > 0:
            return (
                "parse_mismatch",
                "Central Brain count is non-zero but the list body is not "
                "{count, alerts[]}. Check collect.log for payload keys.",
            )
        if listed == 0:
            return (
                "parse_mismatch",
                "List response was not the expected {alerts: [...]} object. "
                "Could be empty data or a different JSON shape — see collect.log.",
            )
    if (count or 0) > 0 and listed == 0:
        return (
            "parse_mismatch",
            "Count endpoint found alerts but list parsing got none. "
            "Response shape likely differs from the contract.",
        )
    if listed > 0 and collected == 0:
        return (
            "parse_mismatch",
            f"List returned {listed} row(s) but none had alert_id "
            f"(skipped_no_id={skipped_no_id}). ID field name may differ.",
        )
    if listed == 0 and collected == 0:
        return (
            "no_data",
            "Central Brain returned 0 alerts for this rule and time window. "
            "Not a local cache bug.",
        )
    return ("ok", f"Collected {collected} alert(s) from Central Brain.")


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
    log.info("======== COLLECT START ========")
    log.info(
        "request rule_id=%s from=%s (%s) to=%s (%s) page_size=%s download_images=%s "
        "alert_rule_type=%s base_url=%s",
        alert_rule_id,
        from_timestamp,
        iso_utc(from_timestamp),
        to_timestamp,
        iso_utc(to_timestamp),
        page_size,
        download_images,
        client.settings.alert_rule_type,
        client.base_url,
    )

    rule = await client.get_rule(alert_rule_id, get_category=True)
    query_text = rule.get("query_text")
    category = rule.get("category") or {}
    category_id = rule.get("category_id") or category.get("alert_category_id")
    category_name = category.get("name")
    log.info(
        "rule query_text=%r category=%s/%s status=%s is_preprocessed=%s "
        "camera_ids=%s created_at=%s",
        query_text,
        category_id,
        category_name,
        rule.get("status"),
        rule.get("is_preprocessed"),
        rule.get("camera_ids"),
        rule.get("created_at"),
    )

    count_payload: dict[str, Any] | None = None
    count_error: str | None = None
    try:
        raw_count = await client.count_alerts(
            alert_rule_id=alert_rule_id,
            from_timestamp=from_timestamp,
            to_timestamp=to_timestamp,
        )
        count_payload = raw_count if isinstance(raw_count, dict) else {"raw": raw_count}
        log.info("count endpoint body=%s", summarize(raw_count))
    except CentralBrainError as exc:
        count_error = f"{exc.status_code} {exc.message}"
        log.warning("count endpoint failed: %s detail=%s", count_error, summarize(exc.detail))

    query_from = from_timestamp
    query_to = to_timestamp
    if count_payload and count_payload.get("count") in (0, "0"):
        try:
            ms_count = await client.count_alerts(
                alert_rule_id=alert_rule_id,
                from_timestamp=from_timestamp * 1000,
                to_timestamp=to_timestamp * 1000,
            )
            log.info("count retry milliseconds body=%s", summarize(ms_count))
            ms_value = ms_count.get("count") if isinstance(ms_count, dict) else None
            if isinstance(ms_value, int) and ms_value > 0 or (
                isinstance(ms_value, str) and ms_value.isdigit() and int(ms_value) > 0
            ):
                query_from = from_timestamp * 1000
                query_to = to_timestamp * 1000
                count_payload = ms_count if isinstance(ms_count, dict) else count_payload
                log.info("using millisecond timestamps for this rule")
        except CentralBrainError as exc:
            log.info("millisecond count retry skipped: %s", exc.message)

    page = 1
    pages_fetched = 0
    alerts_collected = 0
    images_cached = 0
    images_missing = 0
    skipped_no_id = 0
    errors: list[str] = []
    page_reports: list[dict[str, Any]] = []
    collected_rows: list[dict[str, Any]] = []

    while True:
        payload = await client.list_alerts(
            alert_rule_id=alert_rule_id,
            from_timestamp=query_from,
            to_timestamp=query_to,
            page=page,
            size=page_size,
            get_category=True,
        )
        shape = _payload_shape(payload)
        alerts = _extract_alerts(payload)
        if not isinstance(alerts, list):
            log.warning(
                "list page=%s alerts is %s, not a list",
                page,
                type(alerts).__name__,
            )
            alerts = []
        pages_fetched += 1
        sample_keys = None
        sample_id_fields = None
        if alerts and isinstance(alerts[0], dict):
            sample_keys = list(alerts[0].keys())
            sample_id_fields = {
                key: alerts[0].get(key)
                for key in ("alert_id", "id", "document_id", "timestamp")
                if key in alerts[0]
            }
        report = {
            "page": page,
            **shape,
            "alerts_len": len(alerts),
            "sample_alert_keys": sample_keys,
            "sample_id_fields": sample_id_fields,
        }
        page_reports.append(report)
        log.info("list page=%s shape=%s", page, summarize(report))
        if not alerts:
            log.info("list page=%s is empty — stopping pagination", page)
            break

        for alert in alerts:
            if not isinstance(alert, dict):
                skipped_no_id += 1
                log.warning("skipping non-object alert: %s", summarize(alert))
                continue
            alert_id = alert.get("alert_id") or alert.get("id")
            if not alert_id:
                skipped_no_id += 1
                log.warning(
                    "skipping alert with no alert_id/id keys=%s",
                    list(alert.keys()),
                )
                continue
            camera = alert.get("camera") or {}
            alert_rule = alert.get("alert_rule") or {}
            row: dict[str, Any] = {
                "alert_id": alert_id,
                "alert_rule_id": alert.get("alert_rule_id") or alert_rule_id,
                "document_id": alert.get("document_id"),
                "camera_id": alert.get("camera_id") or camera.get("camera_id"),
                "camera_name": camera.get("name") or camera.get("camera_name"),
                "timestamp": _epoch_seconds(alert.get("timestamp")),
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
                        log.warning("image miss alert_id=%s %s", alert_id, exc.message)
                    except Exception as exc:  # noqa: BLE001
                        images_missing += 1
                        row["image_error"] = str(exc)
                        errors.append(f"{alert_id}: {exc}")
                        log.warning("image error alert_id=%s %s", alert_id, exc)

            store.upsert(row)
            alerts_collected += 1
            out = {key: value for key, value in row.items() if key != "local_image"}
            out["media_url"] = (
                f"/api/media/{alert_id}" if store.find_image(alert_id) else None
            )
            collected_rows.append(out)

        if len(alerts) < page_size:
            break
        page += 1

    cb_count = None
    cb_hits = None
    if count_payload:
        try:
            if count_payload.get("count") is not None:
                cb_count = int(count_payload["count"])
        except (TypeError, ValueError):
            cb_count = count_payload.get("count")
        try:
            if count_payload.get("hits") is not None:
                cb_hits = int(count_payload["hits"])
        except (TypeError, ValueError):
            cb_hits = count_payload.get("hits")

    first_page = page_reports[0] if page_reports else {}
    listed = sum(p.get("alerts_len") or 0 for p in page_reports)
    code, message = _verdict(
        count=cb_count,
        listed=listed,
        collected=alerts_collected,
        skipped_no_id=skipped_no_id,
        has_alerts_key=bool(first_page.get("has_alerts_key")),
        payload_type=str(first_page.get("payload_type") or "None"),
        alt_list_len=first_page.get("alt_list_len"),
        alt_path=first_page.get("alt_path"),
    )
    created_epoch = _epoch_seconds(rule.get("created_at"))
    if code == "no_data":
        if rule.get("is_preprocessed") is False:
            message = (
                "This rule is not preprocessed yet. Central Brain does not emit "
                "alerts until is_preprocessed is true."
            )
        elif rule.get("status") == "paused":
            message = "This rule is paused, so it produces no new alerts."
        elif created_epoch and created_epoch > to_timestamp:
            message = (
                "The time window ends before this rule was created "
                f"({iso_utc(created_epoch)}). Move To past the creation time."
            )
        elif created_epoch and created_epoch > from_timestamp:
            message = (
                "Central Brain stored 0 alerts for this window. "
                "Rows are written after preprocessing finishes, and that can lag "
                f"the rule's created time ({iso_utc(created_epoch)}). "
                "Frames from before creation are included once they are written. "
                "Retry this window later."
            )
    log.info(
        "COLLECT DONE verdict=%s collected=%s pages=%s images_cached=%s "
        "images_missing=%s skipped_no_id=%s cb_count=%s cb_hits=%s — %s",
        code,
        alerts_collected,
        pages_fetched,
        images_cached,
        images_missing,
        skipped_no_id,
        cb_count,
        cb_hits,
        message,
    )
    log.info("======== COLLECT END ========")

    diagnostics = {
        "verdict": code,
        "message": message,
        "alert_rule_type": client.settings.alert_rule_type,
        "base_url": client.base_url,
        "from_iso_utc": iso_utc(from_timestamp),
        "to_iso_utc": iso_utc(to_timestamp),
        "cb_count": cb_count,
        "cb_hits": cb_hits,
        "count_error": count_error,
        "skipped_no_id": skipped_no_id,
        "pages": page_reports,
        "log_file": "data/collect.log",
    }

    dataset = None
    if alerts_collected > 0:
        dataset = store.register_dataset(
            alert_rule_id=alert_rule_id,
            from_timestamp=from_timestamp,
            to_timestamp=to_timestamp,
            query_text=query_text,
            category_id=category_id,
            category_name=category_name,
        )

    return {
        "alert_rule_id": alert_rule_id,
        "from_timestamp": from_timestamp,
        "to_timestamp": to_timestamp,
        "dataset": dataset,
        "pages_fetched": pages_fetched,
        "alerts_collected": alerts_collected,
        "images_cached": images_cached,
        "images_missing": images_missing,
        "errors": errors[:20],
        "diagnostics": diagnostics,
        "alerts": sorted(
            collected_rows,
            key=lambda row: row.get("timestamp") or 0,
            reverse=True,
        ),
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
    last_error: CentralBrainError | None = None
    for attempt in range(max_attempts):
        try:
            last = await client.get_rule(alert_rule_id, get_category=True)
            last_error = None
            if last.get("is_preprocessed"):
                return last
        except CentralBrainError as exc:
            last_error = exc
            # Connect/read timeouts after create are common while CB preprocesses.
            if exc.status_code not in {502, 504} or attempt == max_attempts - 1:
                raise
        await asyncio.sleep(interval_seconds)
    if last_error and not last:
        raise last_error
    return last
