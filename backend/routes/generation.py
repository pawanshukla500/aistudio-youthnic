import uuid
import json
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Body, Query, Depends
from auth import verify_internal_secret
from models.generation import GenerationJobSubmit, GenerationJobStatus, PoseGenerationRecord
from database import get_db, get_latest_dna_version
from cache import cache_manager
from agents.router_agent import GenerationRouterAgent
from agents.pose_planning_agent import CreativePosePlanningAgent
from celery_app import process_generation_job_task, process_pose_generation_task

router = APIRouter(
    prefix="/api/v1/generation",
    tags=["Generation Orchestration"],
    dependencies=[Depends(verify_internal_secret)],
)
_router_agent = GenerationRouterAgent()
_pose_planner = CreativePosePlanningAgent()


@router.post("/submit")
async def submit_generation_job(job_req: GenerationJobSubmit = Body(...)) -> Dict[str, Any]:
    """Submits a six-pose photoshoot generation request.

    Persists state in PostgreSQL and enqueues background Celery worker.
    """
    org_id = job_req.organization_id
    sku_id = job_req.sku_id
    sku_name = job_req.sku_name

    # Check for duplicate active job
    if cache_manager.is_job_active(org_id, sku_id):
        raise HTTPException(
            status_code=409,
            detail=f"An active generation job is already running for SKU {sku_name}. Wait for completion."
        )

    route_out = _router_agent.process({
        "requested_model": job_req.requested_model,
        "quality": job_req.quality,
        "poses_to_generate": job_req.poses_to_generate,
    })["provider_route"]
    selected_provider = route_out["image_provider"]
    selected_model = route_out["image_model"]
    est_cost = round(float(route_out["est_cost_per_pose"]) * len(job_req.poses_to_generate), 4)

    dna_row = get_latest_dna_version(org_id, sku_id)
    product_dna = (dna_row or {}).get("dna_payload") or {"sku_name": sku_name}
    planned = _pose_planner.process({"product_dna": product_dna}).get("pose_plans", [])
    planned_by_idx = {int(p["pose_number"]): p for p in planned}

    job_id = f"job_{uuid.uuid4()}"
    session_id = f"session_{uuid.uuid4()}"

    # Insert into PostgreSQL generation_jobs & session_generations
    with get_db() as conn:
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
                    job_id, org_id, sku_name, session_id, len(job_req.poses_to_generate),
                    selected_provider, selected_model, job_req.quality, job_req.pose_qa,
                    job_req.aspect_ratio, job_req.image_size,
                    json.dumps(job_req.model_dump()), est_cost
                ),
            )

            # Insert pose rows into session_generations
            pose_titles = [
                ("Front Hero Stance", "full_front"),
                ("Three-Quarter Stance", "angled"),
                ("Seated Editorial", "side_seated"),
                ("Rear Construction View", "back"),
                ("Craftsmanship Detail", "closeup"),
                ("Garment Feature Showcase", "showcase"),
            ]

            for idx in job_req.poses_to_generate:
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

    # Mark active in cache
    cache_manager.mark_job_active(org_id, sku_id, job_id)

    # Dispatch Celery background task
    try:
        process_generation_job_task.delay(job_id, org_id, sku_id)
    except Exception:
        pass

    return {
        "status": "queued",
        "job_id": job_id,
        "session_id": session_id,
        "sku_name": sku_name,
        "provider": selected_provider,
        "model": selected_model,
        "total_poses": len(job_req.poses_to_generate),
    }


@router.get("/{job_id}/status")
async def get_generation_status(job_id: str) -> Dict[str, Any]:
    """Retrieves live job status, completed poses, and QA outcomes."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT job_id, org_id, sku_name, session_id, status, total_poses,
                       completed_poses, failed_poses, actual_cost_usd, error_message, created_at
                FROM public.generation_jobs WHERE job_id = %s
                """,
                (job_id,),
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
async def regenerate_pose(
    job_id: str,
    pose_index: int,
    payload: Dict[str, Any] = Body(default_factory=dict),
) -> Dict[str, Any]:
    """Triggers pose-specific regeneration with optional targeted repair guidance."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT g.generation_id, j.org_id, j.sku_name
                FROM public.session_generations g
                JOIN public.generation_jobs j ON j.session_id = g.session_id
                WHERE j.job_id = %s AND g.pose_index = %s
                """,
                (job_id, pose_index),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pose or job not found")

            gen_id = row["generation_id"]
            org_id = row["org_id"]
            sku_id = row["sku_name"]

            # Reset pose status
            cur.execute(
                """
                UPDATE public.session_generations
                SET status = 'pending',
                    regeneration_instructions = %s,
                    updated_at = now()
                WHERE generation_id = %s
                """,
                (payload.get("extra_instructions", ""), gen_id),
            )

    try:
        process_pose_generation_task.delay(gen_id, job_id, pose_index, org_id, sku_id)
    except Exception:
        pass

    return {
        "status": "regeneration_enqueued",
        "job_id": job_id,
        "pose_index": pose_index,
        "generation_id": gen_id,
    }
