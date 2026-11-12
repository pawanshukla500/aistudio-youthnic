from typing import TypedDict, List, Dict, Optional, Any


class AgentWorkflowState(TypedDict, total=False):
    organization_id: str
    sku_id: str
    sku_name: str
    job_id: str
    session_id: str

    # Reference evidence & DNA
    references: List[Dict[str, Any]]
    source_fingerprint: str
    product_dna: Optional[Dict[str, Any]]
    dna_approved: bool

    # Knowledge & Scene Planning
    retrieved_guidance: List[str]
    scene_lock: Optional[Dict[str, Any]]
    model_lock: Optional[Dict[str, Any]]
    pose_plans: List[Dict[str, Any]]

    # Execution & Poses
    current_pose_index: int
    poses_to_generate: List[int]
    generated_poses: Dict[int, Dict[str, Any]]
    qa_target_image_url: Optional[str]
    qa_pose_index: int
    qa_pose_type: str
    ai_raw_evaluation: Optional[Dict[str, Any]]
    qa_evaluations: Dict[int, Dict[str, Any]]
    corrections: List[Dict[str, Any]]
    correction_decision: Optional[str]
    updated_instruction: Optional[str]
    force_refresh: bool
    auto_approve: bool

    # Telemetry & Reliability
    provider_route: Dict[str, Any]
    budget_used_usd: float
    max_budget_usd: float
    retry_counts: Dict[int, int]
    status: str
    error: Optional[str]
    requires_human_review: bool
