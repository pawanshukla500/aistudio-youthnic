import hashlib
import logging
import re
from typing import Dict, Any, List
from database import search_knowledge_embeddings, get_db
from cache import get_memory_rules_cache, set_memory_rules_cache
from services.ai_clients import embed_text

logger = logging.getLogger(__name__)


class KnowledgeMemoryAgent:
    """Retrieves relevant fashion knowledge base rules, learned patterns,

    and prior approved corrections using hybrid vector and metadata search.
    """

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        org_id = state.get("organization_id") or ""
        dna = state.get("product_dna", {})
        category = dna.get("category", "ethnic/fusion")
        garment_family = dna.get("garment_family", "kurta_or_kurti_set")
        bottom_cut = dna.get("bottom_wear", {}).get("cut_class", "")
        main_color = dna.get("main_color", "")
        cache_sig = hashlib.sha256(
            f"{category}|{garment_family}|{bottom_cut}|{main_color}".encode("utf-8")
        ).hexdigest()[:20]

        if not state.get("force_refresh"):
            cached_rules = get_memory_rules_cache(org_id or "global", cache_sig)
            if cached_rules:
                return {"retrieved_guidance": cached_rules}

        guidance_rules: List[str] = []
        db_ok = True

        # 1. Fetch category guidance & pgvector embeddings scoped to caller organization (+ global null rows)
        try:
            query_text = f"{garment_family} {category} {bottom_cut} {main_color}".strip()
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
                            if not rule:
                                continue
                            lower_rule = f"{l.get('rule_text') or ''} {rule}".lower()
                            positive_clauses = re.sub(
                                r"\b(?:strictly\s+)?(?:no|not|without|never)\s+(?:pants|palazzos?|shararas?|salwars?|trousers?|bottoms?)\b",
                                "",
                                lower_rule,
                            )
                            if any(tok in lower_rule for tok in ("farshi", "farsi", "fasi")) and bottom_cut != "farshi":
                                continue
                            if garment_family == "saree" and any(tok in positive_clauses for tok in ("palazzo", "sharara", "salwar", "trouser")):
                                continue
                            if garment_family != "saree" and "saree" in positive_clauses and "kurti" not in positive_clauses:
                                continue
                            if rule not in guidance_rules:
                                guidance_rules.append(rule)
        except Exception as e:
            db_ok = False
            logger.warning(f"Error querying fashion knowledge DB: {e}")

        # Fallback / deterministic guardrails if DB rules are empty
        if bottom_cut == "farshi" and not any("farshi" in g.lower() for g in guidance_rules):
            guidance_rules.append(
                "Farshi Pajama / Salwar: Maintain distinct two-leg construction with waist and side-joint pleats, "
                "a hem that is quite narrow from the waist side, and a 6-inch joined hem panel tapering 4 inches inward from the upper hem seam. "
                "Prohibit open palazzos, skirts, or gathered salwar ponchas."
            )

        guidance_rules.append(
            "Style Reference Isolation: Copy only the backdrop set and lighting. 100% discard style reference outfit."
        )
        guidance_rules.append(
            "Anatomical Integrity: Exactly two visible arms and two hands connected to continuous forearms."
        )

        if db_ok and guidance_rules:
            set_memory_rules_cache(org_id or "global", cache_sig, guidance_rules)

        return {
            "retrieved_guidance": guidance_rules,
        }
