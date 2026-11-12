import logging
import re
from typing import Dict, Any, List, Optional
from models.qa import QAAgentEvaluation
from models.evidence import PRODUCT_AUTHORITY_ROLES
from database import save_qa_assessment
from services.ai_clients import invoke_vision_json, load_reference_image

logger = logging.getLogger(__name__)


def _trailing_clause(text: str, pos: int) -> str:
    """Return the immediate preceding clause bounded by punctuation or contrast conjunctions."""
    prefix = text[max(0, pos - 60):pos].lower()
    return re.split(r"[.,;!?]|\b(?:but|however|although|though)\b", prefix)[-1]


def detect_anatomical_defect(text_feedback: str) -> bool:
    """Regex pattern matching for extra hands, phantom limbs, or duplicate wrists."""
    if not text_feedback:
        return False
    pattern = r"\b(?:(?:three|3|extra|duplicate|phantom|floating|third|missing|detached)\s+(?:[a-z]+\s+)?(?:hands?|arms?|limbs?|wrists?)|(?:severed\s+limb)|(?:extra|fused|malformed|detached|six|6)\s+(?:[a-z]+\s+)?fingers?)\b"
    for match in re.finditer(pattern, text_feedback, re.IGNORECASE):
        clause = _trailing_clause(text_feedback, match.start())
        if (
            not re.search(r"\bnot\s+(?:free\s+of|without)\b", clause)
            and re.search(r"\b(?:no|zero|without|neither|never|free\s+of|not)\b", clause)
        ):
            continue
        return True
    return False


def _has_affirmative_term(text: str, terms: List[str]) -> bool:
    """Check if any forbidden garment term appears affirmatively (not negated in the same clause)."""
    if not text:
        return False
    for term in terms:
        for match in re.finditer(rf"\b{re.escape(term)}\b", text, re.IGNORECASE):
            clause = _trailing_clause(text, match.start())
            if (
                not re.search(r"\bnot\s+(?:free\s+of|without)\b", clause)
                and re.search(r"\b(?:no|zero|without|neither|never|not|rather\s+than|instead\s+of|free\s+of)\b", clause)
            ):
                continue
            return True
    return False


def _build_qa_prompt(pose_index: int, pose_type: str, product_dna: Dict[str, Any]) -> str:
    family = product_dna.get("garment_family", "kurta_or_kurti_set")
    bottom_cut = (product_dna.get("bottom_wear") or {}).get("cut_class", "straight")
    main_color = product_dna.get("main_color", "unknown")
    invariants = "; ".join(product_dna.get("explicit_invariants") or [])
    return f"""You are a strict AI Fashion Photography Computer Vision QA Auditor.
IMAGE 1 is the GENERATED catalog image for Pose {pose_index} ({pose_type}).
Remaining images are the AUTHORITATIVE PRODUCT REFERENCES for SKU "{product_dna.get('sku_name', '')}" (family={family}, main_color={main_color}, bottom_cut={bottom_cut}).
Invariants: {invariants}

Evaluate strictly:
1. ANATOMY: Does the model have strictly exactly 2 arms and 2 hands connected naturally? Any extra/third/floating hand or 6 fingers is an immediate defect.
2. PRODUCT FIDELITY: Does color, fabric, pattern/butti geometry, neckline, and embroidery match authoritative product references?
3. BOTTOM WEAR: For Saree -> unstitched drape ONLY, zero trousers/palazzos. For Farshi -> two-leg pleated salwar with joined hem (not tubular palazzo or circular skirt).
4. POSE 5 ({pose_type}): If closeup, does it frame primary garment craft rather than secondary dupatta/accessory hijack?
5. STYLE QUARANTINE: Did the model copy clothing from a backdrop/style reference instead of the uploaded product?

Reply with STRICT JSON only:
{{
  "scores": {{
    "model_face": 0-100,
    "face_realism": 0-100,
    "garment_identity": 0-100,
    "colors": 0-100,
    "fabric_texture": 0-100,
    "print_pattern": 0-100,
    "pattern_geometry": 0-100,
    "embroidery_geometry": 0-100,
    "bottom_wear": 0-100,
    "front_back_design": 0-100,
    "styling_continuity": 0-100,
    "pose_requirement": 0-100
  }},
  "checks": {{
    "model_face": "pass"|"fail",
    "garment_identity": "pass"|"fail",
    "colors": "pass"|"fail",
    "bottom_wear": "pass"|"fail",
    "front_back_design": "pass"|"fail",
    "pose_requirement": "pass"|"fail"
  }},
  "anatomical_defect": true|false,
  "style_quarantine_violation": true|false,
  "notes": "detailed objective visual findings and any defect explanation"
}}"""


class ComputerVisionQAAgent:
    """Rigorous region-based visual QA evaluator with VLM comparison, anatomical veto, and style quarantine enforcement."""

    def _run_live_vlm_qa(
        self,
        pose_index: int,
        pose_type: str,
        image_url: str,
        product_dna: Dict[str, Any],
        reference_images: Optional[List[Dict[str, Any]]],
        org_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        generated_img = load_reference_image(
            {"role": f"generated_pose_{pose_index}", "download_url": image_url},
            organization_id=org_id,
        )
        if not generated_img:
            return {"_missing_image": True}

        images = [generated_img]
        authority_count = 0
        style_refs: List[Dict[str, Any]] = []
        for ref in (reference_images or []):
            role = str(ref.get("role") or "")
            if role in PRODUCT_AUTHORITY_ROLES:
                loaded_ref = load_reference_image(ref, organization_id=org_id)
                if loaded_ref:
                    images.append(loaded_ref)
                    authority_count += 1
            elif role == "style_reference":
                style_refs.append(ref)
            if len(images) >= 4:
                break
        if authority_count == 0:
            logger.warning("No authoritative product reference images loaded for live VLM QA")
            return None
        if style_refs and len(images) < 5:
            loaded_style = load_reference_image(style_refs[0], organization_id=org_id)
            if loaded_style:
                images.append(loaded_style)

        prompt = _build_qa_prompt(pose_index, pose_type, product_dna)
        try:
            res = invoke_vision_json(prompt, images, purpose="qa")
        except Exception as exc:
            logger.warning(f"Live VLM QA provider invocation failed: {exc}")
            return None
        if not res or not isinstance(res.get("data"), dict):
            return None
        data = res["data"]
        raw_scores = data.get("scores")
        raw_checks = data.get("checks")
        required_keys = {"garment_identity", "colors", "bottom_wear"}
        if (
            not isinstance(raw_scores, dict)
            or not isinstance(raw_checks, dict)
            or not required_keys.issubset(raw_scores.keys())
            or not required_keys.issubset(raw_checks.keys())
        ):
            logger.warning("Live VLM QA returned incomplete critical scores/checks")
            return None
        for k, v in raw_scores.items():
            try:
                num = float(v)
                if not (0.0 <= num <= 100.0):
                    return None
            except (TypeError, ValueError):
                return None
        return data

    def evaluate(
        self,
        org_id: str,
        job_id: str,
        generation_id: str,
        sku_id: str,
        pose_index: int,
        pose_type: str,
        image_url: str,
        product_dna: Dict[str, Any],
        ai_raw_evaluation: Optional[Dict[str, Any]] = None,
        reference_images: Optional[List[Dict[str, Any]]] = None,
    ) -> QAAgentEvaluation:
        ai_data: Dict[str, Any] = ai_raw_evaluation if ai_raw_evaluation is not None else {}

        if ai_raw_evaluation is None:
            if not image_url:
                evaluation = QAAgentEvaluation(
                    overall_score=0.0,
                    product_fidelity_score=0.0,
                    scores={"garment_identity": 0.0, "pose_requirement": 0.0},
                    checks={"garment_identity": "fail", "pose_requirement": "fail"},
                    failed_checks=["missing_generated_image"],
                    review_recommended=True,
                    outcome="retry",
                    correction_guidance="Generated pose image URL missing; regenerate frame before QA.",
                )
                return evaluation

            live_result = self._run_live_vlm_qa(
                pose_index, pose_type, image_url, product_dna, reference_images, org_id=org_id
            )
            if live_result and live_result.get("_missing_image"):
                return QAAgentEvaluation(
                    overall_score=0.0,
                    product_fidelity_score=0.0,
                    scores={"garment_identity": 0.0},
                    checks={"garment_identity": "fail"},
                    failed_checks=["unreadable_generated_image"],
                    review_recommended=True,
                    outcome="retry",
                    requires_human_review=True,
                    correction_guidance="Could not download generated image for QA comparison.",
                )
            if live_result is None:
                return QAAgentEvaluation(
                    overall_score=0.0,
                    product_fidelity_score=0.0,
                    scores={"garment_identity": 0.0},
                    checks={"garment_identity": "fail"},
                    failed_checks=["qa_vision_unavailable"],
                    review_recommended=True,
                    outcome="retry",
                    requires_human_review=True,
                    correction_guidance="No Vision LLM provider succeeded for automated CV QA; escalate or retry.",
                )
            ai_data = live_result

        raw_scores = ai_data.get("scores")
        notes = str(ai_data.get("notes") or ai_data.get("reason") or "")
        anatomical_defect = detect_anatomical_defect(notes) or bool(ai_data.get("anatomical_defect", False))

        style_violation = bool(ai_data.get("style_quarantine_violation", False))
        if _has_affirmative_term(notes, ["style reference clothing", "copied reference outfit"]):
            style_violation = True

        bottom_cut = (product_dna.get("bottom_wear") or {}).get("cut_class", "")
        is_saree = str(product_dna.get("garment_family", "")).lower() == "saree"
        bottom_cut_mismatch = False
        pose_hijack = pose_type == "closeup" and _has_affirmative_term(notes, ["dupatta focus", "accessory hijack"])

        if isinstance(raw_scores, dict) and raw_scores:
            scores = {k: float(v) for k, v in raw_scores.items()}
            checks = dict(ai_data.get("checks") or {k: ("pass" if float(v) >= 90 else "fail") for k, v in scores.items()})
        elif anatomical_defect or style_violation or pose_hijack or bool(ai_data.get("bottom_cut_mismatch")) or (
            is_saree and _has_affirmative_term(notes, ["trousers", "pants", "palazzo", "salwar", "churidar", "jeans"])
        ) or (
            bottom_cut == "farshi" and _has_affirmative_term(notes, ["palazzo", "skirt", "circular flare"])
        ):
            # Explicit hard-veto fixture/override without scores dict
            scores = {"garment_identity": 40.0 if (anatomical_defect or style_violation) else 80.0, "bottom_wear": 45.0}
            checks = {"garment_identity": "fail" if (anatomical_defect or style_violation) else "pass", "bottom_wear": "pass"}
        else:
            # Fail closed when scores are absent or malformed
            return QAAgentEvaluation(
                overall_score=0.0,
                product_fidelity_score=0.0,
                scores={"garment_identity": 0.0},
                checks={"garment_identity": "fail"},
                failed_checks=["unverified_qa_payload"],
                review_recommended=True,
                outcome="retry",
                requires_human_review=True,
                correction_guidance=notes or "Incomplete QA scores payload; cannot approve without verified scores.",
            )

        if is_saree and pose_type in ["full_front", "angled", "side_seated", "back", "showcase"]:
            if _has_affirmative_term(notes, ["trousers", "pants", "palazzo", "salwar", "churidar", "jeans"]):
                bottom_cut_mismatch = True
                checks["bottom_wear"] = "fail"
                scores["bottom_wear"] = min(float(scores.get("bottom_wear", 40.0)), 40.0)
        elif bottom_cut == "farshi" and pose_type in ["full_front", "angled", "back", "showcase"]:
            if _has_affirmative_term(notes, ["palazzo", "skirt", "circular flare"]):
                bottom_cut_mismatch = True
                checks["bottom_wear"] = "fail"
                scores["bottom_wear"] = min(float(scores.get("bottom_wear", 55.0)), 55.0)

        pose_failed = False
        if pose_type == "closeup":
            if _has_affirmative_term(notes, ["dupatta focus", "accessory hijack"]):
                pose_failed = True
                checks["pose_requirement"] = "fail"
                scores["pose_requirement"] = min(float(scores.get("pose_requirement", 50.0)), 50.0)

        guidance = notes if (anatomical_defect or style_violation or bottom_cut_mismatch or pose_failed or any(v == "fail" for v in checks.values())) else (notes or "Approved listing grade")

        evaluation = QAAgentEvaluation.evaluate_gates(
            scores=scores,
            checks=checks,
            anatomical_defect=anatomical_defect,
            style_quarantine_violation=style_violation,
            bottom_cut_mismatch=bottom_cut_mismatch,
            pose_failed=pose_failed,
            guidance=guidance,
        )

        try:
            save_qa_assessment(
                org_id=org_id,
                job_id=job_id,
                generation_id=generation_id,
                sku_id=sku_id,
                pose_index=pose_index,
                pose_type=pose_type,
                overall_score=evaluation.overall_score,
                product_fidelity_score=evaluation.product_fidelity_score,
                scores=evaluation.scores,
                checks=evaluation.checks,
                failed_checks=evaluation.failed_checks,
                anatomical_defect=evaluation.anatomical_defect_detected,
                style_violation=evaluation.style_quarantine_violation,
                review_recommended=evaluation.review_recommended,
                outcome=evaluation.outcome,
                correction_guidance=evaluation.correction_guidance,
            )
        except Exception as e:
            logger.warning(f"Could not save QA assessment to DB: {e}")

        return evaluation
