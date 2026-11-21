import logging
from typing import Annotated, Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints

from auth import verify_internal_secret
from graph import run_pose_planning
from services.sentry_telemetry import capture_sentry_exception

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1",
    tags=["Pose Planning"],
    dependencies=[Depends(verify_internal_secret)],
)


class PosePlanRequest(BaseModel):
    """posePlanningGraphPayload (lib/posePlanning.ts). reference_pose/expression_plan keep camelCase keys."""

    organization_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    # Stripped before the length check, so a whitespace-only key is a 422, not a graph failure (503).
    thread_key: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]
    pose_family: str = Field(default="", max_length=80)
    bottom_cut_class: str = Field(default="", max_length=80)
    # Informational only (analyze_references keeps 80 chars): generous bounds so a real analysis never 422s.
    garment_family: str = Field(default="", max_length=1000)
    category: str = Field(default="", max_length=1000)
    showcase_feature_region: str = Field(default="", max_length=80)
    showcase_shot_type: str = Field(default="", max_length=80)
    sit_requested: bool = False
    closeup_mode: str = Field(default="", max_length=80)
    reference_pose: Dict[str, Any] = Field(default_factory=dict)
    expression_plan: Dict[str, Any] = Field(default_factory=dict)
    pose_expressions: Dict[str, Optional[str]] = Field(default_factory=dict)
    local_plan: Dict[str, Any] = Field(default_factory=dict)


@router.post("/plan")
def plan_poses(request: PosePlanRequest) -> Dict[str, Any]:
    """Reference-led pose & expression planning graph (sync handler: FastAPI runs it in its threadpool)."""
    try:
        return run_pose_planning(request.model_dump())
    except Exception as exc:
        logger.exception("Pose planning graph failed")
        capture_sentry_exception(exc, tags={"http_path": "/api/v1/plan"})
        raise HTTPException(status_code=503, detail="Pose planning graph failed")
