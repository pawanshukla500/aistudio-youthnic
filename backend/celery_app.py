import json
import logging
from typing import Any, Dict, List
from celery import Celery
from config import settings
from cache import distributed_lock, cache_manager
from database import get_db, get_latest_dna_version, get_references_for_sku
from firebase_service import upload_bytes
from services.ai_clients import generate_catalog_image, load_reference_image
from agents.pose_planning_agent import CreativePosePlanningAgent
from agents.qa_agent import ComputerVisionQAAgent
from agents.correction_agent import CorrectionAgent
from agents.learning_agent import LearningOptimizationAgent

logger = logging.getLogger(__name__)

# Initialize Celery app with Valkey broker
celery = Celery(
    "youthnic_studio_tasks",
    broker=settings.VALKEY_URL,
    backend=settings.VALKEY_URL,
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,  # Atomic lease: only ack when task finishes
    worker_prefetch_multiplier=1,  # Fair distribution
    task_reject_on_worker_lost=True,
)

qa_agent = ComputerVisionQAAgent()
correction_agent = CorrectionAgent()
learning_agent = LearningOptimizationAgent()
pose_planner = CreativePosePlanningAgent()


def _finalize_job_progress(job_id: str, org_id: str, sku_id: str):
    """Aggregate pose statuses/costs under an explicit row lock and finalize generation_jobs cleanly."""
    next_status = "processing"
    with get_db() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT status, session_id FROM public.generation_jobs WHERE job_id = %s FOR UPDATE",
                    (job_id,),
                )
                job_row = cur.fetchone()
                if not job_row or job_row["status"] == "cancelled":
                    return

                cur.execute(
                    """
                    SELECT
                      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_poses,
                      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_poses,
                      COUNT(*) FILTER (WHERE status IN ('pending', 'generating', 'qa_pending', 'retrying'))::int AS active_poses,
                      COALESCE(SUM(actual_cost_usd), 0)::float AS total_cost,
                      COALESCE(SUM(input_tokens), 0)::int AS total_in,
                      COALESCE(SUM(output_tokens), 0)::int AS total_out
                    FROM public.session_generations
                    WHERE session_id = %s
                    """,
                    (job_row["session_id"],),
                )
                agg = cur.fetchone() or {}
                completed = int(agg.get("completed_poses") or 0)
                failed = int(agg.get("failed_poses") or 0)
                active = int(agg.get("active_poses") or 0)
                total_cost = float(agg.get("total_cost") or 0.0)

                if active == 0:
                    next_status = "completed" if completed > 0 else "failed"

                cur.execute(
                    """
                    UPDATE public.generation_jobs
                    SET completed_poses = %s,
                        failed_poses = %s,
                        actual_cost_usd = %s,
                        input_tokens = %s,
                        output_tokens = %s,
                        total_tokens = %s,
                        status = %s,
                        completed_at = CASE WHEN %s IN ('completed', 'failed') THEN now() ELSE completed_at END
                    WHERE job_id = %s AND status <> 'cancelled'
                    """,
                    (
                        completed,
                        failed,
                        total_cost,
                        int(agg.get("total_in") or 0),
                        int(agg.get("total_out") or 0),
                        int(agg.get("total_in") or 0) + int(agg.get("total_out") or 0),
                        next_status,
                        next_status,
                        job_id,
                    ),
                )
    if next_status in ("completed", "failed"):
        cache_manager.release_job_active(org_id, sku_id)


def _load_sku_reference_payloads(org_id: str, sku_id: str, job_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    refs = (job_data.get("references") or []) if isinstance(job_data, dict) else []
    if not refs:
        refs = get_references_for_sku(org_id, sku_id)
    loaded: List[Dict[str, Any]] = []
    for r in refs:
        item = load_reference_image(r, organization_id=org_id)
        if item:
            loaded.append(item)
    return loaded


@celery.task(bind=True, max_retries=3, default_retry_delay=10)
def process_generation_job_task(self, job_id: str, org_id: str, sku_id: str):
    """Processes generation job for all poses with per-SKU distributed lock."""
    lock_key = f"sku_job:{org_id}:{sku_id}"
    logger.info(f"Starting Celery job processing: {job_id} for SKU: {sku_id}")

    try:
        with distributed_lock(lock_key, timeout_seconds=300):
            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT status, total_poses, completed_poses FROM public.generation_jobs WHERE job_id = %s",
                        (job_id,),
                    )
                    job_row = cur.fetchone()
                    if not job_row or job_row["status"] in ["cancelled", "completed"]:
                        logger.info(f"Job {job_id} is already {job_row.get('status') if job_row else 'missing'}")
                        return {"status": "skipped", "job_id": job_id}

                    cur.execute(
                        "UPDATE public.generation_jobs SET status = 'processing', started_at = COALESCE(started_at, now()) WHERE job_id = %s AND status <> 'cancelled'",
                        (job_id,),
                    )

                    cur.execute(
                        """
                        SELECT generation_id, pose_index, pose_type, status, attempt_count
                        FROM public.session_generations
                        WHERE session_id = (SELECT session_id FROM public.generation_jobs WHERE job_id = %s)
                        ORDER BY pose_index ASC
                        """,
                        (job_id,),
                    )
                    poses = cur.fetchall()

            for pose in poses:
                gen_id = pose["generation_id"]
                p_idx = pose["pose_index"]
                if pose["status"] != "completed":
                    process_pose_generation_task.delay(gen_id, job_id, p_idx, org_id, sku_id)

            return {"status": "dispatched", "job_id": job_id, "poses_count": len(poses)}

    except Exception as exc:
        logger.error(f"Error in generation job {job_id}: {exc}")
        if self.request.retries >= self.max_retries:
            try:
                with get_db() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE public.generation_jobs SET status = 'failed', error_message = %s, completed_at = now() WHERE job_id = %s AND status <> 'cancelled'",
                            (str(exc)[:500], job_id),
                        )
            finally:
                cache_manager.release_job_active(org_id, sku_id)
        raise self.retry(exc=exc, countdown=15)


@celery.task(bind=True, max_retries=3, default_retry_delay=15)
def process_pose_generation_task(self, generation_id: str, job_id: str, pose_index: int, org_id: str, sku_id: str):
    """Executes real OpenAI image generation, uploads to Firebase Storage, and triggers CV QA."""
    logger.info(f"Generating pose {pose_index} for gen_id: {generation_id}")
    image_committed = False

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT g.status, g.output_url, g.attempt_count, g.pose_type, g.full_prompt,
                           g.regeneration_instructions, g.instructions, j.status AS job_status,
                           j.model, j.aspect_ratio, j.image_size, j.quality, j.pose_qa, j.job_data, j.sku_name
                    FROM public.session_generations g
                    JOIN public.generation_jobs j ON j.session_id = g.session_id
                    WHERE g.generation_id = %s AND j.job_id = %s
                    """,
                    (generation_id, job_id),
                )
                row = cur.fetchone()
                if not row or row["status"] == "completed" or row.get("job_status") == "cancelled":
                    logger.info(f"Pose {pose_index} already completed, missing, or cancelled. Reconciled.")
                    return {"status": "completed", "generation_id": generation_id}

                # If an image was already committed awaiting QA dispatch, resume QA dispatch without regenerating/re-charging
                if row["status"] == "qa_pending" and row.get("output_url"):
                    image_committed = True
                    evaluate_qa_task.delay(generation_id, job_id, pose_index, org_id, sku_id)
                    return {"status": "qa_dispatched", "generation_id": generation_id, "output_url": row["output_url"]}

                attempts = int(row["attempt_count"] or 0) + 1
                cur.execute(
                    """
                    UPDATE public.session_generations
                    SET status = 'generating', updated_at = now()
                    WHERE generation_id = %s
                    """,
                    (generation_id,),
                )

        dna = cache_manager.get_hot_dna(org_id, sku_id)
        if not dna:
            dna_row = get_latest_dna_version(org_id, sku_id)
            dna = (dna_row or {}).get("dna_payload") or {"sku_name": row.get("sku_name", sku_id)}

        prompt = str(row.get("full_prompt") or "").strip()
        if not prompt:
            planned = pose_planner.process({"product_dna": dna}).get("pose_plans", [])
            matched = next((p for p in planned if int(p["pose_number"]) == int(pose_index)), None)
            prompt = str((matched or {}).get("prompt") or f"Editorial catalog photo pose {pose_index} for {sku_id}")

        extra_parts = [str(row.get("instructions") or "").strip(), str(row.get("regeneration_instructions") or "").strip()]
        composed_prompt = " ".join([prompt, *[p for p in extra_parts if p]]).strip()

        loaded_refs = _load_sku_reference_payloads(org_id, sku_id, row.get("job_data") or {})
        gen_result = generate_catalog_image(
            prompt=composed_prompt,
            model=str(row.get("model") or "gpt-image-2.5-flare-2026-09-08"),
            aspect_ratio=str(row.get("aspect_ratio") or "3:4"),
            image_size=str(row.get("image_size") or "2K"),
            quality=str(row.get("quality") or "medium"),
            reference_images=loaded_refs,
        )

        ext = "png" if "png" in str(gen_result.get("mime_type", "")) else "webp" if "webp" in str(gen_result.get("mime_type", "")) else "jpg"
        storage_path = f"generations/{org_id}/{sku_id}/{job_id}/pose_{pose_index}_v{attempts}.{ext}"
        output_url = upload_bytes(storage_path, gen_result["image_bytes"], content_type=gen_result["mime_type"])
        usage = gen_result.get("usage") or {}
        in_tokens = int(usage.get("input_tokens") or 0)
        out_tokens = int(usage.get("output_tokens") or 0)
        cost_usd = float(gen_result.get("cost_usd") or 0.0)
        next_status = "qa_pending" if row.get("pose_qa", True) else "completed"

        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.session_generations
                    SET output_url = %s,
                        storage_path = %s,
                        storage_backend = 'firebase',
                        provider_request_id = %s,
                        full_prompt = %s,
                        attempt_count = %s,
                        actual_cost_usd = actual_cost_usd + %s,
                        input_tokens = input_tokens + %s,
                        output_tokens = output_tokens + %s,
                        total_tokens = total_tokens + %s,
                        status = %s,
                        error = '',
                        updated_at = now()
                    WHERE generation_id = %s
                    """,
                    (
                        output_url,
                        storage_path,
                        str(gen_result.get("request_id") or ""),
                        composed_prompt,
                        attempts,
                        cost_usd,
                        in_tokens,
                        out_tokens,
                        in_tokens + out_tokens,
                        next_status,
                        generation_id,
                    ),
                )
        image_committed = True

        if row.get("pose_qa", True):
            evaluate_qa_task.delay(generation_id, job_id, pose_index, org_id, sku_id)
        else:
            _finalize_job_progress(job_id, org_id, sku_id)

        return {"status": "generated", "generation_id": generation_id, "output_url": output_url, "attempt": attempts}

    except Exception as exc:
        logger.error(f"Error generating pose {pose_index}: {exc}")
        is_terminal = self.request.retries >= self.max_retries
        pose_status = "failed" if is_terminal else ("qa_pending" if image_committed else "retrying")
        try:
            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE public.session_generations SET status = %s, error = %s, updated_at = now() WHERE generation_id = %s",
                        (pose_status, str(exc)[:500], generation_id),
                    )
            if is_terminal:
                _finalize_job_progress(job_id, org_id, sku_id)
        except Exception:
            pass
        raise self.retry(exc=exc, countdown=20)


@celery.task(bind=True, max_retries=2)
def evaluate_qa_task(self, generation_id: str, job_id: str, pose_index: int, org_id: str, sku_id: str):
    """Evaluates generated pose with real VLM CV QA, triggers correction/regeneration or learning."""
    logger.info(f"Evaluating QA for pose {pose_index} gen_id: {generation_id}")

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT g.output_url, g.pose_type, g.attempt_count, j.job_data
                    FROM public.session_generations g
                    JOIN public.generation_jobs j ON j.session_id = g.session_id
                    WHERE g.generation_id = %s AND j.job_id = %s
                    """,
                    (generation_id, job_id),
                )
                row = cur.fetchone()
        if not row:
            return {"status": "missing_pose", "generation_id": generation_id}

        dna = cache_manager.get_hot_dna(org_id, sku_id)
        if not dna:
            dna_row = get_latest_dna_version(org_id, sku_id)
            dna = (dna_row or {}).get("dna_payload") or {"sku_name": sku_id}

        job_data = row.get("job_data") or {}
        refs = (job_data.get("references") or []) if isinstance(job_data, dict) else []
        if not refs:
            refs = get_references_for_sku(org_id, sku_id)

        evaluation = qa_agent.evaluate(
            org_id=org_id,
            job_id=job_id,
            generation_id=generation_id,
            sku_id=sku_id,
            pose_index=pose_index,
            pose_type=str(row.get("pose_type") or ("full_front" if pose_index == 1 else "angled")),
            image_url=str(row.get("output_url") or ""),
            product_dna=dna,
            reference_images=refs,
        )

        if evaluation.outcome == "pass" and not evaluation.requires_human_review:
            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE public.session_generations
                        SET qa_status = %s, qa_payload = %s, status = 'completed', updated_at = now()
                        WHERE generation_id = %s
                        """,
                        (evaluation.outcome, evaluation.model_dump_json(), generation_id),
                    )
            learning_agent.record_approved_outcome(
                org_id=org_id,
                sku_id=sku_id,
                rule_type="bottom_wear_preservation" if (dna.get("bottom_wear") or {}).get("cut_class") == "farshi" else "scene_continuity",
                rule_text=f"QA passed pose {pose_index} for {sku_id} (score={evaluation.overall_score})",
                positive_guidance="; ".join(dna.get("explicit_invariants") or []),
                negative_constraints=dna.get("prohibited_changes") or [],
                category=str(dna.get("category") or "ethnic/fusion"),
            )
        elif evaluation.outcome == "pass" and evaluation.requires_human_review:
            with get_db() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE public.session_generations
                        SET qa_status = 'review_recommended', qa_payload = %s, status = 'completed',
                            approval_status = 'pending', updated_at = now()
                        WHERE generation_id = %s
                        """,
                        (evaluation.model_dump_json(), generation_id),
                    )
        else:
            action, guidance = correction_agent.decide_action(
                pose_index=pose_index,
                attempt_count=int(row.get("attempt_count") or 1),
                failed_checks=evaluation.failed_checks,
                guidance=evaluation.correction_guidance,
                anatomical_defect=evaluation.anatomical_defect_detected,
                style_violation=evaluation.style_quarantine_violation,
            )
            correction_agent.record_correction(
                org_id=org_id,
                job_id=job_id,
                generation_id=generation_id,
                sku_id=sku_id,
                pose_index=pose_index,
                stage="qa_evaluation",
                mismatch=", ".join(evaluation.failed_checks or ["qa_rejected"]),
                action="pose_regeneration" if action == "regenerate" else "human_override",
            )
            if action == "regenerate":
                with get_db() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE public.session_generations
                            SET qa_status = %s, qa_payload = %s, status = 'retrying', output_url = '',
                                regeneration_instructions = %s, updated_at = now()
                            WHERE generation_id = %s
                            """,
                            (evaluation.outcome, evaluation.model_dump_json(), guidance, generation_id),
                        )
                process_pose_generation_task.delay(generation_id, job_id, pose_index, org_id, sku_id)
            else:
                with get_db() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE public.session_generations
                            SET qa_status = %s, qa_payload = %s, status = 'failed',
                                error = %s, updated_at = now()
                            WHERE generation_id = %s
                            """,
                            (evaluation.outcome, evaluation.model_dump_json(), guidance[:500], generation_id),
                        )

        _finalize_job_progress(job_id, org_id, sku_id)
        return {"status": "qa_evaluated", "outcome": evaluation.outcome, "score": evaluation.overall_score}

    except Exception as exc:
        logger.error(f"Error in QA evaluation for {generation_id}: {exc}")
        is_terminal = self.request.retries >= self.max_retries
        if is_terminal:
            try:
                with get_db() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE public.session_generations SET status = 'failed', error = %s, updated_at = now() WHERE generation_id = %s",
                            (f"QA error: {str(exc)[:450]}", generation_id),
                        )
                _finalize_job_progress(job_id, org_id, sku_id)
            except Exception:
                pass
        raise self.retry(exc=exc, countdown=15)
