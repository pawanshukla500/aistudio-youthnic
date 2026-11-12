from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query

from auth import verify_internal_secret
from config import settings
from database import get_checkpointer_metrics
from graph import get_compiled_graph, list_workflow_threads, get_thread_state_history

router = APIRouter(
    prefix="/api/v1/workflows",
    tags=["LangGraph Checkpoints & Workflows"],
    dependencies=[Depends(verify_internal_secret)],
)


@router.get("/overview")
async def get_workflow_overview() -> Dict[str, Any]:
    """Return LangGraph topology, checkpointer backend status, and configured AI runtime capabilities."""
    graph = get_compiled_graph()
    drawable = graph.get_graph()
    metrics: Dict[str, Any] = {"backend": "memory", "tables_ready": False, "total_checkpoints": 0, "total_threads": 0}
    try:
        metrics = get_checkpointer_metrics()
    except Exception as exc:
        metrics["error"] = str(exc)

    return {
        "engine": "langgraph",
        "checkpointer": metrics,
        "nodes": list(drawable.nodes.keys()),
        "edges": [{"source": e.source, "target": e.target, "conditional": e.conditional} for e in drawable.edges],
        "providers_configured": {
            "meta": bool((settings.META_MODEL_API_KEY or "").strip()),
            "openai": bool((settings.OPENAI_API_KEY or "").strip()),
            "gemini": bool((settings.GEMINI_API_KEY or "").strip()),
        },
    }


@router.get("/threads")
async def list_threads(limit: int = Query(30, ge=1, le=200)) -> Dict[str, Any]:
    """List persistent LangGraph workflow threads stored in PostgreSQL."""
    try:
        threads = list_workflow_threads(limit=limit)
        return {"threads_count": len(threads), "threads": threads}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not inspect workflow threads: {exc}")


@router.get("/checkpoints/{thread_id}")
async def get_checkpoints_for_thread(
    thread_id: str,
    limit: int = Query(20, ge=1, le=100),
) -> Dict[str, Any]:
    """Inspect persistent step-by-step checkpoint history for a LangGraph thread_id."""
    try:
        history = get_thread_state_history(thread_id=thread_id, limit=limit)
        return {
            "thread_id": thread_id,
            "checkpoints_count": len(history),
            "history": history,
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not load thread checkpoints: {exc}")
