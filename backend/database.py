import json
import logging
from typing import Optional, Dict, Any, List, Tuple
from contextlib import contextmanager
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from config import settings

logger = logging.getLogger(__name__)

# Initialize connection pool
_pool: Optional[ConnectionPool] = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        _pool = ConnectionPool(
            conninfo=settings.DATABASE_URL,
            min_size=2,
            max_size=15,
            open=True,
            kwargs={"autocommit": True, "row_factory": dict_row},
        )
    return _pool


@contextmanager
def get_db():
    pool = get_pool()
    with pool.connection() as conn:
        yield conn


# -------------------------------------------------------------
# Product DNA V2 Queries
# -------------------------------------------------------------
def save_dna_version(
    org_id: str,
    sku_id: str,
    sku_name: str,
    dna_payload: Dict[str, Any],
    fingerprint: str,
    garment_family: str = "kurta_or_kurti_set",
    approved: bool = False,
    approved_by: Optional[str] = None,
) -> int:
    with get_db() as conn:
        with conn.cursor() as cur:
            # Find latest version
            cur.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM public.product_dna_versions WHERE organization_id = %s AND sku_id = %s",
                (org_id, sku_id),
            )
            row = cur.fetchone()
            next_ver = row["next_version"] if row else 1

            status = "approved" if approved else "draft"
            cur.execute(
                """
                INSERT INTO public.product_dna_versions (
                    organization_id, sku_id, sku_name, version, garment_family,
                    dna_payload, source_fingerprint, status, approved, approved_by, approved_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() ELSE NULL END)
                RETURNING version
                """,
                (
                    org_id, sku_id, sku_name, next_ver, garment_family,
                    json.dumps(dna_payload), fingerprint, status, approved, approved_by, approved
                ),
            )
            saved = cur.fetchone()
            return saved["version"] if saved else next_ver


def get_latest_dna_version(org_id: str, sku_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM public.product_dna_versions
                WHERE organization_id = %s AND sku_id = %s
                ORDER BY version DESC LIMIT 1
                """,
                (org_id, sku_id),
            )
            return cur.fetchone()


def list_dna_versions(org_id: str, sku_id: str) -> List[Dict[str, Any]]:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, sku_id, sku_name, version, garment_family, status, approved, approved_by, approved_at, source_fingerprint, created_at
                FROM public.product_dna_versions
                WHERE organization_id = %s AND sku_id = %s
                ORDER BY version DESC
                """,
                (org_id, sku_id),
            )
            return cur.fetchall()


def approve_dna_version(org_id: str, sku_id: str, version: int, approved_by: str) -> bool:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.product_dna_versions
                SET approved = true, status = 'approved', approved_by = %s, approved_at = now(), updated_at = now()
                WHERE organization_id = %s AND sku_id = %s AND version = %s
                """,
                (approved_by, org_id, sku_id, version),
            )
            return cur.rowcount > 0


# -------------------------------------------------------------
# Product Reference Evidence Queries
# -------------------------------------------------------------
def save_reference_evidence(
    org_id: str,
    sku_id: str,
    role: str,
    storage_path: str,
    download_url: str,
    sha256_hash: str,
    mime_type: str = "image/jpeg",
    dimensions: Optional[Dict[str, int]] = None,
    region_type: str = "general",
    confidence: float = 1.0,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.product_reference_evidence (
                    organization_id, sku_id, role, storage_path, download_url,
                    sha256_hash, mime_type, dimensions, region_type, confidence, metadata
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    org_id, sku_id, role, storage_path, download_url,
                    sha256_hash, mime_type, json.dumps(dimensions or {}),
                    region_type, confidence, json.dumps(metadata or {})
                ),
            )
            row = cur.fetchone()
            return str(row["id"]) if row else ""


def get_references_for_sku(org_id: str, sku_id: str) -> List[Dict[str, Any]]:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM public.product_reference_evidence
                WHERE organization_id = %s AND sku_id = %s
                ORDER BY created_at ASC
                """,
                (org_id, sku_id),
            )
            return cur.fetchall()


# -------------------------------------------------------------
# QA Assessments Queries
# -------------------------------------------------------------
def save_qa_assessment(
    org_id: str,
    job_id: str,
    generation_id: str,
    sku_id: str,
    pose_index: int,
    pose_type: str,
    overall_score: float,
    product_fidelity_score: float,
    scores: Dict[str, float],
    checks: Dict[str, str],
    failed_checks: List[str],
    anatomical_defect: bool,
    style_violation: bool,
    review_recommended: bool,
    outcome: str,
    correction_guidance: str = "",
    attempt_number: int = 1,
) -> str:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.qa_assessments (
                    organization_id, job_id, generation_id, sku_id, pose_index, pose_type,
                    attempt_number, overall_score, product_fidelity_score, scores, checks,
                    failed_checks, anatomical_defect_detected, style_quarantine_violation,
                    review_recommended, outcome, correction_guidance
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    org_id, job_id, generation_id, sku_id, pose_index, pose_type,
                    attempt_number, overall_score, product_fidelity_score,
                    json.dumps(scores), json.dumps(checks), failed_checks,
                    anatomical_defect, style_violation, review_recommended,
                    outcome, correction_guidance
                ),
            )
            row = cur.fetchone()
            return str(row["id"]) if row else ""


# -------------------------------------------------------------
# pgvector Knowledge Retrieval
# -------------------------------------------------------------
def search_knowledge_embeddings(
    category: str,
    query_embedding: Optional[List[float]] = None,
    limit: int = 5,
) -> List[Dict[str, Any]]:
    with get_db() as conn:
        with conn.cursor() as cur:
            if query_embedding:
                cur.execute(
                    """
                    SELECT id, category, sub_category, content, metadata,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM public.knowledge_embeddings
                    WHERE is_active = true AND (category = %s OR %s = '')
                    ORDER BY embedding <=> %s::vector ASC
                    LIMIT %s
                    """,
                    (query_embedding, category, category, query_embedding, limit),
                )
            else:
                cur.execute(
                    """
                    SELECT id, category, sub_category, content, metadata, 1.0 AS similarity
                    FROM public.knowledge_embeddings
                    WHERE is_active = true AND (category = %s OR %s = '')
                    LIMIT %s
                    """,
                    (category, category, limit),
                )
            return cur.fetchall()
