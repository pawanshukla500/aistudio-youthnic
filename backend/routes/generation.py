import logging
import os
import time
import uuid
import json
from typing import Dict, Any, List
import httpx
from fastapi import APIRouter, HTTPException, Body, Query, Depends
from auth import verify_internal_secret
from config import settings
from models.generation import GenerationJobSubmit, GenerationJobStatus, PoseGenerationRecord
from database import get_db, get_latest_dna_version
from cache import cache_manager
from agents.router_agent import GenerationRouterAgent
from agents.pose_planning_agent import CreativePosePlanningAgent
from celery_app import process_generation_job_task, process_pose_generation_task

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/v1/generation",
    tags=["Generation Orchestration"],
    dependencies=[Depends(verify_internal_secret)],
)
_router_agent = GenerationRouterAgent()
_pose_planner = CreativePosePlanningAgent()


def wake_celery_worker() -> bool:
    """Wake the on-demand Celery supervisor if running on Railway or explicitly configured."""
    url = (settings.CELERY_WORKER_WAKE_URL or "").strip()
    if not url and (os.environ.get("RAILWAY_ENVIRONMENT_ID") or os.environ.get("RAILWAY_PROJECT_ID")):
        url = "http://celery-worker.railway.internal:8080/wake"
    elif url == "http://celery-worker.railway.internal:8080/wake" and not (
        os.environ.get("RAILWAY_ENVIRONMENT_ID") or os.environ.get("RAILWAY_PROJECT_ID")
    ):
        return False
    if not url:
        return False

    headers: Dict[str, str] = {}
    if settings.INTERNAL_API_SECRET:
        headers["x-internal-secret"] = settings.INTERNAL_API_SECRET

    for attempt in range(2):
        try:
            resp = httpx.post(url, headers=headers, timeout=5.0)
            if resp.status_code < 400:
                return True
            logger.warning("Celery worker wake returned %s on attempt %s", resp.status_code, attempt + 1)
        except Exception as exc:
            logger.debug("Celery worker wake attempt %s failed: %s", attempt + 1, exc)
        if attempt == 0:
            time.sleep(1.0)
    logger.warning("Unable to wake Celery worker at %s after retries; queued task remains in Valkey.", url)
    return False


@router.post("/submit")
def submit_generation_job(job_req: GenerationJobSubmit = Body(...)) -> Dict[str, Any]:
    """Submits a six-pose photoshoot generation request.

    Persists state in PostgreSQL and enqueues background Celery worker.
    """
    org_id = job_req.organization_id
    sku_id = job_req.sku_id
    sku_name = job_req.sku_name

    poses_to_generate = [int(p) for p in job_req.poses_to_generate if 1 <= int(p) <= 6]
    if not poses_to_generate:
        raise HTTPException(status_code=400, detail="poses_to_generate must include at least one valid pose index (1-6).")

    # Check for duplicate active job
    if cache_manager.is_job_active(org_id, sku_id):
        raise HTTPException(
            status_code=409,
            detail=f"An active generation job is already running for SKU {sku_name}. Wait for completion."
        )

    try:
        route_out = _router_agent.process({
            "requested_model": job_req.requested_model,
            "quality": job_req.quality,
            "poses_to_generate": poses_to_generate,
        })["provider_route"]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    selected_provider = route_out["image_provider"]
    selected_model = route_out["image_model"]
    est_cost = round(float(route_out["est_cost_per_pose"]) * len(poses_to_generate), 4)

    dna_row = get_latest_dna_version(org_id, sku_id)
    product_dna = (dna_row or {}).get("dna_payload") or {"sku_name": sku_name}
    planned = _pose_planner.process(
        {
            "organization_id": org_id,
            "sku_id": sku_id,
            "source_fingerprint": (dna_row or {}).get("source_fingerprint", ""),
            "extra_instructions": job_req.extra_instructions or "",
            "product_dna": product_dna,
        }
    ).get("pose_plans", [])
    planned_by_idx = {int(p["pose_number"]): p for p in planned}

    job_id = f"job_{uuid.uuid4()}"
    session_id = f"session_{uuid.uuid4()}"

    # Mark active atomically in cache before committing dispatch
    if not cache_manager.mark_job_active(org_id, sku_id, job_id):
        raise HTTPException(
            status_code=409,
            detail=f"An active generation job is already running for SKU {sku_name}. Wait for completion."
        )

    try:
        with get_db() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO public.generation_jobs (
                            job_id, org_id, sku_name, session_id, status, total_poses,
                            completed_poses, failed_poses, provider, model, quality, pose_qa, aspect_ratio, image_size,
                            job_data, estimated_cost_usd
                        ) VALUES (%s, %s, %s, %s, 'queued', %s, 0, 0, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            job_id, org_id, sku_name, session_id, len(poses_to_generate),
                            selected_provider, selected_model, job_req.quality, job_req.pose_qa,
                            job_req.aspect_ratio, job_req.image_size,
                            json.dumps(job_req.model_dump()), est_cost
                        ),
                    )

                    pose_titles = [
                        ("Front Hero Stance", "full_front"),
                        ("Three-Quarter Stance", "angled"),
                        ("Seated Editorial", "side_seated"),
                        ("Rear Construction View", "back"),
                        ("Craftsmanship Detail", "closeup"),
                        ("Garment Feature Showcase", "showcase"),
                    ]

                    for idx in poses_to_generate:
                        p_plan = planned_by_idx.get(idx) or {}
                        p_title = p_plan.get("title") or (pose_titles[idx - 1][0] if idx <= len(pose_titles) else "Custom Pose")
                        p_type = p_plan.get("pose_type") or (pose_titles[idx - 1][1] if idx <= len(pose_titles) else "custom")
                        p_prompt = str(p_plan.get("prompt") or "")
                        gen_id = f"gen_{uuid.uuid4()}"
                        cur.execute(
                            """
                            INSERT INTO public.session_generations (
                                session_id, generation_id, pose_index, title, pose_type, full_prompt, instructions, status, attempt_count
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending', 0)
                            """,
                            (session_id, gen_id, idx, p_title, p_type, p_prompt, job_req.extra_instructions or ""),
                        )

        process_generation_job_task.delay(job_id, org_id, sku_id)
        wake_celery_worker()
    except Exception:
        cache_manager.release_job_active(org_id, sku_id, expected_job_id=job_id)
        try:
            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE public.generation_jobs SET status = 'failed', error_message = 'Worker dispatch failed' WHERE job_id = %s",
                        (job_id,),
                    )
        except Exception:
            pass
        raise HTTPException(status_code=503, detail="Failed to enqueue generation worker")

    return {
        "status": "queued",
        "job_id": job_id,
        "session_id": session_id,
        "sku_name": sku_name,
        "provider": selected_provider,
        "model": selected_model,
        "total_poses": len(poses_to_generate),
    }


@router.get("/{job_id}/status")
def get_generation_status(job_id: str, org_id: str = Query(...)) -> Dict[str, Any]:
    """Retrieves live job status, completed poses, and QA outcomes."""
    if not org_id.strip():
        raise HTTPException(status_code=400, detail="org_id is required")
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT job_id, org_id, sku_name, session_id, status, total_poses,
                       completed_poses, failed_poses, actual_cost_usd, error_message, created_at
                FROM public.generation_jobs WHERE job_id = %s AND org_id = %s
                """,
                (job_id, org_id),
            )
            job = cur.fetchone()
            if not job:
                raise HTTPException(status_code=404, detail="Generation job not found")

            cur.execute(
                """
                SELECT generation_id, pose_index, title, pose_type, status,
                       output_url, storage_path, qa_status, attempt_count, error
                FROM public.session_generations WHERE session_id = %s
                ORDER BY pose_index ASC
                """,
                (job["session_id"],),
            )
            poses = cur.fetchall()

    return {
        "job_id": job["job_id"],
        "sku_name": job["sku_name"],
        "status": job["status"],
        "total_poses": job["total_poses"],
        "completed_poses": job["completed_poses"],
        "failed_poses": job["failed_poses"],
        "actual_cost_usd": float(job["actual_cost_usd"] or 0.0),
        "poses": poses,
    }


@router.post("/{job_id}/pose/{pose_index}/regenerate")
def regenerate_pose(
    job_id: str,
    pose_index: int,
    payload: Dict[str, Any] = Body(default_factory=dict),
) -> Dict[str, Any]:
    """Triggers pose-specific regeneration with optional targeted repair guidance."""
    with get_db() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT g.generation_id, g.status AS prev_status, g.attempt_count, g.output_url,
                           g.storage_path, g.qa_status, g.qa_payload, g.approval_status, g.error,
                           j.org_id, j.sku_name, j.session_id, j.status AS job_status, j.completed_at, j.job_data
                    FROM public.session_generations g
                    JOIN public.generation_jobs j ON j.session_id = g.session_id
                    WHERE j.job_id = %s AND g.pose_index = %s
                    FOR UPDATE
                    """,
                    (job_id, pose_index),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Pose or job not found")
                if row.get("job_status") == "cancelled":
                    raise HTTPException(status_code=409, detail="Cannot regenerate pose on a cancelled job")
                if row.get("prev_status") == "generating":
                    raise HTTPException(status_code=409, detail="Pose generation is already in progress")

                gen_id = row["generation_id"]
                org_id = row["org_id"]
                job_data = row.get("job_data") if isinstance(row.get("job_data"), dict) else {}
                sku_id = str(job_data.get("sku_id") or row["sku_name"])
                reopened_job = row.get("job_status") in ("completed", "failed")

                cur.execute(
                    """
                    UPDATE public.session_generations
                    SET status = 'pending',
                        attempt_count = 0,
                        output_url = '',
                        storage_path = '',
                        qa_status = 'pending',
                        qa_payload = NULL,
                        approval_status = 'pending',
                        error = '',
                        regeneration_instructions = %s,
                        updated_at = now()
                    WHERE generation_id = %s
                    """,
                    (payload.get("extra_instructions", ""), gen_id),
                )
                cur.execute(
                    """
                    UPDATE public.generation_jobs
                    SET status = 'processing',
                        completed_at = NULL
                    WHERE job_id = %s AND status <> 'cancelled'
                    """,
                    (job_id,),
                )

    acquired_active = False
    conflict_active = False
    try:
        if reopened_job:
            acquired_active = cache_manager.mark_job_active(org_id, sku_id, job_id)
            if not acquired_active:
                conflict_active = True
                raise HTTPException(
                    status_code=409,
                    detail=f"Another active generation job is already running for SKU {sku_id}.",
                )

        process_pose_generation_task.delay(gen_id, job_id, pose_index, org_id, sku_id)
        wake_celery_worker()
    except Exception as exc:
        if acquired_active:
            cache_manager.release_job_active(org_id, sku_id, expected_job_id=job_id)
        try:
            with get_db() as conn:
                with conn.transaction():
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE public.session_generations
                            SET status = %s,
                                attempt_count = %s,
                                output_url = %s,
                                storage_path = %s,
                                qa_status = %s,
                                qa_payload = %s,
                                approval_status = %s,
                                error = %s,
                                updated_at = now()
                            WHERE generation_id = %s
                            """,
                            (
                                row.get("prev_status") or "completed",
                                int(row.get("attempt_count") or 0),
                                row.get("output_url") or "",
                                row.get("storage_path") or "",
                                row.get("qa_status"),
                                json.dumps(row["qa_payload"]) if isinstance(row.get("qa_payload"), (dict, list)) else row.get("qa_payload"),
                                row.get("approval_status"),
                                row.get("error") or "",
                                gen_id,
                            ),
                        )
                        cur.execute(
                            """
                            UPDATE public.generation_jobs
                            SET status = %s,
                                completed_at = %s
                            WHERE job_id = %s AND status <> 'cancelled'
                            """,
                            (row.get("job_status"), row.get("completed_at"), job_id),
                        )
        except Exception:
            pass
        if conflict_active and isinstance(exc, HTTPException):
            raise exc
        raise HTTPException(status_code=503, detail="Failed to enqueue pose regeneration worker")

    return {
        "status": "regeneration_enqueued",
        "job_id": job_id,
        "pose_index": pose_index,
        "generation_id": gen_id,
    }
