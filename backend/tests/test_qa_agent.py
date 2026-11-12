import pytest
from agents.qa_agent import ComputerVisionQAAgent, detect_anatomical_defect
from models.qa import QAAgentEvaluation


def test_detect_anatomical_defect_regex():
    assert detect_anatomical_defect("Model has three hands holding the saree") is True
    assert detect_anatomical_defect("Extra floating hand on the waist") is True
    assert detect_anatomical_defect("Model has duplicate wrists") is True
    assert detect_anatomical_defect("Six fingers visible on left hand") is True
    assert detect_anatomical_defect("Naturally posed with zero extra hands") is False
    assert detect_anatomical_defect("Clean catalog pose without phantom limbs") is False


def test_qa_agent_hard_veto_on_anatomical_defect():
    agent = ComputerVisionQAAgent()
    eval_res = agent.evaluate(
        org_id="org_test",
        job_id="job_test",
        generation_id="gen_test",
        sku_id="sku_test",
        pose_index=1,
        pose_type="full_front",
        image_url="http://example.com/image.jpg",
        product_dna={"bottom_wear": {"cut_class": "straight"}},
        ai_raw_evaluation={"notes": "A third hand is resting on the hip"},
    )
    assert eval_res.anatomical_defect_detected is True
    assert eval_res.outcome == "fail"
    assert eval_res.review_recommended is True


def test_qa_agent_veto_on_style_reference_copy():
    agent = ComputerVisionQAAgent()
    eval_res = agent.evaluate(
        org_id="org_test",
        job_id="job_test",
        generation_id="gen_test",
        sku_id="sku_test",
        pose_index=1,
        pose_type="full_front",
        image_url="http://example.com/image.jpg",
        product_dna={"bottom_wear": {"cut_class": "straight"}},
        ai_raw_evaluation={"notes": "Model is wearing the white gown from style reference clothing instead of kurti"},
    )
    assert eval_res.style_quarantine_violation is True
    assert eval_res.outcome == "fail"


def test_qa_agent_veto_on_farshi_palazzo_substitution():
    agent = ComputerVisionQAAgent()
    eval_res = agent.evaluate(
        org_id="org_test",
        job_id="job_test",
        generation_id="gen_test",
        sku_id="sku_test",
        pose_index=1,
        pose_type="full_front",
        image_url="http://example.com/image.jpg",
        product_dna={"bottom_wear": {"cut_class": "farshi"}},
        ai_raw_evaluation={"notes": "The bottom trousers are rendered as wide open palazzo rather than farshi gathers"},
    )
    assert eval_res.bottom_cut_mismatch is True
    assert eval_res.outcome == "retry"
    assert eval_res.scores["bottom_wear"] < 60.0


def test_qa_agent_fail_closed_on_incomplete_payload():
    agent = ComputerVisionQAAgent()
    eval_res = agent.evaluate(
        org_id="org_test",
        job_id="job_test",
        generation_id="gen_incomplete",
        sku_id="sku_test",
        pose_index=1,
        pose_type="full_front",
        image_url="http://example.com/image.jpg",
        product_dna={"garment_family": "saree", "bottom_wear": {"cut_class": "none"}},
        ai_raw_evaluation={"notes": "Clean image without score breakdown"},
    )
    assert eval_res.outcome == "retry"
    assert eval_res.requires_human_review is True
    assert "unverified_qa_payload" in eval_res.failed_checks


def test_qa_agent_negated_bottom_terms_do_not_trigger_veto():
    agent = ComputerVisionQAAgent()
    eval_res = agent.evaluate(
        org_id="org_test",
        job_id="job_test",
        generation_id="gen_negated",
        sku_id="sku_test",
        pose_index=1,
        pose_type="full_front",
        image_url="http://example.com/image.jpg",
        product_dna={"garment_family": "saree", "bottom_wear": {"cut_class": "none"}},
        ai_raw_evaluation={
            "scores": {"garment_identity": 96.0, "colors": 96.0, "bottom_wear": 95.0},
            "checks": {"garment_identity": "pass", "colors": "pass", "bottom_wear": "pass"},
            "notes": "Continuous saree drape; no trousers or pants visible.",
        },
    )
    assert eval_res.bottom_cut_mismatch is False
    assert eval_res.outcome == "pass"


def test_qa_agent_not_free_of_defect_phrase_still_vetoes():
    agent = ComputerVisionQAAgent()
    eval_res = agent.evaluate(
        org_id="org_test",
        job_id="job_test",
        generation_id="gen_not_free_of",
        sku_id="sku_test",
        pose_index=1,
        pose_type="full_front",
        image_url="http://example.com/image.jpg",
        product_dna={"garment_family": "saree", "bottom_wear": {"cut_class": "none"}},
        ai_raw_evaluation={
            "scores": {"garment_identity": 96.0, "colors": 96.0, "bottom_wear": 95.0},
            "checks": {"garment_identity": "pass", "colors": "pass", "bottom_wear": "pass"},
            "notes": "Bottom area is not free of trousers under the drape.",
        },
    )
    assert eval_res.bottom_cut_mismatch is True
    assert eval_res.outcome in ("retry", "fail")

