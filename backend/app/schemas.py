from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CreateRuleRequest(BaseModel):
    category_id: str
    query_text: str | None = None
    description: str | None = None
    severity: Literal["low", "medium", "high", "critical"] | None = "medium"
    status: Literal["active", "paused"] = "active"
    camera_ids: list[str] = Field(default_factory=list)
    wait_for_preprocess: bool = True


class UpdateRuleStatusRequest(BaseModel):
    status: Literal["active", "paused"]


class CollectRequest(BaseModel):
    alert_rule_id: str
    from_timestamp: int
    to_timestamp: int
    page_size: int = 50
    download_images: bool = True


class FeedbackRequest(BaseModel):
    alert_id: str
    feedback: Literal["like", "dislike", "neutral"]
    feedback_type: Literal["user", "system"] = "user"


class ExportRequest(BaseModel):
    alert_rule_id: str | None = None
    feedback: str | None = None
    from_timestamp: int | None = None
    to_timestamp: int | None = None
    labeled_only: bool = True
