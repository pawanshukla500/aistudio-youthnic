from typing import TypedDict, List, Dict, Optional, Any


class AgentWorkflowState(TypedDict, total=False):
    organization_id: str
    sku_id: str
    sku_name: str
    job_id: str
    session_id: str

    # Garment metadata & extraction parameters
    category: str
    garment_family: str
    main_color: str
    secondary_colors: List[str]
    fabric_type: str
    allow_local_references: bool
    extra_instructions: str
    model_identity: str
    requested_model: Optional[str]
    quality: str
    pose_qa: bool
    aspect_ratio: str
    image_size: str

    # Reference evidence & DNA
    references: List[Dict[str, Any]]
    source_fingerprint: str
    seed_analysis: Optional[Dict[str, Any]]
    product_dna: Optional[Dict[str, Any]]
    dna_approved: bool
    dna_persisted: bool

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
    vision_timeout_seconds: Optional[float]

    # Telemetry & Reliability
    provider_route: Dict[str, Any]
    budget_used_usd: float
    max_budget_usd: float
    retry_counts: Dict[int, int]
    status: str
    error: Optional[str]
    requires_human_review: bool


class PosePlanningState(TypedDict, total=False):
    """FastAPI /api/v1/plan LangGraph state (mirrors lib/posePlanning.ts)."""

    organization_id: str
    thread_key: str
    pose_family: str
    bottom_cut_class: str
    garment_family: str
    category: str
    showcase_feature_region: str
    showcase_shot_type: str
    # PosePlanningContext.sitRequested / closeupMode
    sit_requested: bool
    closeup_mode: str

    # Edge vision output (camelCase ReferencePose / ExpressionPlan) and pose texts
    reference_pose: Dict[str, Any]
    expression_plan: Dict[str, Any]
    pose_expressions: Dict[str, str]
    local_plan: Dict[str, Any]

    # Learning recall (pose_plan_outcomes)
    outcome_rows: List[Dict[str, Any]]
    learned_signals: List[Dict[str, Any]]

    # Decisions & validation
    forced_product_slots: List[str]
    slots: Dict[str, Dict[str, Any]]
    expressions: Dict[str, str]
    validation_errors: List[str]
    plan_attempts: int
    steps: List[str]
    status: str
