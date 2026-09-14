from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from .client import CentralBrainClient, CentralBrainError
from .collect import collect_alerts, poll_rule_ready
from .config import Settings, get_settings
from .export import build_export_zip, build_manifest_rows, label_mix
from .schemas import CollectRequest, FeedbackRequest, UpdateRuleStatusRequest
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
    return ManifestStore(settings.manifest_path, settings.images_dir)


def get_client(settings: Settings = Depends(get_settings)) -> CentralBrainClient:
    if not settings.configured:
        raise HTTPException(
            status_code=503,
            detail=(
                "Central Brain is not configured. Set "
                "CENTRAL_BRAIN_INTERNAL_BASE_URL and "
                "CENTRAL_BRAIN_INTERNAL_API_KEY in .env"
            ),
        )
    return CentralBrainClient(settings)


@app.on_event("startup")
def ensure_data_dirs() -> None:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.images_dir.mkdir(parents=True, exist_ok=True)


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
        "central_brain_reachable": False,
        "central_brain_error": None,
    }
    if settings.configured:
        try:
            client = CentralBrainClient(settings)
            await client.ping()
            result["central_brain_reachable"] = True
        except CentralBrainError as exc:
            result["central_brain_error"] = exc.message
        except Exception as exc:  # noqa: BLE001
            result["central_brain_error"] = str(exc)
    return result


@app.get("/api/stats")
async def stats(store: ManifestStore = Depends(get_store)) -> dict[str, Any]:
    return store.stats()


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
    client: CentralBrainClient = Depends(get_client),
) -> dict[str, Any]:
    return await client.list_rules(
        page=page, size=size, search=search, status=status, get_category=True
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
    rule_id = created.get("id")
    rule: dict[str, Any] | None = None
    if rule_id and wait_for_preprocess:
        rule = await poll_rule_ready(client, rule_id)
    elif rule_id:
        rule = await client.get_rule(rule_id, get_category=True)

    return {"message": created.get("message", "alert rule created"), "id": rule_id, "rule": rule}


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
    return await client.count_alerts(
        alert_rule_id=alert_rule_id,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
    )


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
    return await collect_alerts(
        client,
        store,
        alert_rule_id=body.alert_rule_id,
        from_timestamp=body.from_timestamp,
        to_timestamp=body.to_timestamp,
        page_size=body.page_size,
        download_images=body.download_images,
    )


@app.get("/api/dataset/alerts")
async def dataset_alerts(
    alert_rule_id: str | None = None,
    feedback: str | None = None,
    unlabeled_only: bool = False,
    from_timestamp: int | None = None,
    to_timestamp: int | None = None,
    store: ManifestStore = Depends(get_store),
) -> dict[str, Any]:
    rows = store.list(
        alert_rule_id=alert_rule_id,
        feedback=feedback,
        unlabeled_only=unlabeled_only,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
    )
    # Attach media URL for UI (proxied) when local image exists
    enriched = []
    for row in rows:
        item = dict(row)
        alert_id = row.get("alert_id")
        if alert_id and store.find_image(alert_id):
            item["media_url"] = f"/api/media/{alert_id}"
        else:
            item["media_url"] = None
        # Never expose remote media URL construction advice; keep original path opaque
        enriched.append(item)
    return {"count": len(enriched), "alerts": enriched}


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
    client: CentralBrainClient = Depends(get_client),
    store: ManifestStore = Depends(get_store),
) -> dict[str, Any]:
    result = await client.submit_feedback(
        body.alert_id, body.feedback, body.feedback_type
    )
    updated = store.update_feedback(body.alert_id, body.feedback, body.feedback_type)
    return {
        "message": result.get("message", "feedback submitted successfully"),
        "alert": updated,
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
    alert_rule_id: str | None = None,
    feedback: str | None = None,
    from_timestamp: int | None = None,
    to_timestamp: int | None = None,
    labeled_only: bool = True,
    limit: int = Query(10, ge=1, le=50),
    store: ManifestStore = Depends(get_store),
) -> dict[str, Any]:
    rows = build_manifest_rows(
        store,
        alert_rule_id=alert_rule_id,
        feedback=feedback,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
        labeled_only=labeled_only,
    )
    return {
        "count": len(rows),
        "label_mix": label_mix(rows),
        "sample": rows[:limit],
        "data_dir": str(store.path.parent.resolve()),
    }


@app.get("/api/export/download")
async def export_download(
    alert_rule_id: str | None = None,
    feedback: str | None = None,
    from_timestamp: int | None = None,
    to_timestamp: int | None = None,
    labeled_only: bool = True,
    store: ManifestStore = Depends(get_store),
):
    payload = build_export_zip(
        store,
        alert_rule_id=alert_rule_id,
        feedback=feedback,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
        labeled_only=labeled_only,
    )
    return Response(
        content=payload,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="trends-ml-dataset.zip"'
        },
    )


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "Trends ML Data BFF",
        "docs": "/docs",
        "health": "/api/health",
    }
