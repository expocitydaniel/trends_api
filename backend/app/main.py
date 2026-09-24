from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from .client import CentralBrainClient, CentralBrainError
from .collect import collect_alerts, poll_rule_ready
from .config import Settings, get_settings
from .export import build_export_zip, build_manifest_rows, export_filename, label_mix
from .logutil import configure_collect_logging, get_collect_logger, iso_utc, summarize
from .schemas import (
    CollectRequest,
    FeedbackRequest,
    UpdateRuleRequest,
    UpdateRuleStatusRequest,
)
from .store import ManifestStore

app = FastAPI(title="Trends ML Data BFF", version="1.0.0")

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_store(settings: Settings = Depends(get_settings)) -> ManifestStore:
    return ManifestStore(
        settings.manifest_path,
        settings.images_dir,
        settings.datasets_path,
    )


def _resolve_dataset(
    store: ManifestStore,
    *,
    dataset_id: str | None = None,
    alert_rule_id: str | None = None,
    from_timestamp: int | None = None,
    to_timestamp: int | None = None,
) -> dict[str, Any]:
    if dataset_id:
        dataset = store.get_dataset(dataset_id)
        if dataset is None:
            raise HTTPException(status_code=404, detail="dataset not found")
        return dataset
    if alert_rule_id and from_timestamp is not None and to_timestamp is not None:
        if from_timestamp > to_timestamp:
            raise HTTPException(
                status_code=400, detail="from_timestamp must be <= to_timestamp"
            )
        dataset = store.get_dataset_by_scope(
            alert_rule_id, from_timestamp, to_timestamp
        )
        if dataset is None:
            raise HTTPException(status_code=404, detail="dataset not found")
        return dataset
    raise HTTPException(
        status_code=400,
        detail=(
            "Choose one training dataset: dataset_id, or alert_rule_id plus "
            "from_timestamp and to_timestamp. Mixed all-rules exports are not supported."
        ),
    )


async def get_client(settings: Settings = Depends(get_settings)):
    if not settings.configured:
        raise HTTPException(
            status_code=503,
            detail=(
                "Central Brain is not configured. Set "
                "CENTRAL_BRAIN_INTERNAL_BASE_URL and "
                "CENTRAL_BRAIN_INTERNAL_API_KEY in .env"
            ),
        )
    client = CentralBrainClient(settings)
    try:
        yield client
    finally:
        await client.aclose()


async def get_optional_client(settings: Settings = Depends(get_settings)):
    if not settings.configured:
        yield None
        return
    client = CentralBrainClient(settings)
    try:
        yield client
    finally:
        await client.aclose()


def _public_dataset(dataset: dict[str, Any]) -> dict[str, Any]:
    item = dict(dataset)
    item["from_iso_utc"] = iso_utc(dataset.get("from_timestamp"))
    item["to_iso_utc"] = iso_utc(dataset.get("to_timestamp"))
    return item


def _public_alert(store: ManifestStore, row: dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    alert_id = row.get("alert_id")
    has_image = bool(alert_id and store.find_image(str(alert_id)))
    item["has_image"] = has_image
    item["media_url"] = f"/api/media/{alert_id}" if has_image else None
    item.pop("local_image", None)
    return item


@app.on_event("startup")
def ensure_data_dirs() -> None:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.images_dir.mkdir(parents=True, exist_ok=True)
    configure_collect_logging(settings.data_dir / "collect.log")
    get_collect_logger().info(
        "BFF started configured=%s base_url=%s alert_rule_type=%s collect_log=%s",
        settings.configured,
        settings.central_brain_internal_base_url or "(unset)",
        settings.alert_rule_type,
        settings.data_dir / "collect.log",
    )


@app.exception_handler(CentralBrainError)
async def central_brain_error_handler(_request, exc: CentralBrainError):
    return JSONResponse(
        status_code=exc.status_code if 400 <= exc.status_code < 600 else 502,
        content={"message": exc.message, "detail": exc.detail},
    )


# --- Health / stats ---


@app.get("/api/health")
async def health(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    result: dict[str, Any] = {
        "bff": "ok",
        "configured": settings.configured,
        "base_url_set": bool(settings.central_brain_internal_base_url.strip()),
        "api_key_present": bool(settings.central_brain_internal_api_key.strip()),
        "alert_rule_type": settings.alert_rule_type,
        "central_brain_reachable": False,
        "central_brain_error": None,
    }
    if settings.configured:
        client = CentralBrainClient(settings)
        try:
            await client.ping()
            result["central_brain_reachable"] = True
        except CentralBrainError as exc:
            result["central_brain_error"] = exc.message
        except Exception as exc:  # noqa: BLE001
            result["central_brain_error"] = str(exc)
        finally:
            await client.aclose()
    return result


@app.get("/api/stats")
async def stats(store: ManifestStore = Depends(get_store)) -> dict[str, Any]:
    result = store.stats()
    result["dataset_summaries"] = [
        _public_dataset(row) for row in result.get("dataset_summaries") or []
    ]
    return result


# --- Categories ---


@app.get("/api/categories")
async def list_categories(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    search: str | None = None,
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    return await client.list_categories(page=page, size=size, search=search)


@app.get("/api/categories/count")
async def count_categories(
    search: str | None = None,
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    return await client.count_categories(search=search)


# --- Cameras ---


@app.get("/api/cameras")
async def list_cameras(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    return await client.list_cameras(page=page, size=size)


# --- Rules ---


@app.get("/api/rules")
async def list_rules(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    search: str | None = None,
    status: str | None = None,
    severity: str | None = None,
    category_id: list[str] | None = Query(None),
    alert_rule_type: str | None = None,
    sort_by: str | None = None,
    sort_order: str | None = None,
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    return await client.list_rules(
        page=page,
        size=size,
        search=search,
        status=status,
        severity=severity,
        category_id=category_id,
        alert_rule_type=alert_rule_type,
        get_category=True,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@app.get("/api/rules/count")
async def count_rules(
    status: str | None = None,
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    return await client.count_rules(status=status)


@app.get("/api/rules/{alert_rule_id}")
async def get_rule(
    alert_rule_id: str,
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    return await client.get_rule(alert_rule_id, get_category=True)


@app.post("/api/rules")
async def create_rule(
    category_id: str = Form(...),
    query_text: str | None = Form(None),
    description: str | None = Form(None),
    severity: str | None = Form("medium"),
    status: str = Form("active"),
    camera_ids: list[str] | None = Form(None),
    wait_for_preprocess: bool = Form(True),
    file: UploadFile | None = File(None),
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    if not query_text and file is None:
        raise HTTPException(
            status_code=400,
            detail="Provide query_text or a reference image file",
        )

    file_bytes = None
    file_name = None
    file_content_type = None
    if file is not None:
        file_bytes = await file.read()
        file_name = file.filename
        file_content_type = file.content_type

    # Form list fields can arrive as a single string
    cams: list[str] | None = None
    if camera_ids:
        if len(camera_ids) == 1 and "," in camera_ids[0]:
            cams = [c.strip() for c in camera_ids[0].split(",") if c.strip()]
        else:
            cams = [c for c in camera_ids if c]

    created = await client.create_rule(
        category_id=category_id,
        query_text=query_text,
        description=description,
        severity=severity,
        status=status,
        camera_ids=cams,
        file_bytes=file_bytes,
        file_name=file_name,
        file_content_type=file_content_type,
    )
    rule_id = created.get("id") or created.get("alert_rule_id")
    rule: dict[str, Any] | None = None
    preprocess_error: str | None = None
    if rule_id and wait_for_preprocess:
        try:
            rule = await poll_rule_ready(client, rule_id)
        except CentralBrainError as exc:
            preprocess_error = exc.message
            try:
                rule = await client.get_rule(rule_id, get_category=True)
            except CentralBrainError:
                rule = created
    elif rule_id:
        try:
            rule = await client.get_rule(rule_id, get_category=True)
        except CentralBrainError as exc:
            preprocess_error = exc.message
            rule = created

    return {
        "message": created.get("message", "alert rule created"),
        "id": rule_id,
        "rule": rule,
        "preprocess_error": preprocess_error,
    }


@app.put("/api/rules/{alert_rule_id}")
async def update_rule(
    alert_rule_id: str,
    body: UpdateRuleRequest,
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    fields = body.model_dump(exclude_none=True)
    if "category_id" in fields and not str(fields["category_id"]).strip():
        raise HTTPException(status_code=400, detail="category_id cannot be empty")
    result = await client.update_rule(alert_rule_id, **fields)
    wait_preprocess = "query_text" in fields
    if wait_preprocess:
        rule = await poll_rule_ready(client, alert_rule_id)
    else:
        rule = await client.get_rule(alert_rule_id, get_category=True)
    return {"message": result.get("message", "alert rule updated"), "rule": rule}


@app.put("/api/rules/{alert_rule_id}/status")
async def update_rule_status(
    alert_rule_id: str,
    body: UpdateRuleStatusRequest,
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    result = await client.update_rule(alert_rule_id, status=body.status)
    rule = await client.get_rule(alert_rule_id, get_category=True)
    return {"message": result.get("message", "alert rule updated"), "rule": rule}


# --- Alerts / collect ---


@app.get("/api/alerts/count")
async def count_alerts(
    alert_rule_id: str,
    from_timestamp: int,
    to_timestamp: int,
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    log = get_collect_logger()
    log.info(
        "preview count rule_id=%s from=%s (%s) to=%s (%s) type=%s",
        alert_rule_id,
        from_timestamp,
        iso_utc(from_timestamp),
        to_timestamp,
        iso_utc(to_timestamp),
        client.settings.alert_rule_type,
    )
    result = await client.count_alerts(
        alert_rule_id=alert_rule_id,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
    )
    log.info("preview count result=%s", summarize(result))
    return result


@app.post("/api/collect")
async def collect(
    body: CollectRequest,
    client: CentralBrainClient = Depends(get_client),
    store: ManifestStore = Depends(get_store),
) -> dict[str, Any]:
    if body.from_timestamp > body.to_timestamp:
        raise HTTPException(
            status_code=400, detail="from_timestamp must be <= to_timestamp"
        )
    result = await collect_alerts(
        client,
        store,
        alert_rule_id=body.alert_rule_id,
        from_timestamp=body.from_timestamp,
        to_timestamp=body.to_timestamp,
        page_size=body.page_size,
        download_images=body.download_images,
    )
    if result.get("dataset"):
        result["dataset"] = _public_dataset(result["dataset"])
    return result


@app.get("/api/datasets")
async def list_datasets(store: ManifestStore = Depends(get_store)) -> dict[str, Any]:
    datasets = [_public_dataset(row) for row in store.list_datasets()]
    return {"count": len(datasets), "datasets": datasets}


@app.get("/api/datasets/{dataset_id}")
async def get_dataset(
    dataset_id: str,
    store: ManifestStore = Depends(get_store),
) -> dict[str, Any]:
    dataset = store.get_dataset(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="dataset not found")
    return _public_dataset(dataset)


@app.get("/api/dataset/alerts")
async def dataset_alerts(
    dataset_id: str | None = None,
    alert_rule_id: str | None = None,
    feedback: str | None = None,
    unlabeled_only: bool = False,
    from_timestamp: int | None = None,
    to_timestamp: int | None = None,
    store: ManifestStore = Depends(get_store),
) -> dict[str, Any]:
    dataset = _resolve_dataset(
        store,
        dataset_id=dataset_id,
        alert_rule_id=alert_rule_id,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
    )
    rows = store.list(
        alert_rule_id=dataset.get("alert_rule_id"),
        feedback=feedback,
        unlabeled_only=unlabeled_only,
        from_timestamp=dataset.get("from_timestamp"),
        to_timestamp=dataset.get("to_timestamp"),
    )
    enriched = [_public_alert(store, row) for row in rows]
    return {
        "count": len(enriched),
        "dataset": _public_dataset(dataset),
        "alerts": enriched,
    }


@app.get("/api/dataset/rules")
async def dataset_rules(store: ManifestStore = Depends(get_store)) -> dict[str, Any]:
    rules = store.collected_rules()
    return {"count": len(rules), "alert_rules": rules}


@app.get("/api/alerts/{alert_id}/hits")
async def alert_hits(
    alert_id: str,
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    return await client.get_hits(alert_id)


# --- Feedback ---


@app.post("/api/feedback")
async def submit_feedback(
    body: FeedbackRequest,
    store: ManifestStore = Depends(get_store),
    client: CentralBrainClient | None = Depends(get_optional_client),
) -> dict[str, Any]:
    if store.get(body.alert_id) is None:
        raise HTTPException(status_code=404, detail="alert is not in the local dataset")
    cb_error: str | None = None
    cb_message = "saved locally"
    if body.feedback is not None and client is not None:
        try:
            result = await client.submit_feedback(
                body.alert_id, body.feedback, body.feedback_type
            )
            cb_message = result.get("message", "feedback submitted successfully")
        except CentralBrainError as exc:
            cb_error = exc.message
    elif body.feedback is not None and client is None:
        cb_error = "Central Brain is not configured; label saved locally only"
    updated = store.update_feedback(body.alert_id, body.feedback, body.feedback_type)
    return {
        "message": cb_message if not cb_error else "saved locally",
        "alert": _public_alert(store, updated) if updated else None,
        "central_brain_error": cb_error,
    }


# --- Media proxy ---


@app.get("/api/media/{alert_id}")
async def media(
    alert_id: str,
    store: ManifestStore = Depends(get_store),
):
    path = store.find_image(alert_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="image not cached")
    media_type = "image/jpeg"
    suffix = path.suffix.lower()
    if suffix == ".png":
        media_type = "image/png"
    elif suffix == ".webp":
        media_type = "image/webp"
    elif suffix == ".gif":
        media_type = "image/gif"
    return FileResponse(path, media_type=media_type)


# --- Export ---


@app.get("/api/export/preview")
async def export_preview(
    dataset_id: str | None = None,
    alert_rule_id: str | None = None,
    feedback: str | None = None,
    from_timestamp: int | None = None,
    to_timestamp: int | None = None,
    labeled_only: bool = True,
    limit: int = Query(10, ge=1, le=50),
    store: ManifestStore = Depends(get_store),
) -> dict[str, Any]:
    dataset = _resolve_dataset(
        store,
        dataset_id=dataset_id,
        alert_rule_id=alert_rule_id,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
    )
    rows = build_manifest_rows(
        store,
        alert_rule_id=dataset.get("alert_rule_id"),
        feedback=feedback,
        from_timestamp=dataset.get("from_timestamp"),
        to_timestamp=dataset.get("to_timestamp"),
        labeled_only=labeled_only,
    )
    return {
        "dataset": _public_dataset(dataset),
        "filename": export_filename(dataset),
        "count": len(rows),
        "label_mix": label_mix(rows),
        "sample": [_public_alert(store, row) for row in rows[:limit]],
        "data_dir": str(store.path.parent.resolve()),
        "dataset_stats": dataset.get("stats"),
    }


@app.get("/api/export/download")
async def export_download(
    dataset_id: str | None = None,
    alert_rule_id: str | None = None,
    feedback: str | None = None,
    from_timestamp: int | None = None,
    to_timestamp: int | None = None,
    labeled_only: bool = True,
    store: ManifestStore = Depends(get_store),
):
    dataset = _resolve_dataset(
        store,
        dataset_id=dataset_id,
        alert_rule_id=alert_rule_id,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
    )
    payload = build_export_zip(
        store,
        dataset=dataset,
        feedback=feedback,
        labeled_only=labeled_only,
    )
    filename = export_filename(dataset)
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "Trends ML Data BFF",
        "docs": "/docs",
        "health": "/api/health",
    }
