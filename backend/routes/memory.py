from typing import Dict, Any, List
from fastapi import APIRouter, Body
from database import search_knowledge_embeddings
from agents.learning_agent import LearningOptimizationAgent
from agents.correction_agent import CorrectionAgent

router = APIRouter(prefix="/api/v1/memory", tags=["Knowledge & Memory"])
learning_agent = LearningOptimizationAgent()
correction_agent = CorrectionAgent()


@router.post("/search")
async def search_memory(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Hybrid search across fashion knowledge embeddings and learning outcomes."""
    category = payload.get("category", "ethnic/fusion")
    embedding = payload.get("embedding")
    limit = int(payload.get("limit", 5))

    results = search_knowledge_embeddings(category=category, query_embedding=embedding, limit=limit)
    return {"category": category, "results_count": len(results), "matches": results}


@router.post("/feedback")
async def record_user_feedback(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Captures human review corrections and promotes verified learning rules."""
    org_id = payload.get("organization_id", "7d56360f-2c96-4eb2-923e-f22b7fe36605")
    sku_id = payload.get("sku_id", "general")
    job_id = payload.get("job_id", "")
    generation_id = payload.get("generation_id", "")
    pose_index = int(payload.get("pose_index", 1))
    rule_type = payload.get("rule_type", "bottom_wear_preservation")
    specific_mismatch = payload.get("specific_mismatch", "")
    guidance = payload.get("guidance", "")
    negative_constraints = payload.get("negative_constraints", [])

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
    )

    return {"status": "feedback_recorded", "promoted_rule_type": rule_type}
