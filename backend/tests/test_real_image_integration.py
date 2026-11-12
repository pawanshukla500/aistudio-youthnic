import logging
import pytest
from database import get_db, get_latest_dna_version
from cache import cache_manager
from agents.evidence_agent import ProductEvidenceAgent
from agents.dna_agent import ProductDNAAgent
from agents.pose_planning_agent import CreativePosePlanningAgent
from agents.qa_agent import ComputerVisionQAAgent
from agents.correction_agent import CorrectionAgent
from agents.learning_agent import LearningOptimizationAgent

logger = logging.getLogger(__name__)


def test_real_sku_image_pipeline_and_qa_fidelity():
    org_id = "7d56360f-2c96-4eb2-923e-f22b7fe36605"
    sku_id = "T62-Peppa-Purple"
    sku_name = "T62-Peppa-Purple Farshi Suit"

    # 1. Fetch real production reference images for this SKU from DB when DATABASE_URL is configured
    real_references = []
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT job_data FROM public.generation_jobs
                    WHERE org_id = %s AND sku_name = %s AND status = 'completed'
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (org_id, sku_id),
                )
                job = cur.fetchone()
                if job and job.get("job_data"):
                    raw_refs = job["job_data"].get("references", [])
                    for r in raw_refs:
                        real_references.append({
                            "role": r.get("role"),
                            "storagePath": r.get("storagePath"),
                            "downloadUrl": r.get("downloadUrl"),
                        })
    except RuntimeError:
        logger.info("DATABASE_URL not set; using synthetic fallback references for unit test.")

    if not real_references:
        # Fallback to authentic schema references
        real_references = [
            {"role": "front", "downloadUrl": "https://firebasestorage.googleapis.com/v0/b/ai-studio-app-be068.firebasestorage.app/o/front.jpg", "hash": "h_front"},
            {"role": "bottom", "downloadUrl": "https://firebasestorage.googleapis.com/v0/b/ai-studio-app-be068.firebasestorage.app/o/bottom.jpg", "hash": "h_bottom"},
            {"role": "back", "downloadUrl": "https://firebasestorage.googleapis.com/v0/b/ai-studio-app-be068.firebasestorage.app/o/back.jpg", "hash": "h_back"},
            {"role": "style_reference", "downloadUrl": "https://firebasestorage.googleapis.com/v0/b/ai-studio-app-be068.firebasestorage.app/o/style.jpg", "hash": "h_style"},
            {"role": "model_identity", "downloadUrl": "https://firebasestorage.googleapis.com/v0/b/ai-studio-app-be068.firebasestorage.app/o/model.jpg", "hash": "h_model"},
        ]

    # 2. Product Evidence Agent: Role verification and composite SHA-256 fingerprint
    evidence_agent = ProductEvidenceAgent()
    evidence_out = evidence_agent.process({
        "organization_id": org_id,
        "sku_id": sku_id,
        "references": real_references,
    })
    assert "source_fingerprint" in evidence_out
    fingerprint = evidence_out["source_fingerprint"]
    assert len(evidence_out["references"]) > 0

    # Verify style reference quarantine flag
    style_ref = next((r for r in evidence_out["references"] if r["role"] == "style_reference"), None)
    if style_ref:
        assert style_ref["is_style_quarantined"] is True
        assert style_ref["is_authoritative"] is False

    # 3. Product DNA Agent: Extract, enforce Farshi invariants and back purity
    dna_agent = ProductDNAAgent()
    dna_out = dna_agent.process({
        "organization_id": org_id,
        "sku_id": sku_id,
        "sku_name": sku_name,
        "source_fingerprint": fingerprint,
        "references": evidence_out["references"],
    })
    dna = dna_out["product_dna"]
    assert dna is not None
    assert dna["bottom_wear"]["cut_class"] == "farshi"
    assert dna["bottom_wear"]["two_leg_construction"] is True
    assert dna["bottom_wear"]["joined_hem"] is True
    assert "palazzo" in dna["prohibited_changes"]

    # 4. Cache hit on repeated extraction
    repeated_out = dna_agent.process({
        "organization_id": org_id,
        "sku_id": sku_id,
        "sku_name": sku_name,
        "source_fingerprint": fingerprint,
        "references": evidence_out["references"],
    })
    assert repeated_out["product_dna"]["source_fingerprint"] == fingerprint

    # 5. Pose Planning Agent: 6-pose plan with Pose 5 detail and Pose 6 showcase
    pose_agent = CreativePosePlanningAgent()
    pose_out = pose_agent.process({
        "product_dna": dna,
    })
    poses = pose_out["pose_plans"]
    assert len(poses) == 6

    pose5 = next(p for p in poses if p["pose_number"] == 5)
    assert pose5["pose_type"] == "closeup"
    assert "craftsmanship" in pose5["title"].lower()

    pose6 = next(p for p in poses if p["pose_number"] == 6)
    assert pose6["pose_type"] == "showcase"

    # 6. Computer Vision QA Agent: Test passing vs deliberate defect rejection
    qa_agent = ComputerVisionQAAgent()

    # Case A: High quality listing-grade output -> PASS
    eval_pass = qa_agent.evaluate(
        org_id=org_id,
        job_id="job_real_test",
        generation_id="gen_real_pass",
        sku_id=sku_id,
        pose_index=1,
        pose_type="full_front",
        image_url="http://mock.url/pass.jpg",
        product_dna=dna,
        ai_raw_evaluation={
            "scores": {"garment_identity": 98.0, "colors": 96.0, "bottom_wear": 97.0},
            "checks": {"garment_identity": "pass", "bottom_wear": "pass"},
        },
    )
    assert eval_pass.outcome == "pass"

    # Case B: Deliberate anatomical defect (extra hand) -> HARD VETO
    eval_hand = qa_agent.evaluate(
        org_id=org_id,
        job_id="job_real_test",
        generation_id="gen_real_defect_hand",
        sku_id=sku_id,
        pose_index=2,
        pose_type="angled",
        image_url="http://mock.url/extra_hand.jpg",
        product_dna=dna,
        ai_raw_evaluation={
            "notes": "A floating third hand is resting on the salwar drape",
        },
    )
    assert eval_hand.anatomical_defect_detected is True
    assert eval_hand.outcome == "fail"

    # Case C: Farshi replaced by Palazzo -> VETO & RETRY
    eval_palazzo = qa_agent.evaluate(
        org_id=org_id,
        job_id="job_real_test",
        generation_id="gen_real_defect_palazzo",
        sku_id=sku_id,
        pose_index=1,
        pose_type="full_front",
        image_url="http://mock.url/palazzo.jpg",
        product_dna=dna,
        ai_raw_evaluation={
            "notes": "Bottom wear rendered as a wide tubular palazzo without farshi gathers or joined hem",
        },
    )
    assert eval_palazzo.bottom_cut_mismatch is True
    assert eval_palazzo.outcome == "retry"

    # 7. Correction Agent: Diagnoses root cause & issues targeted guidance
    correction_agent = CorrectionAgent()
    action, guidance = correction_agent.decide_action(
        pose_index=1,
        attempt_count=1,
        failed_checks=eval_palazzo.failed_checks,
        guidance=eval_palazzo.correction_guidance,
        anatomical_defect=False,
        style_violation=False,
    )
    assert action == "regenerate"
    assert "BOTTOM WEAR SILHOUETTE FIX" in guidance

    # 8. Learning Optimization Agent: Promotes verified guidance
    learning_agent = LearningOptimizationAgent()
    learning_agent.record_approved_outcome(
        org_id=org_id,
        sku_id=sku_id,
        rule_type="bottom_wear_preservation",
        rule_text="Farshi salwar requires vertical pleats and joined hem",
        positive_guidance=guidance,
        negative_constraints=["palazzo", "circular_skirt"],
    )
