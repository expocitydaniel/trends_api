from __future__ import annotations

from typing import Any

import httpx

from .config import Settings


class CentralBrainError(Exception):
    def __init__(self, status_code: int, message: str, detail: Any = None):
        self.status_code = status_code
        self.message = message
        self.detail = detail
        super().__init__(message)


class CentralBrainClient:
    """Thin authenticated client for Central Brain /internal Trends APIs."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.central_brain_internal_base_url.rstrip("/")
        self._headers = {
            "X-INTERNAL-API-KEY": settings.central_brain_internal_api_key,
        }

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers=self._headers,
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        files: Any = None,
        data: Any = None,
    ) -> Any:
        clean_params = self._flatten_params(params or {})
        async with self._client() as client:
            response = await client.request(
                method,
                path,
                params=clean_params,
                json=json,
                files=files,
                data=data,
            )
        if response.status_code >= 400:
            detail: Any
            try:
                detail = response.json()
                message = (
                    detail.get("message")
                    if isinstance(detail, dict)
                    else str(detail)
                ) or response.text
            except Exception:
                detail = response.text
                message = response.text or f"HTTP {response.status_code}"
            raise CentralBrainError(response.status_code, message, detail)
        if response.status_code == 204 or not response.content:
            return None
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        return response.content

    @staticmethod
    def _flatten_params(params: dict[str, Any]) -> list[tuple[str, Any]]:
        items: list[tuple[str, Any]] = []
        for key, value in params.items():
            if value is None:
                continue
            if isinstance(value, (list, tuple)):
                for item in value:
                    if item is not None:
                        items.append((key, item))
            else:
                items.append((key, value))
        return items

    # --- Health ---

    async def ping(self) -> bool:
        """Best-effort reachability check via categories count."""
        await self.count_categories()
        return True

    # --- Categories ---

    async def count_categories(
        self, *, search: str | None = None, category_id: list[str] | None = None
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/internal/alert_categories/count",
            params={"search": search, "category_id": category_id},
        )

    async def list_categories(
        self,
        *,
        page: int = 1,
        size: int = 50,
        search: str | None = None,
        category_id: list[str] | None = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/internal/alert_categories",
            params={
                "page": page,
                "size": size,
                "search": search,
                "category_id": category_id,
                "sort_by": sort_by,
                "sort_order": sort_order,
            },
        )

    async def get_category(self, alert_category_id: str) -> dict[str, Any]:
        return await self._request(
            "GET", f"/internal/alert_category/{alert_category_id}"
        )

    # --- Rules ---

    async def create_rule(
        self,
        *,
        category_id: str,
        query_text: str | None = None,
        image_path: str | None = None,
        description: str | None = None,
        severity: str | None = None,
        status: str = "active",
        camera_ids: list[str] | None = None,
        camera_group_ids: list[str] | None = None,
        cluster_ids: list[str] | None = None,
        poly_coords: list[str] | None = None,
        alert_rule_id: str | None = None,
        file_bytes: bytes | None = None,
        file_name: str | None = None,
        file_content_type: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "alert_rule_type": "trends",
            "category_id": category_id,
            "query_text": query_text,
            "image_path": image_path,
            "description": description,
            "severity": severity,
            "status": status,
            "camera_ids": camera_ids,
            "camera_group_ids": camera_group_ids,
            "cluster_ids": cluster_ids,
            "poly_coords": poly_coords,
            "alert_rule_id": alert_rule_id,
        }
        if file_bytes is not None:
            files = {
                "file": (
                    file_name or "reference.jpg",
                    file_bytes,
                    file_content_type or "image/jpeg",
                )
            }
            return await self._request(
                "POST", "/internal/alert_rule", params=params, files=files
            )
        return await self._request("POST", "/internal/alert_rule", params=params)

    async def count_rules(
        self,
        *,
        search: str | None = None,
        camera_id: str | None = None,
        severity: str | None = None,
        status: str | None = None,
        category_id: list[str] | None = None,
        is_preprocessed: bool | None = None,
        is_deleted: bool = False,
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/internal/alert_rules/count",
            params={
                "alert_rule_type": "trends",
                "search": search,
                "camera_id": camera_id,
                "severity": severity,
                "status": status,
                "category_id": category_id,
                "is_preprocessed": is_preprocessed,
                "is_deleted": is_deleted,
            },
        )

    async def list_rules(
        self,
        *,
        page: int = 1,
        size: int = 50,
        search: str | None = None,
        camera_id: str | None = None,
        severity: str | None = None,
        status: str | None = None,
        category_id: list[str] | None = None,
        is_preprocessed: bool | None = None,
        is_deleted: bool = False,
        get_category: bool = True,
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/internal/alert_rules",
            params={
                "alert_rule_type": "trends",
                "page": page,
                "size": size,
                "search": search,
                "camera_id": camera_id,
                "severity": severity,
                "status": status,
                "category_id": category_id,
                "is_preprocessed": is_preprocessed,
                "is_deleted": is_deleted,
                "get_category": get_category,
            },
        )

    async def get_rule(
        self, alert_rule_id: str, *, get_category: bool = True
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/internal/alert_rule/{alert_rule_id}",
            params={"get_category": get_category},
        )

    async def update_rule(
        self, alert_rule_id: str, **fields: Any
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"alert_rule_type": "trends"}
        for key, value in fields.items():
            if value is None:
                continue
            params[key] = value
        return await self._request(
            "PUT", f"/internal/alert_rule/{alert_rule_id}", params=params
        )

    # --- Alerts ---

    async def count_alerts(
        self,
        *,
        alert_rule_id: str,
        from_timestamp: int,
        to_timestamp: int,
        camera_id: list[str] | None = None,
        category_id: list[str] | None = None,
        status: list[str] | None = None,
        severity: list[str] | None = None,
        is_deleted: bool = False,
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/internal/alerts/count",
            params={
                "alert_rule_type": "trends",
                "alert_rule_id": alert_rule_id,
                "from_timestamp": from_timestamp,
                "to_timestamp": to_timestamp,
                "camera_id": camera_id,
                "category_id": category_id,
                "status": status,
                "severity": severity,
                "is_deleted": is_deleted,
            },
        )

    async def list_alerts(
        self,
        *,
        alert_rule_id: str,
        from_timestamp: int,
        to_timestamp: int,
        page: int = 1,
        size: int = 50,
        camera_id: list[str] | None = None,
        category_id: list[str] | None = None,
        status: list[str] | None = None,
        severity: list[str] | None = None,
        is_deleted: bool = False,
        sort_by: str = "recency",
        sort_order: str = "desc",
        get_category: bool = True,
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/internal/alerts",
            params={
                "alert_rule_type": "trends",
                "alert_rule_id": alert_rule_id,
                "from_timestamp": from_timestamp,
                "to_timestamp": to_timestamp,
                "page": page,
                "size": size,
                "camera_id": camera_id,
                "category_id": category_id,
                "status": status,
                "severity": severity,
                "is_deleted": is_deleted,
                "sort_by": sort_by,
                "sort_order": sort_order,
                "get_category": get_category,
            },
        )

    async def get_alert(
        self,
        alert_rule_id: str,
        document_id: str,
        *,
        get_category: bool = True,
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/internal/alert/{alert_rule_id}/{document_id}",
            params={"get_category": get_category},
        )

    async def get_hits(self, alert_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/internal/alerts/{alert_id}/hits")

    async def submit_feedback(
        self,
        alert_id: str,
        feedback: str,
        feedback_type: str = "user",
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/internal/alerts/feedback",
            json={
                "alert_feedbacks": [
                    {
                        "alert_id": alert_id,
                        "feedback": feedback,
                        "feedback_type": feedback_type,
                    }
                ]
            },
        )

    # --- Cameras ---

    async def list_cameras(
        self,
        *,
        page: int = 1,
        size: int = 50,
        camera_id: list[str] | None = None,
        enabled_trvision: bool = True,
        is_deleted: bool = False,
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/internal/cameras",
            params={
                "page": page,
                "size": size,
                "camera_id": camera_id,
                "enabled_trvision": enabled_trvision,
                "is_deleted": is_deleted,
            },
        )

    async def get_camera(self, camera_id: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/internal/camera/{camera_id}",
            params={
                "get_vms": False,
                "get_user_groups": False,
                "get_users": False,
                "get_camera_groups": False,
            },
        )

    # --- Media (no API key) ---

    async def download_image(self, image_url: str) -> tuple[bytes, str]:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            response = await client.get(image_url)
        if response.status_code >= 400:
            raise CentralBrainError(
                response.status_code,
                f"media fetch failed: HTTP {response.status_code}",
            )
        content_type = response.headers.get("content-type", "image/jpeg")
        return response.content, content_type
