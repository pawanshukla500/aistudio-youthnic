import logging
from typing import Dict, Any, List
from database import get_db

logger = logging.getLogger(__name__)


class LearningOptimizationAgent:
    """Stores verified generation outcomes, extracts reusable generation rules,

    and updates learning outcomes for continuous quality and cost optimization.
    """

    def record_approved_outcome(
        self,
        org_id: str,
        sku_id: str,
        rule_type: str,
        rule_text: str,
        positive_guidance: str,
        negative_constraints: List[str],
    ):
        try:
            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO public.learning_outcomes (
                            organization_id, sku_id, rule_type, rule_text,
                            positive_guidance, negative_constraints, effectiveness_score,
                            usage_count, success_count, is_active, approved
                        ) VALUES (%s, %s, %s, %s, %s, %s, 1.0, 1, 1, true, true)
                        ON CONFLICT DO NOTHING
                        """,
                        (org_id, sku_id, rule_type, rule_text, positive_guidance, negative_constraints),
                    )
                    logger.info(f"Recorded approved learning rule for {sku_id}: {rule_type}")
        except Exception as e:
            logger.warning(f"Could not record learning outcome: {e}")

    def update_rule_effectiveness(self, rule_id: str, success: bool):
        try:
            with get_db() as conn:
                with conn.cursor() as cur:
                    delta = 1 if success else 0
                    cur.execute(
                        """
                        UPDATE public.learning_outcomes
                        SET usage_count = usage_count + 1,
                            success_count = success_count + %s,
                            effectiveness_score = ROUND((success_count + %s)::numeric / (usage_count + 1)::numeric, 2),
                            updated_at = now()
                        WHERE id = %s
                        """,
                        (delta, delta, rule_id),
                    )
        except Exception as e:
            logger.warning(f"Could not update rule effectiveness: {e}")
