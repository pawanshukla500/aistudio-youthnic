import logging
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import close_pool, release_process_memory
from cache import cache_manager, reset_valkey
from graph import reset_compiled_graph
from routes import (
    dna_router,
    generation_router,
    qa_router,
    memory_router,
    health_router,
    workflow_router,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("youthnic-studio-orchestrator")

_activity_lock = threading.Lock()
_active_api_requests = 0
_last_api_activity_mono = 0.0
_idle_timer: Optional[threading.Timer] = None


def cancel_idle_release_timer() -> None:
    global _idle_timer
    with _activity_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
            _idle_timer = None


def _release_idle_resources_unlocked() -> None:
    reset_compiled_graph()
    reset_valkey()
    cache_manager.clear_local_fallback()
    close_pool()
    release_process_memory()


def release_idle_resources() -> None:
    """Close idle PostgreSQL pool, Valkey client, and cached graph state, then trim OS heap."""
    global _idle_timer
    with _activity_lock:
        if _idle_timer is not None:
            _idle_timer.cancel()
            _idle_timer = None
        if _active_api_requests > 0:
            return
        _release_idle_resources_unlocked()


def _on_idle_timer_expired() -> None:
    global _idle_timer
    idle_seconds = max(5, int(getattr(settings, "IDLE_RESOURCE_RELEASE_SECONDS", 45)))
    with _activity_lock:
        _idle_timer = None
        if _active_api_requests > 0:
            return
        if (time.monotonic() - _last_api_activity_mono) < (idle_seconds - 0.5):
            return
        logger.info("FastAPI idle window reached (%ss); releasing DB/Valkey sockets and trimming RAM.", idle_seconds)
        _release_idle_resources_unlocked()


def _schedule_idle_release() -> None:
    global _idle_timer
    idle_seconds = int(getattr(settings, "IDLE_RESOURCE_RELEASE_SECONDS", 45))
    if idle_seconds <= 0:
        return
    with _activity_lock:
        if _active_api_requests > 0:
            return
        if _idle_timer is not None:
            _idle_timer.cancel()
        timer = threading.Timer(float(idle_seconds), _on_idle_timer_expired)
        timer.daemon = True
        timer.start()
        _idle_timer = timer


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Lazy zero-wake startup: PostgreSQL and Valkey connections open strictly on first
    # /api/v1/* demand so cold starts and health checks never wake sleeping databases.
    logger.info("Youthnic AI Studio Orchestration Backend ready (lazy zero-idle mode).")
    yield
    logger.info("Shutting down Youthnic AI Studio Orchestrator...")
    release_idle_resources()


app = FastAPI(
    title="Youthnic AI Fashion Studio Orchestrator",
    version="2.0.0",
    description="Agentic Multi-Agent AI Fashion Photography Orchestrator with Product DNA V2, LangGraph Postgres Checkpointing, and CV QA",
    lifespan=lifespan,
)


@app.middleware("http")
async def idle_resource_and_memory_middleware(request: Request, call_next):
    global _active_api_requests, _last_api_activity_mono, _idle_timer
    path = request.url.path or ""
    is_api_call = path.startswith("/api/")
    if is_api_call:
        with _activity_lock:
            _active_api_requests += 1
            if _idle_timer is not None:
                _idle_timer.cancel()
                _idle_timer = None
    try:
        return await call_next(request)
    finally:
        if is_api_call:
            should_trim_now = path in ("/api/v1/dna/extract", "/api/v1/qa/evaluate")
            with _activity_lock:
                _active_api_requests = max(0, _active_api_requests - 1)
                _last_api_activity_mono = time.monotonic()
                no_active = _active_api_requests == 0
            if no_active:
                if should_trim_now:
                    release_process_memory()
                _schedule_idle_release()

cors_origins = [o.strip() for o in (settings.CORS_ORIGINS or "*").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=(cors_origins != ["*"]),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(dna_router)
app.include_router(generation_router)
app.include_router(qa_router)
app.include_router(memory_router)
app.include_router(workflow_router)


@app.get("/")
async def root():
    return {
        "service": "Youthnic AI Fashion Studio Orchestration API",
        "version": "2.0.0",
        "status": "online",
        "engines": ["langgraph", "langchain", "celery", "pgvector", "valkey"],
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=False)
