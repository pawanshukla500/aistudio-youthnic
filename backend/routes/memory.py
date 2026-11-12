from typing import Dict, Any
from fastapi import APIRouter, Body, Depends, HTTPException
from auth import verify_internal_secret
from database import search_knowledge_embeddings
from agents.learning_agent import LearningOptimizationAgent
from agents.correction_agent import CorrectionAgent

router = APIRouter(
    prefix="/api/v1/memory",
    tags=["Knowledge & Memory"],
    dependencies=[Depends(verify_internal_secret)],
)
learning_agent = LearningOptimizationAgent()
correction_agent = CorrectionAgent()


@router.post("/search")
def search_memory(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Hybrid search across fashion knowledge embeddings and learning outcomes."""
    org_id = str(payload.get("organization_id") or "").strip()
    if not org_id:
        raise HTTPException(status_code=400, detail="organization_id is required")
    category = payload.get("category", "ethnic/fusion")
    embedding = payload.get("embedding")
    limit = int(payload.get("limit", 5))

    results = search_knowledge_embeddings(
        category=category,
        organization_id=org_id,
        query_embedding=embedding,
        limit=limit,
    )
    return {"category": category, "results_count": len(results), "matches": results}


@router.post("/feedback")
def record_user_feedback(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Captures human review corrections and promotes verified learning rules."""
    org_id = str(payload.get("organization_id") or "").strip()
    if not org_id:
        raise HTTPException(status_code=400, detail="organization_id is required")
    sku_id = payload.get("sku_id", "general")
    job_id = payload.get("job_id", "")
    generation_id = payload.get("generation_id", "")
    pose_index = int(payload.get("pose_index", 1))
    rule_type = payload.get("rule_type", "bottom_wear_preservation")
    specific_mismatch = payload.get("specific_mismatch", "")
    guidance = payload.get("guidance", "")
    negative_constraints = payload.get("negative_constraints", [])
    category = str(payload.get("category") or "ethnic/fusion")

    # Record correction in history
    correction_agent.record_correction(
        org_id=org_id,
        job_id=job_id,
        generation_id=generation_id,
        sku_id=sku_id,
        pose_index=pose_index,
        stage="qa_evaluation",
        mismatch=specific_mismatch,
        action="human_override",
    )

    # Promote to reusable learning rule
    learning_agent.record_approved_outcome(
        org_id=org_id,
        sku_id=sku_id,
        rule_type=rule_type,
        rule_text=specific_mismatch,
        positive_guidance=guidance,
        negative_constraints=negative_constraints,
        category=category,
    )

    return {"status": "feedback_recorded", "promoted_rule_type": rule_type}

