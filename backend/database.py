import ctypes
import gc
import json
import logging
import sys
import threading
import uuid
from typing import Optional, Dict, Any, List
from contextlib import contextmanager
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from config import settings

logger = logging.getLogger(__name__)

# Initialize connection pool safely under concurrency
_pool: Optional[ConnectionPool] = None
_pool_lock = threading.Lock()
_pool_generation = 0


def release_process_memory() -> bool:
    """Run Python GC and return freed glibc heap arenas to the OS kernel on Linux."""
    gc.collect()
    if sys.platform.startswith("linux"):
        try:
            libc = ctypes.CDLL("libc.so.6")
            libc.malloc_trim(0)
            return True
        except Exception:
            return False
    return False


def is_pool_open() -> bool:
    """Return True when the shared PostgreSQL ConnectionPool is currently initialized and open."""
    with _pool_lock:
        return _pool is not None and not getattr(_pool, "closed", False)


def get_pool() -> ConnectionPool:
    global _pool, _pool_generation
    if not settings.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured.")
    with _pool_lock:
        if _pool is None or _pool.closed:
            # Zero idle connections + bounded max_size + disabled TCP keepalives
            # allow Railway Postgres/FastAPI/worker services to enter sleep mode cleanly.
            _pool = ConnectionPool(
                conninfo=settings.DATABASE_URL,
                min_size=0,
                max_size=max(1, int(getattr(settings, "DB_POOL_MAX_SIZE", 5))),
                max_idle=float(getattr(settings, "DB_POOL_MAX_IDLE_SECONDS", 60.0)),
                reconnect_timeout=60.0,
                open=True,
                kwargs={
                    "autocommit": True,
                    "row_factory": dict_row,
                    "keepalives": 0,
                    "connect_timeout": 10,
                },
            )
            _pool_generation += 1
    return _pool


def close_pool() -> None:
    """Close shared PostgreSQL pool cleanly so idle processes hold zero open sockets."""
    global _pool
    pool_to_close: Optional[ConnectionPool] = None
    with _pool_lock:
        if _pool is not None and not _pool.closed:
            pool_to_close = _pool
        _pool = None
    if pool_to_close is not None:
        try:
            pool_to_close.close()
        except Exception:
            pass
        release_process_memory()


def get_pool_generation() -> int:
    return _pool_generation


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
    status_override: Optional[str] = None,
) -> int:
    with get_db() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                # Serialize concurrent version creation per org+SKU
                cur.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))",
                    (f"dna:{org_id}:{sku_id}",),
                )
                cur.execute(
                    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM public.product_dna_versions WHERE organization_id = %s AND sku_id = %s",
                    (org_id, sku_id),
                )
                row = cur.fetchone()
                next_ver = row["next_version"] if row else 1

                status = status_override or ("approved" if approved else "draft")
                synced_payload = {
                    **dna_payload,
                    "version": next_ver,
                    "approved": bool(approved),
                    "status": status,
                }
                if approved_by:
                    synced_payload["approved_by"] = approved_by

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
                        json.dumps(synced_payload), fingerprint, status, approved, approved_by, approved
                    ),
                )
                saved = cur.fetchone()
                return saved["version"] if saved else next_ver


def get_latest_dna_version(org_id: str, sku_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve the latest Product DNA version record for a given organization and SKU."""
    try:
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
    except Exception as e:
        logger.warning(f"Could not fetch DNA version from DB: {e}")
        return None


def get_dna_version_by_fingerprint(
    org_id: str,
    sku_id: str,
    source_fingerprint: str,
) -> Optional[Dict[str, Any]]:
    """Fetch the most recent Product DNA version for an organization matching source_fingerprint."""
    if not org_id or not source_fingerprint:
        return None
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM public.product_dna_versions
                    WHERE organization_id = %s AND source_fingerprint = %s
                    ORDER BY (sku_id = %s) DESC, approved DESC, version DESC, created_at DESC
                    LIMIT 1
                    """,
                    (org_id, source_fingerprint, sku_id),
                )
                return cur.fetchone()
    except Exception as e:
        logger.warning(f"Could not fetch DNA version by fingerprint from DB: {e}")
        return None


def list_dna_versions(org_id: str, sku_id: str) -> List[Dict[str, Any]]:
    """List all historical Product DNA versions for a given organization and SKU."""
    try:
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
    except Exception as e:
        logger.warning(f"Could not list DNA versions from DB: {e}")
        return []


def approve_dna_version(org_id: str, sku_id: str, version: int, approved_by: str) -> bool:
    """Mark a specific Product DNA version as approved and keep dna_payload in sync."""
    with get_db() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.product_dna_versions
                    SET approved = true,
                        status = 'approved',
                        approved_by = %s,
                        approved_at = now(),
                        updated_at = now(),
                        dna_payload = COALESCE(dna_payload, '{}'::jsonb) || jsonb_build_object(
                            'version', %s::int,
                            'approved', true,
                            'status', 'approved',
                            'approved_by', %s::text,
                            'approved_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                        )
                    WHERE organization_id = %s AND sku_id = %s AND version = %s
                    """,
                    (approved_by, version, approved_by, org_id, sku_id, version),
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


def update_reference_evidence_dimensions(
    org_id: str,
    evidence_id: str,
    dimensions: Dict[str, int],
    mime_type: Optional[str] = None,
) -> None:
    if not org_id or not evidence_id or not dimensions:
        return
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                if mime_type:
                    cur.execute(
                        """
                        UPDATE public.product_reference_evidence
                        SET dimensions = %s, mime_type = %s
                        WHERE organization_id = %s AND id = %s
                        """,
                        (json.dumps(dimensions), mime_type, org_id, evidence_id),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE public.product_reference_evidence
                        SET dimensions = %s
                        WHERE organization_id = %s AND id = %s
                        """,
                        (json.dumps(dimensions), org_id, evidence_id),
                    )
    except Exception as exc:
        logger.debug(f"Reference dimensions update skipped for {evidence_id}: {exc}")


# -------------------------------------------------------------
# Region Crops
# -------------------------------------------------------------
def save_region_crop(
    org_id: str,
    evidence_id: str,
    sku_id: str,
    region_name: str,
    bounding_box: Dict[str, float],
    crop_storage_path: str,
    crop_download_url: str,
    construction_notes: Optional[str] = None,
) -> str:
    """Persist an extracted garment region crop linked to source evidence."""
    try:
        uuid.UUID(str(evidence_id))
    except (ValueError, TypeError):
        logger.debug("Skipping region crop insert without valid UUID evidence_id")
        return ""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.product_region_crops (
                    organization_id, evidence_id, sku_id, region_name,
                    bounding_box, crop_storage_path, crop_download_url, construction_notes
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    org_id,
                    evidence_id,
                    sku_id,
                    region_name,
                    json.dumps(bounding_box),
                    crop_storage_path,
                    crop_download_url,
                    construction_notes,
                ),
            )
            row = cur.fetchone()
            return str(row["id"]) if row else ""


def fetch_pose_plan_outcomes(organization_id: str, outcome_keys: List[str]) -> List[Dict[str, Any]]:
    """Learned pose-plan outcome counters for the planner's recall_outcomes node (errors propagate)."""
    keys = [key for key in outcome_keys if key]
    if not settings.DATABASE_URL or not organization_id or not keys:
        return []
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT outcome_key, use_count, dna_pass_count, dna_fail_count,
                       dna_score_avg::float8 AS dna_score_avg,
                       human_approved_count, human_rejected_count, best_plan
                FROM public.pose_plan_outcomes
                WHERE organization_id = %s AND outcome_key = ANY(%s)
                """,
                (organization_id, keys),
            )
            return cur.fetchall()


def get_checkpointer_metrics() -> Dict[str, Any]:
    """Inspect PostgresSaver checkpoint tables and thread counts."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)::int AS total_checkpoints,
                       COUNT(DISTINCT thread_id)::int AS total_threads
                FROM public.checkpoints
                """
            )
            row = cur.fetchone() or {"total_checkpoints": 0, "total_threads": 0}
            return {
                "backend": "postgresql",
                "tables_ready": True,
                "total_checkpoints": int(row["total_checkpoints"]),
                "total_threads": int(row["total_threads"]),
            }
