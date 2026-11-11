from typing import List, Dict, Optional, Literal, Any
from pydantic import BaseModel, Field


PoseType = Literal[
    "full_front",
    "angled",
    "side_seated",
    "back",
    "closeup",
    "showcase",
]

ImageQuality = Literal["low", "medium", "high"]


class PoseDefinition(BaseModel):
    pose_number: int = Field(..., ge=1, le=6)
    pose_type: PoseType
    title: str
    description: str
    framing: str
    camera_angle: str
    hand_placement: str = "natural catalog pose, exactly two visible hands connected to forearms"
    highlighted_details: List[str] = Field(default_factory=list)
    product_visibility_rules: List[str] = Field(default_factory=list)
    prompt: Optional[str] = None
    enabled: bool = True


class GenerationJobSubmit(BaseModel):
    organization_id: str
    sku_id: str
    sku_name: str
    quality: ImageQuality = "medium"
    aspect_ratio: str = "3:4"
    image_size: str = "1024x1365"
    pose_qa: bool = True
    poses_to_generate: List[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6])
    bottom_wear_mode: Optional[str] = None
    product_details: Optional[str] = None
    requested_model: Optional[str] = None
    background_style: Optional[str] = "Auto from references"
    extra_instructions: Optional[str] = None


class PoseGenerationRecord(BaseModel):
    generation_id: str
    session_id: str
    pose_index: int
    pose_type: str
    title: str
    status: Literal["pending", "generating", "completed", "failed", "retrying"] = "pending"
    attempt_count: int = 0
    output_url: Optional[str] = None
    storage_path: Optional[str] = None
    qa_status: Optional[str] = "unverified"
    qa_score: Optional[float] = None
    error: Optional[str] = None
    actual_cost_usd: float = 0.0


class GenerationJobStatus(BaseModel):
    job_id: str
    organization_id: str
    sku_id: str
    sku_name: str
    status: Literal["queued", "in_progress", "completed", "failed", "cancelled"]
    total_poses: int = 6
    completed_poses: int = 0
    failed_poses: int = 0
    current_pose: int = 0
    poses: List[PoseGenerationRecord] = Field(default_factory=list)
    actual_cost_usd: float = 0.0
    error_message: Optional[str] = None
