from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Body, Depends
from auth import verify_internal_secret
from agents.qa_agent import ComputerVisionQAAgent
from database import get_db

router = APIRouter(
    prefix="/api/v1/qa",
    tags=["Computer Vision QA"],
    dependencies=[Depends(verify_internal_secret)],
)
qa_agent = ComputerVisionQAAgent()


@router.post("/evaluate")
async def evaluate_image_qa(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Runs region-based visual QA evaluation against authoritative Product DNA."""
    org_id = payload.get("organization_id", "7d56360f-2c96-4eb2-923e-f22b7fe36605")
    job_id = payload.get("job_id", "adhoc_job")
    generation_id = payload.get("generation_id", "adhoc_gen")
    sku_id = payload.get("sku_id", "adhoc_sku")
    pose_index = int(payload.get("pose_index", 1))
    pose_type = payload.get("pose_type", "full_front")
    image_url = payload.get("image_url", "")
    dna = payload.get("product_dna", {})

    evaluation = qa_agent.evaluate(
        org_id=org_id,
        job_id=job_id,
        generation_id=generation_id,
        sku_id=sku_id,
        pose_index=pose_index,
        pose_type=pose_type,
        image_url=image_url,
        product_dna=dna,
        ai_raw_evaluation=payload.get("ai_raw_evaluation"),
        reference_images=payload.get("references"),
    )

    return {
        "status": "evaluated",
        "outcome": evaluation.outcome,
        "overall_score": evaluation.overall_score,
        "product_fidelity_score": evaluation.product_fidelity_score,
        "anatomical_defect_detected": evaluation.anatomical_defect_detected,
        "style_quarantine_violation": evaluation.style_quarantine_violation,
        "bottom_cut_mismatch": evaluation.bottom_cut_mismatch,
        "pose_requirement_failed": evaluation.pose_requirement_failed,
        "failed_checks": evaluation.failed_checks,
        "scores": evaluation.scores,
        "correction_guidance": evaluation.correction_guidance,
    }


@router.get("/{generation_id}")
async def get_qa_history(generation_id: str) -> Dict[str, Any]:
    """Retrieves QA assessment history and scores for a specific generated frame."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM public.qa_assessments
                WHERE generation_id = %s
                ORDER BY created_at DESC
                """,
                (generation_id,),
            )
            rows = cur.fetchall()

    return {"generation_id": generation_id, "assessments_count": len(rows), "assessments": rows}
