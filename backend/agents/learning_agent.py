import hashlib
import json
import logging
from typing import Dict, Any, List
from database import get_db
from services.ai_clients import embed_text

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
        category: str = "ethnic/fusion",
    ):
        try:
            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT id FROM public.learning_outcomes
                        WHERE organization_id = %s AND sku_id IS NOT DISTINCT FROM %s AND rule_type = %s AND rule_text = %s
                        LIMIT 1
                        """,
                        (org_id, sku_id, rule_type, rule_text),
                    )
                    existing = cur.fetchone()
                    if existing:
                        cur.execute(
                            """
                            UPDATE public.learning_outcomes
                            SET positive_guidance = %s,
                                negative_constraints = %s,
                                success_count = success_count + 1,
                                usage_count = usage_count + 1,
                                updated_at = now()
                            WHERE id = %s
                            """,
                            (positive_guidance, negative_constraints, existing["id"]),
                        )
                    else:
                        cur.execute(
                            """
                            INSERT INTO public.learning_outcomes (
                                organization_id, sku_id, rule_type, rule_text,
                                positive_guidance, negative_constraints, effectiveness_score,
                                usage_count, success_count, is_active, approved
                            ) VALUES (%s, %s, %s, %s, %s, %s, 1.0, 1, 1, true, true)
                            """,
                            (org_id, sku_id, rule_type, rule_text, positive_guidance, negative_constraints),
                        )
                    logger.info(f"Recorded approved learning rule for {sku_id}: {rule_type}")

                    emb_content = f"{rule_type}: {rule_text}. Guidance: {positive_guidance}"
                    vec = embed_text(emb_content)
                    if vec:
                        src_hash = hashlib.sha256(f"{org_id}:{sku_id}:{rule_type}:{rule_text}".encode()).hexdigest()
                        cur.execute(
                            """
                            INSERT INTO public.knowledge_embeddings (
                                organization_id, category, sub_category, content, embedding, source_hash, metadata
                            ) VALUES (%s, %s, %s, %s, %s::vector, %s, %s)
                            ON CONFLICT (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), category, source_hash)
                            DO UPDATE SET
                                content = EXCLUDED.content,
                                embedding = EXCLUDED.embedding,
                                metadata = EXCLUDED.metadata
                            """,
                            (
                                org_id,
                                category or "ethnic/fusion",
                                rule_type,
                                emb_content,
                                vec,
                                src_hash,
                                json.dumps({"sku_id": sku_id, "negative_constraints": negative_constraints}),
                            ),
                        )
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
