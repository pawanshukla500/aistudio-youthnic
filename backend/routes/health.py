import time
from typing import Dict, Any
from fastapi import APIRouter
from database import get_db
from cache import get_valkey
from firebase_service import get_bucket

router = APIRouter(tags=["System Health"])
START_TIME = time.time()


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    db_status = "healthy"
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
    except Exception as e:
        db_status = f"unhealthy: {e}"

    valkey_status = "healthy"
    try:
        r = get_valkey()
        if not r.ping():
            valkey_status = "unresponsive"
    except Exception as e:
        valkey_status = f"unhealthy: {e}"

    firebase_status = "healthy"
    try:
        b = get_bucket()
        if not b.name:
            firebase_status = "bucket_not_configured"
    except Exception as e:
        firebase_status = f"unhealthy: {e}"

    overall = "healthy" if (db_status == "healthy" and valkey_status == "healthy") else "degraded"

    return {
        "status": overall,
        "uptime_seconds": int(time.time() - START_TIME),
        "components": {
            "postgresql": db_status,
            "valkey": valkey_status,
            "firebase": firebase_status,
        },
    }


@router.get("/readiness")
async def readiness_check() -> Dict[str, Any]:
    return {"status": "ready"}
