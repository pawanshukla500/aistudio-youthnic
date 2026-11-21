from typing import TypedDict, List, Dict, Optional, Any


class AgentWorkflowState(TypedDict, total=False):
    """Product DNA V2 graph state (POST /api/v1/dna/extract): evidence, then DNA."""

    organization_id: str
    sku_id: str
    sku_name: str

    # Garment metadata & extraction parameters
    category: str
    garment_family: str
    main_color: str
    secondary_colors: List[str]
    fabric_type: str
    allow_local_references: bool
    force_refresh: bool
    auto_approve: bool
    vision_timeout_seconds: Optional[float]

    # Reference evidence & DNA
    references: List[Dict[str, Any]]
    source_fingerprint: str
    seed_analysis: Optional[Dict[str, Any]]
    product_dna: Optional[Dict[str, Any]]
    dna_approved: bool
    dna_persisted: bool

    status: str
    error: Optional[str]


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
