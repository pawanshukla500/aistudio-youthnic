import os
import hashlib
import pytest
from models.evidence import compute_sha256
from models.dna_v2 import ProductDNAV2, SareeArchitecture
from agents.evidence_agent import ProductEvidenceAgent
from agents.dna_agent import ProductDNAAgent
from agents.pose_planning_agent import CreativePosePlanningAgent
from agents.router_agent import GenerationRouterAgent
from agents.qa_agent import ComputerVisionQAAgent
from cache import cache_manager

DESKTOP_DIR = r"C:\Users\Pawan Shukla\Desktop\Projec Images"


VALID_ORG_UUID = "7d56360f-2c96-4eb2-923e-f22b7fe36605"


def test_desktop_saree_evidence_hashing_and_quarantine(tmp_path):
    if os.path.exists(DESKTOP_DIR):
        front_path = os.path.join(DESKTOP_DIR, "Sarees Front.jpeg")
        back_path = os.path.join(DESKTOP_DIR, "Sarees Back.jpg")
        ref_path = os.path.join(DESKTOP_DIR, "Refrence images.jpg")
        detail_path = os.path.join(DESKTOP_DIR, "Sarees product image (1).jpg")
    else:
        # Fallback fixture for headless CI environments
        front_path = str(tmp_path / "Sarees_Front.jpeg")
        back_path = str(tmp_path / "Sarees_Back.jpg")
        ref_path = str(tmp_path / "Refrence_images.jpg")
        detail_path = str(tmp_path / "Sarees_detail_1.jpg")
        for p, b in [
            (front_path, b"saree_front_sample_bytes_12345"),
            (back_path, b"saree_back_sample_bytes_12345"),
            (ref_path, b"style_ref_sample_bytes_12345"),
            (detail_path, b"saree_detail_sample_bytes_12345"),
        ]:
            with open(p, "wb") as f:
                f.write(b)

    assert os.path.exists(front_path), "Front saree image must exist"
    assert os.path.exists(back_path), "Back saree image must exist"
    assert os.path.exists(ref_path), "Style reference image must exist"
    assert os.path.exists(detail_path), "Detail saree image must exist"

    with open(front_path, "rb") as f:
        front_hash = compute_sha256(f.read())
    with open(back_path, "rb") as f:
        back_hash = compute_sha256(f.read())
    with open(ref_path, "rb") as f:
        ref_hash = compute_sha256(f.read())
    with open(detail_path, "rb") as f:
        detail_hash = compute_sha256(f.read())

    assert len(front_hash) == 64
    assert len(back_hash) == 64
    assert len(ref_hash) == 64
    assert len(detail_hash) == 64

    # Build reference payload for evidence agent
    raw_references = [
        {
            "role": "saree_front_drape",
            "storagePath": "desktop/Sarees_Front.jpeg",
            "downloadUrl": "local://" + front_path.replace("\\", "/"),
            "hash": front_hash,
        },
        {
            "role": "saree_back_drape",
            "storagePath": "desktop/Sarees_Back.jpg",
            "downloadUrl": "local://" + back_path.replace("\\", "/"),
            "hash": back_hash,
        },
        {
            "role": "saree_pallu_spread",
            "storagePath": "desktop/Sarees_detail_1.jpg",
            "downloadUrl": "local://" + detail_path.replace("\\", "/"),
            "hash": detail_hash,
        },
        {
            "role": "style_reference",
            "storagePath": "desktop/Refrence_images.jpg",
            "downloadUrl": "local://" + ref_path.replace("\\", "/"),
            "hash": ref_hash,
        },
    ]

    sku_id = "SKU-SAREE-DESKTOP-001"
    evidence_agent = ProductEvidenceAgent()
    evidence_out = evidence_agent.process({
        "organization_id": VALID_ORG_UUID,
        "sku_id": sku_id,
        "allow_local_references": True,
        "references": raw_references,
    })

    assert "source_fingerprint" in evidence_out
    assert len(evidence_out["references"]) == 4

    # Style reference must be quarantined
    style_ref = next(r for r in evidence_out["references"] if r["role"] == "style_reference")
    assert style_ref["is_style_quarantined"] is True
    assert style_ref["is_authoritative"] is False

    # Product shots must be authoritative
    front_ref = next(r for r in evidence_out["references"] if r["role"] == "saree_front_drape")
    assert front_ref["is_authoritative"] is True
    assert front_ref["is_style_quarantined"] is False


def test_saree_dna_extraction_and_invariants():
    sku_id = "SKU-SAREE-DESKTOP-002"
    sku_name = "Kanjivaram Silk Saree with Rich Gold Zari Pallu"
    fingerprint = "saree_fingerprint_desktop_v2_123"

    cache_manager.invalidate_hot_dna(VALID_ORG_UUID, sku_id)
    dna_agent = ProductDNAAgent()
    dna_out = dna_agent.process({
        "organization_id": VALID_ORG_UUID,
        "sku_id": sku_id,
        "sku_name": sku_name,
        "source_fingerprint": fingerprint,
        "garment_family": "saree",
        "references": [
            {"role": "saree_front_drape"},
            {"role": "saree_back_drape"},
            {"role": "saree_pallu_spread"},
            {"role": "style_reference"},
        ],
    })

    dna = dna_out["product_dna"]
    assert dna["garment_family"] == "saree"
    assert dna["bottom_wear"]["has_bottom_wear"] is False
    assert dna["bottom_wear"]["cut_class"] == "none"
    assert "trousers" in dna["prohibited_changes"]
    assert "palazzo" in dna["prohibited_changes"]
    assert "salwar" in dna["prohibited_changes"]

    # Invariants must enforce unstitched drape with no pants
    invariants_text = " ".join(dna["explicit_invariants"])
    assert "Strictly NO pants, NO palazzos, NO salwars, NO trousers" in invariants_text
    assert "Pose 5 (Detail Frame) must showcase signature pallu artwork" in invariants_text
    assert "Back view (Pose 4) must strictly mirror back product reference" in invariants_text

    # Saree architecture validation
    assert dna["saree_details"] is not None
    assert dna["saree_details"]["drape_style"] == "nivi"
    assert dna["saree_details"]["no_trousers_rule"] is True


def test_saree_pose_planning_integrity():
    dna_agent = ProductDNAAgent()
    dna_out = dna_agent.process({
        "organization_id": VALID_ORG_UUID,
        "sku_id": "SKU-SAREE-001",
        "sku_name": "Banarasi Silk Saree",
        "source_fingerprint": "fp_saree_pose_test",
        "garment_family": "saree",
        "references": [{"role": "saree_front_drape"}],
    })
    dna = dna_out["product_dna"]

    pose_agent = CreativePosePlanningAgent()
    pose_out = pose_agent.process({"product_dna": dna})
    poses = pose_out["pose_plans"]

    assert len(poses) == 6
    # Pose 1: Front Hero Drape Stance
    assert poses[0]["pose_type"] == "full_front"
    assert "Nivi" in poses[0]["description"]
    assert "NO pants" in poses[0]["prompt"]

    # Pose 3: Seated Editorial Composure
    assert poses[2]["pose_type"] == "side_seated"
    assert "fanned out" in poses[2]["prompt"]

    # Pose 4: Rear view with pallu fall
    assert poses[3]["pose_type"] == "back"
    assert "blouse back" in poses[3]["prompt"].lower()

    # Pose 5: Signature Craftsmanship Detail (Pallu / Zari Weave)
    assert poses[4]["pose_type"] == "closeup"
    assert "pallu artwork" in poses[4]["prompt"].lower()
    assert "Never hijacked by accessories" in poses[4]["prompt"]

    # Pose 6: Flowing Motion Showcase
    assert poses[5]["pose_type"] == "showcase"
    assert "fluid sweep" in poses[5]["prompt"].lower()


def test_router_agent_supports_gpt_image_2_6_family():
    router = GenerationRouterAgent()

    # Test selecting flagship gpt-image-2.6-sunburst
    route_sunburst = router.process({
        "requested_model": "gpt-image-2.6-sunburst",
        "poses_to_generate": [1, 2, 3, 4, 5, 6],
    })
    assert route_sunburst["provider_route"]["image_model"] == "gpt-image-2.6-sunburst"
    assert route_sunburst["provider_route"]["est_cost_per_pose"] == 0.18

    # Test selecting low-latency gpt-image-2.6-flare
    route_flare = router.process({
        "requested_model": "gpt-image-2.6-flare",
        "poses_to_generate": [1, 2, 3, 4, 5, 6],
    })
    assert route_flare["provider_route"]["image_model"] == "gpt-image-2.6-flare"
    assert route_flare["provider_route"]["est_cost_per_pose"] == 0.16

    # Test default fallback uses flagship gpt-image-2.6-sunburst
    route_default = router.process({
        "poses_to_generate": [1, 2, 3, 4, 5, 6],
    })
    assert route_default["provider_route"]["image_model"] == "gpt-image-2.6-sunburst"


def test_saree_qa_hard_vetos():
    qa_agent = ComputerVisionQAAgent()
    saree_dna = {
        "sku_name": "Chanderi Saree",
        "garment_family": "saree",
        "bottom_wear": {"cut_class": "none", "has_bottom_wear": False},
    }

    # 1. Clean Saree Generation with verified scores + negated bottom phrase passes QA
    clean_eval = qa_agent.evaluate(
        org_id=VALID_ORG_UUID,
        job_id="job-1",
        generation_id="gen-1",
        sku_id="SKU-SAREE-001",
        pose_index=1,
        pose_type="full_front",
        image_url="https://storage.test/saree_clean.jpg",
        product_dna=saree_dna,
        ai_raw_evaluation={
            "scores": {"garment_identity": 96.0, "colors": 95.0, "bottom_wear": 97.0},
            "checks": {"garment_identity": "pass", "colors": "pass", "bottom_wear": "pass"},
            "notes": "Authentic Nivi saree drape, neat pleats, continuous saree drape; no trousers or pants. Strictly two arms.",
        },
    )
    assert clean_eval.outcome == "pass"
    assert clean_eval.anatomical_defect_detected is False
    assert clean_eval.bottom_cut_mismatch is False

    # 1b. Incomplete QA payload (missing scores and no veto) fails closed
    incomplete_eval = qa_agent.evaluate(
        org_id=VALID_ORG_UUID,
        job_id="job-1",
        generation_id="gen-1b",
        sku_id="SKU-SAREE-001",
        pose_index=1,
        pose_type="full_front",
        image_url="https://storage.test/saree_incomplete.jpg",
        product_dna=saree_dna,
        ai_raw_evaluation={"notes": "Looks good"},
    )
    assert incomplete_eval.outcome == "retry"
    assert "unverified_qa_payload" in incomplete_eval.failed_checks

    # 2. Saree with hallucinated trousers/pants is HARD VETOED
    trouser_eval = qa_agent.evaluate(
        org_id=VALID_ORG_UUID,
        job_id="job-1",
        generation_id="gen-2",
        sku_id="SKU-SAREE-001",
        pose_index=1,
        pose_type="full_front",
        image_url="https://storage.test/saree_with_pants.jpg",
        product_dna=saree_dna,
        ai_raw_evaluation={
            "notes": "Model is wearing fitted trousers under a short draped fabric. Incorrect garment construction.",
        },
    )
    assert trouser_eval.outcome in ["retry", "fail"]
    assert trouser_eval.bottom_cut_mismatch is True

    # 3. Saree with anatomical defect (3 arms/hands) is HARD VETOED
    arm_eval = qa_agent.evaluate(
        org_id=VALID_ORG_UUID,
        job_id="job-1",
        generation_id="gen-3",
        sku_id="SKU-SAREE-001",
        pose_index=2,
        pose_type="angled",
        image_url="https://storage.test/saree_phantom_arm.jpg",
        product_dna=saree_dna,
        ai_raw_evaluation={
            "notes": "Model has a third hand resting on hip while holding pallu.",
        },
    )
    assert arm_eval.outcome == "fail"
    assert arm_eval.anatomical_defect_detected is True

    # 4. Pose 5 accessory hijack is rejected
    hijack_eval = qa_agent.evaluate(
        org_id=VALID_ORG_UUID,
        job_id="job-1",
        generation_id="gen-4",
        sku_id="SKU-SAREE-001",
        pose_index=5,
        pose_type="closeup",
        image_url="https://storage.test/saree_dupatta_focus.jpg",
        product_dna=saree_dna,
        ai_raw_evaluation={
            "notes": "Accessory hijack with generic jewellery and dupatta focus instead of primary saree pallu.",
        },
    )
    assert hijack_eval.outcome in ["retry", "fail"]
    assert hijack_eval.pose_requirement_failed is True


def test_farshi_taper_rule_isolated_from_non_farshi_and_top_only():
    dna_agent = ProductDNAAgent()
    farshi_dna = dna_agent._build_from_vlm(
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "magenta",
            "bottom_wear": {"has_bottom_wear": True, "cut_class": "farshi"},
        },
        org_id=VALID_ORG_UUID,
        sku_id="FARSHI-01",
        sku_name="MAGENTA-FARSHI-SET",
        fingerprint="fp-farshi",
        is_saree=False,
        references=[{"role": "front"}, {"role": "bottom"}],
        provider="meta",
        model="muse-spark-1.2-contributor",
    )
    palazzo_dna = dna_agent._build_from_vlm(
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "ivory",
            "bottom_wear": {"has_bottom_wear": True, "cut_class": "palazzo"},
        },
        org_id=VALID_ORG_UUID,
        sku_id="PALAZZO-01",
        sku_name="IVORY-PALAZZO-SET",
        fingerprint="fp-palazzo",
        is_saree=False,
        references=[{"role": "front"}, {"role": "bottom"}],
        provider="meta",
        model="muse-spark-1.2-contributor",
    )
    assert farshi_dna.bottom_wear.cut_class == "farshi"
    assert palazzo_dna.bottom_wear.cut_class == "palazzo"

    planner = CreativePosePlanningAgent()
    farshi_poses = planner.process({"product_dna": farshi_dna.model_dump()})["pose_plans"]
    palazzo_poses = planner.process({"product_dna": palazzo_dna.model_dump()})["pose_plans"]
    assert "tapering 4 inches inward from the upper hem seam" in farshi_poses[0]["prompt"]
    assert "narrow from the waist side" in farshi_poses[0]["prompt"]
    assert "farshi" not in palazzo_poses[0]["prompt"].lower()
    assert "tapering 4 inches inward" not in palazzo_poses[0]["prompt"]

    from agents.correction_agent import CorrectionAgent

    ca = CorrectionAgent()
    _, palazzo_fix = ca.decide_action(1, 1, ["bottom_wear"], "bottom wrong", False, False, bottom_cut="palazzo")
    _, farshi_fix = ca.decide_action(1, 1, ["bottom_wear"], "bottom wrong", False, False, bottom_cut="farshi")
    _, top_only_fix = ca.decide_action(1, 1, ["bottom_wear"], "Remove invented matching trousers", False, False, bottom_cut="none")
    assert "palazzo" in palazzo_fix.lower()
    assert "farshi" not in palazzo_fix.lower()
    assert "4 inches inward" not in palazzo_fix.lower()
    assert "4 inches inward" in farshi_fix.lower()
    assert "standalone" in top_only_fix.lower()
    assert "saree drape" not in top_only_fix.lower()

    # Negative-Farshi classification string & unresolved cut stay isolated
    neg_farshi_dna = dna_agent._build_from_vlm(
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "ivory",
            "bottom_wear": {"has_bottom_wear": True, "cut_class": "palazzo", "classification": "Palazzo, not Farshi"},
        },
        org_id=VALID_ORG_UUID,
        sku_id="PALAZZO-NEG",
        sku_name="IVORY-PALAZZO",
        fingerprint="fp-pal-neg",
        is_saree=False,
        references=[{"role": "front"}, {"role": "bottom"}],
        provider="meta",
        model="muse-spark-1.2-contributor",
    )
    assert neg_farshi_dna.bottom_wear.cut_class == "palazzo"

    unknown_dna = dna_agent._build_from_vlm(
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "ivory",
            "bottom_wear": {"has_bottom_wear": True, "cut_class": "unknown"},
        },
        org_id=VALID_ORG_UUID,
        sku_id="UNKNOWN-01",
        sku_name="IVORY-SET",
        fingerprint="fp-unk",
        is_saree=False,
        references=[{"role": "front"}, {"role": "bottom"}],
        provider="meta",
        model="muse-spark-1.2-contributor",
    )
    assert unknown_dna.bottom_wear.cut_class == "unknown"
