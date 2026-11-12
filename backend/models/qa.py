from typing import Dict, List, Optional, Literal
from pydantic import BaseModel, Field


class QACheckResult(BaseModel):
    name: str
    score: float = Field(..., ge=0.0, le=100.0)
    passed: bool
    notes: Optional[str] = None


class QAAgentEvaluation(BaseModel):
    overall_score: float = Field(..., ge=0.0, le=100.0)
    product_fidelity_score: float = Field(..., ge=0.0, le=100.0)
    scores: Dict[str, float] = Field(default_factory=dict)
    checks: Dict[str, str] = Field(default_factory=dict)
    failed_checks: List[str] = Field(default_factory=list)

    # Core Behavioral Guardrails
    anatomical_defect_detected: bool = False
    style_quarantine_violation: bool = False
    bottom_cut_mismatch: bool = False
    pose_requirement_failed: bool = False

    review_recommended: bool = False
    outcome: Literal["pass", "retry", "fail", "unverified"]
    correction_guidance: str = ""
    requires_human_review: bool = False

    @classmethod
    def evaluate_gates(
        cls,
        scores: Dict[str, float],
        checks: Dict[str, str],
        anatomical_defect: bool,
        style_quarantine_violation: bool,
        bottom_cut_mismatch: bool,
        pose_failed: bool,
        guidance: str = "",
    ) -> "QAAgentEvaluation":
        failed_checks = [k for k, v in checks.items() if v.lower() == "fail"]
        avg_score = sum(scores.values()) / max(1, len(scores)) if scores else 0.0

        # SKU fidelity weighted checks
        critical_keys = [
            "garment_identity", "colors", "print_pattern", "pattern_geometry",
            "embroidery_geometry", "bottom_wear", "front_back_design"
        ]
        crit_scores = [scores[k] for k in critical_keys if k in scores]
        fidelity_score = sum(crit_scores) / max(1, len(crit_scores)) if crit_scores else avg_score

        # Strict veto rules:
        # 1. Any anatomical defect (extra hand/limb, floating hand) is an automatic hard VETO.
        # 2. Style reference outfit copied onto model is an automatic hard VETO.
        # 3. Farshi replaced with palazzo or flat skirt is a hard VETO on bottom-visible poses.
        # 4. Critical check score below 90 fails automatic pass.
        critical_below_90 = any(scores.get(k, 100) < 90 for k in critical_keys)
        is_hard_veto = (
            anatomical_defect
            or style_quarantine_violation
            or bottom_cut_mismatch
            or pose_failed
            or any(scores.get(k, 100) < 60 for k in critical_keys)
        )

        if is_hard_veto:
            outcome = "fail" if (anatomical_defect or style_quarantine_violation) else "retry"
            review = True
        elif critical_below_90:
            outcome = "pass" if fidelity_score >= 90 else "retry"
            review = True
        elif fidelity_score >= 95 and avg_score >= 90 and not failed_checks:
            outcome = "pass"
            review = False
        elif fidelity_score >= 90:
            outcome = "pass"
            review = True
        else:
            outcome = "retry"
            review = True

        return cls(
            overall_score=round(avg_score, 1),
            product_fidelity_score=round(fidelity_score, 1),
            scores=scores,
            checks=checks,
            failed_checks=failed_checks,
            anatomical_defect_detected=anatomical_defect,
            style_quarantine_violation=style_quarantine_violation,
            bottom_cut_mismatch=bottom_cut_mismatch,
            pose_requirement_failed=pose_failed,
            review_recommended=review,
            outcome=outcome,
            correction_guidance=guidance,
            requires_human_review=review,
        )
