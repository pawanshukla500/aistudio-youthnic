import logging
import time
from celery import Celery
from config import settings
from cache import distributed_lock, cache_manager
from database import get_db
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


@celery.task(bind=True, max_retries=3, default_retry_delay=10)
def process_generation_job_task(self, job_id: str, org_id: str, sku_id: str):
    """Processes generation job for all poses with per-SKU distributed lock."""
    lock_key = f"sku_job:{org_id}:{sku_id}"
    logger.info(f"Starting Celery job processing: {job_id} for SKU: {sku_id}")

    try:
        with distributed_lock(lock_key, timeout_seconds=300):
            with get_db() as conn:
                with conn.cursor() as cur:
                    # Check current status
                    cur.execute(
                        "SELECT status, total_poses, completed_poses FROM public.generation_jobs WHERE job_id = %s",
                        (job_id,),
                    )
                    job_row = cur.fetchone()
                    if not job_row or job_row["status"] in ["cancelled", "completed"]:
                        logger.info(f"Job {job_id} is already {job_row.get('status') if job_row else 'missing'}")
                        return {"status": "skipped", "job_id": job_id}

                    # Mark in-progress
                    cur.execute(
                        "UPDATE public.generation_jobs SET status = 'in_progress', started_at = now() WHERE job_id = %s",
                        (job_id,),
                    )

                    # Fetch poses
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
        raise self.retry(exc=exc, countdown=15)


@celery.task(bind=True, max_retries=3, default_retry_delay=15)
def process_pose_generation_task(self, generation_id: str, job_id: str, pose_index: int, org_id: str, sku_id: str):
    """Executes single pose generation, reconciles attempt, and triggers QA."""
    logger.info(f"Generating pose {pose_index} for gen_id: {generation_id}")

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                # Reconcile previous attempt before repeating expensive call
                cur.execute(
                    "SELECT status, output_url, attempt_count FROM public.session_generations WHERE generation_id = %s",
                    (generation_id,),
                )
                pose_row = cur.fetchone()
                if not pose_row or pose_row["status"] == "completed":
                    logger.info(f"Pose {pose_index} already completed. Reconciled.")
                    return {"status": "completed", "generation_id": generation_id}

                # Mark generating
                attempts = (pose_row["attempt_count"] or 0) + 1
                cur.execute(
                    """
                    UPDATE public.session_generations
                    SET status = 'generating', attempt_count = %s, updated_at = now()
                    WHERE generation_id = %s
                    """,
                    (attempts, generation_id),
                )

        # Trigger QA task after generation
        evaluate_qa_task.delay(generation_id, job_id, pose_index, org_id, sku_id)
        return {"status": "generated", "generation_id": generation_id, "attempt": attempts}

    except Exception as exc:
        logger.error(f"Error generating pose {pose_index}: {exc}")
        raise self.retry(exc=exc, countdown=20)


@celery.task(bind=True, max_retries=2)
def evaluate_qa_task(self, generation_id: str, job_id: str, pose_index: int, org_id: str, sku_id: str):
    """Evaluates generated pose with Computer Vision QA Agent."""
    logger.info(f"Evaluating QA for pose {pose_index} gen_id: {generation_id}")

    try:
        dna = cache_manager.get_hot_dna(org_id, sku_id) or {}
        evaluation = qa_agent.evaluate(
            org_id=org_id,
            job_id=job_id,
            generation_id=generation_id,
            sku_id=sku_id,
            pose_index=pose_index,
            pose_type="full_front" if pose_index == 1 else "angled",
            image_url="",
            product_dna=dna,
        )

        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.session_generations
                    SET qa_status = %s,
                        qa_payload = %s,
                        status = CASE WHEN %s = 'pass' THEN 'completed' ELSE 'failed' END,
                        updated_at = now()
                    WHERE generation_id = %s
                    """,
                    (evaluation.outcome, evaluation.model_dump_json(), evaluation.outcome, generation_id),
                )

        return {"status": "qa_evaluated", "outcome": evaluation.outcome, "score": evaluation.overall_score}

    except Exception as exc:
        logger.error(f"Error in QA evaluation for {generation_id}: {exc}")
        return {"status": "qa_error", "error": str(exc)}
