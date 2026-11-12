import logging
from typing import Dict, Any, List
from database import search_knowledge_embeddings, get_db
from services.ai_clients import embed_text

logger = logging.getLogger(__name__)


class KnowledgeMemoryAgent:
    """Retrieves relevant fashion knowledge base rules, learned patterns,

    and prior approved corrections using hybrid vector and metadata search.
    """

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        org_id = state.get("organization_id")
        dna = state.get("product_dna", {})
        category = dna.get("category", "ethnic/fusion")
        garment_family = dna.get("garment_family", "kurta_or_kurti_set")
        bottom_cut = dna.get("bottom_wear", {}).get("cut_class", "")

        guidance_rules: List[str] = []

        # 1. Fetch category guidance & pgvector embeddings scoped to caller organization (+ global null rows)
        try:
            query_text = f"{garment_family} {category} {bottom_cut} {dna.get('main_color', '')}".strip()
            vec = embed_text(query_text)
            if vec:
                vec_matches = search_knowledge_embeddings(
                    category=category,
                    organization_id=org_id,
                    query_embedding=vec,
                    limit=3,
                )
                for m in vec_matches:
                    if m.get("content") and m["content"] not in guidance_rules:
                        guidance_rules.append(m["content"])

            with get_db() as conn:
                with conn.cursor() as cur:
                    if org_id:
                        cur.execute(
                            """
                            SELECT guidance FROM public.fashion_knowledge_base
                            WHERE is_active = true
                              AND (organization_id IS NULL OR organization_id = %s::uuid)
                              AND (category = %s OR category = 'general' OR guidance ILIKE %s)
                            LIMIT 3
                            """,
                            (org_id, category, f"%{bottom_cut}%" if bottom_cut else "%ethnic%"),
                        )
                    else:
                        cur.execute(
                            """
                            SELECT guidance FROM public.fashion_knowledge_base
                            WHERE is_active = true
                              AND organization_id IS NULL
                              AND (category = %s OR category = 'general' OR guidance ILIKE %s)
                            LIMIT 3
                            """,
                            (category, f"%{bottom_cut}%" if bottom_cut else "%ethnic%"),
                        )
                    rows = cur.fetchall()
                    for r in rows:
                        if r.get("guidance"):
                            guidance_rules.append(r["guidance"])

                    if org_id:
                        cur.execute(
                            """
                            SELECT rule_text, positive_guidance FROM public.learning_outcomes
                            WHERE is_active = true AND approved = true AND organization_id = %s::uuid
                            ORDER BY effectiveness_score DESC LIMIT 3
                            """,
                            (org_id,),
                        )
                        learnings = cur.fetchall()
                        for l in learnings:
                            rule = l.get("positive_guidance") or l.get("rule_text")
                            if rule and rule not in guidance_rules:
                                guidance_rules.append(rule)
        except Exception as e:
            logger.warning(f"Error querying fashion knowledge DB: {e}")

        # Fallback / deterministic guardrails if DB rules are empty
        if bottom_cut == "farshi" and not any("farshi" in g.lower() for g in guidance_rules):
            guidance_rules.append(
                "Farshi Pajama / Salwar: Maintain distinct two-leg construction with vertical gathers from waist "
                "down to wide flared joined hem. Prohibit palazzos, skirts, or gathered salwar ponchas."
            )

        guidance_rules.append(
            "Style Reference Isolation: Copy only the backdrop set and lighting. 100% discard style reference outfit."
        )
        guidance_rules.append(
            "Anatomical Integrity: Exactly two visible arms and two hands connected to continuous forearms."
        )

        return {
            "retrieved_guidance": guidance_rules,
        }
