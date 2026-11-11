import logging
from typing import Dict, Any, Tuple
from database import get_db

logger = logging.getLogger(__name__)


class CorrectionAgent:
    """Diagnoses root cause of QA rejection and determines whether to perform

    a targeted prompt repair, re-enqueue single pose regeneration, or escalate to human review.
    """

    def decide_action(
        self,
        pose_index: int,
        attempt_count: int,
        failed_checks: list[str],
        guidance: str,
        anatomical_defect: bool,
        style_violation: bool,
    ) -> Tuple[str, str]:
        """Returns: (action, updated_instruction)

        action: 'regenerate', 'human_review', or 'escalate'
        """
        if attempt_count >= 3:
            return "human_review", "Maximum automated attempts reached. Escalated to human review."

        instructions = []
        if anatomical_defect:
            instructions.append(
                "STRICT ANATOMY FIX: Strictly exactly two arms and two hands connected to continuous forearms. "
                "Eliminate any floating hand, third limb, or duplicate wrist."
            )
        if style_violation:
            instructions.append(
                "STYLE QUARANTINE FIX: Discard clothing from style reference. "
                "Dress model strictly in uploaded product references."
            )
        if "bottom_wear" in failed_checks:
            instructions.append(
                "BOTTOM WEAR SILHOUETTE FIX: Maintain authentic two-leg Farshi salwar with vertical gathers "
                "and joined hem panel. Do not produce palazzo or skirt."
            )
        if "front_back_design" in failed_checks:
            instructions.append(
                "REAR PURITY FIX: Adhere exclusively to direct back photo. "
                "Do not mirror front neckline or front embellishments onto back."
            )
        if "pose_requirement" in failed_checks:
            instructions.append(
                "POSE FOCUS FIX: Highlight primary garment craftsmanship (kurti butti/embroidery). "
                "Do not focus on secondary accessories."
            )

        refinement = " | ".join(instructions) if instructions else guidance
        return "regenerate", refinement

    def record_correction(
        self,
        org_id: str,
        job_id: str,
        generation_id: str,
        sku_id: str,
        pose_index: int,
        stage: str,
        mismatch: str,
        action: str,
    ):
        try:
            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO public.correction_history (
                            organization_id, job_id, generation_id, sku_id, pose_index,
                            root_cause_stage, specific_mismatch, attempted_action, resolution
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending')
                        """,
                        (org_id, job_id, generation_id, sku_id, pose_index, stage, mismatch, action),
                    )
        except Exception as e:
            logger.warning(f"Could not record correction history: {e}")
