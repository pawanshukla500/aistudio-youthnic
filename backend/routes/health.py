import time
from typing import Dict, Any
from fastapi import APIRouter, Query
from config import settings
from database import get_db, get_checkpointer_metrics, is_pool_open
from cache import get_valkey, is_valkey_open
from firebase_service import get_bucket

router = APIRouter(tags=["System Health"])
START_TIME = time.time()


@router.get("/health")
def health_check(deep: bool = Query(default=False)) -> Dict[str, Any]:
    """Return service health.

    When deep=False and HEALTH_CHECK_IDLE_SAFE is enabled, reports passive standby
    state without opening new PostgreSQL or Valkey sockets so Railway services can sleep.
    """
    if not deep and getattr(settings, "HEALTH_CHECK_IDLE_SAFE", True):
        pool_active = is_pool_open()
        valkey_active = is_valkey_open()
        return {
            "status": "healthy",
            "mode": "active" if (pool_active or valkey_active) else "standby_idle",
            "deep_probe": False,
            "uptime_seconds": int(time.time() - START_TIME),
            "components": {
                "postgresql": "healthy" if pool_active else "standby",
                "valkey": "healthy" if valkey_active else "standby",
                "firebase": "healthy" if settings.FIREBASE_STORAGE_BUCKET else "bucket_not_configured",
                "langgraph_checkpointer": {
                    "backend": "postgresql" if settings.DATABASE_URL else "memory",
                    "tables_ready": True,
                    "mode": "active" if pool_active else "standby",
                },
            },
        }

    db_status = "healthy"
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
    except Exception:
        db_status = "unhealthy"

    valkey_status = "healthy"
    try:
        r = get_valkey()
        if not r.ping():
            valkey_status = "unresponsive"
    except Exception:
        valkey_status = "unhealthy"

    firebase_status = "healthy"
    try:
        b = get_bucket()
        if not b.name:
            firebase_status = "bucket_not_configured"
    except Exception:
        firebase_status = "unhealthy"

    langgraph_status: Dict[str, Any] = {"backend": "memory", "tables_ready": False}
    try:
        langgraph_status = get_checkpointer_metrics()
    except Exception:
        langgraph_status = {"backend": "memory", "tables_ready": False, "error": "unavailable"}

    overall = "healthy" if (db_status == "healthy" and valkey_status == "healthy") else "degraded"

    return {
        "status": overall,
        "mode": "deep",
        "deep_probe": True,
        "uptime_seconds": int(time.time() - START_TIME),
        "components": {
            "postgresql": db_status,
            "valkey": valkey_status,
            "firebase": firebase_status,
            "langgraph_checkpointer": langgraph_status,
        },
    }


@router.get("/readiness")
def readiness_check() -> Dict[str, Any]:
    return {"status": "ready"}
