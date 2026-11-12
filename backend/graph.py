import logging
from typing import Optional, Dict, Any, List
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
try:
    from langgraph.checkpoint.postgres import PostgresSaver
except ImportError:
    PostgresSaver = None

from config import settings
from database import get_pool, get_db
from agents.state import AgentWorkflowState
from agents.supervisor import SupervisorOrchestratorAgent

logger = logging.getLogger(__name__)

supervisor = SupervisorOrchestratorAgent()
_postgres_checkpointer = None
_checkpointer_initialized = False


def node_inspect_evidence(state: AgentWorkflowState) -> AgentWorkflowState:
    return supervisor.step_inspect_evidence(state)


def node_extract_dna(state: AgentWorkflowState) -> AgentWorkflowState:
    return supervisor.step_extract_dna(state)


def node_retrieve_memory(state: AgentWorkflowState) -> AgentWorkflowState:
    return supervisor.step_retrieve_memory(state)


def node_plan_poses(state: AgentWorkflowState) -> AgentWorkflowState:
    return supervisor.step_plan_poses(state)


def node_route_generation(state: AgentWorkflowState) -> AgentWorkflowState:
    return supervisor.step_route_generation(state)


def node_evaluate_qa(state: AgentWorkflowState) -> AgentWorkflowState:
    return supervisor.step_evaluate_qa(state)


def node_apply_correction(state: AgentWorkflowState) -> AgentWorkflowState:
    return supervisor.step_apply_correction(state)


def node_record_learning(state: AgentWorkflowState) -> AgentWorkflowState:
    return supervisor.step_record_learning(state)


def route_after_generation_plan(state: AgentWorkflowState) -> str:
    if state.get("qa_target_image_url") or state.get("ai_raw_evaluation"):
        return "evaluate_qa"
    return END


def route_after_qa(state: AgentWorkflowState) -> str:
    decision = state.get("correction_decision", "pass")
    if decision == "pass":
        return "record_learning"
    if decision == "regenerate":
        return "apply_correction"
    return END


def build_studio_graph(checkpointer=None):
    workflow = StateGraph(AgentWorkflowState)

    workflow.add_node("inspect_evidence", node_inspect_evidence)
    workflow.add_node("extract_dna", node_extract_dna)
    workflow.add_node("retrieve_memory", node_retrieve_memory)
    workflow.add_node("plan_poses", node_plan_poses)
    workflow.add_node("route_generation", node_route_generation)
    workflow.add_node("evaluate_qa", node_evaluate_qa)
    workflow.add_node("apply_correction", node_apply_correction)
    workflow.add_node("record_learning", node_record_learning)

    workflow.add_edge(START, "inspect_evidence")
    workflow.add_edge("inspect_evidence", "extract_dna")
    workflow.add_edge("extract_dna", "retrieve_memory")
    workflow.add_edge("retrieve_memory", "plan_poses")
    workflow.add_edge("plan_poses", "route_generation")
    workflow.add_conditional_edges(
        "route_generation",
        route_after_generation_plan,
        {"evaluate_qa": "evaluate_qa", END: END},
    )
    workflow.add_conditional_edges(
        "evaluate_qa",
        route_after_qa,
        {
            "record_learning": "record_learning",
            "apply_correction": "apply_correction",
            END: END,
        },
    )
    workflow.add_edge("apply_correction", END)
    workflow.add_edge("record_learning", END)

    if checkpointer is not None:
        return workflow.compile(checkpointer=checkpointer)
    return workflow.compile()


def get_postgres_checkpointer():
    """Return a shared PostgresSaver backed by the PostgreSQL ConnectionPool."""
    global _postgres_checkpointer, _checkpointer_initialized
    if not (PostgresSaver and settings.DATABASE_URL):
        return None
    if _postgres_checkpointer is None:
        pool = get_pool()
        saver = PostgresSaver(pool)
        if not _checkpointer_initialized:
            saver.setup()
            _checkpointer_initialized = True
        _postgres_checkpointer = saver
        logger.info("Initialized pooled PostgresSaver checkpointer for LangGraph")
    return _postgres_checkpointer


def get_compiled_graph():
    """Build compiled LangGraph workflow with persistent PostgresSaver (or MemorySaver offline)."""
    try:
        checkpointer = get_postgres_checkpointer()
    except Exception as e:
        logger.warning(f"Could not initialize PostgresSaver, falling back to MemorySaver: {e}")
        checkpointer = None
    if checkpointer is None:
        checkpointer = MemorySaver()
    return build_studio_graph(checkpointer=checkpointer)


def list_workflow_threads(limit: int = 30) -> List[Dict[str, Any]]:
    """Inspect recent LangGraph checkpointed threads stored in PostgreSQL."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT thread_id,
                       COUNT(*)::int AS checkpoint_count,
                       MAX(checkpoint_id) AS latest_checkpoint_id
                FROM public.checkpoints
                GROUP BY thread_id
                ORDER BY MAX(checkpoint_id) DESC
                LIMIT %s
                """,
                (limit,),
            )
            return cur.fetchall()


def get_thread_state_history(thread_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Retrieve persisted step-by-step state snapshots for a LangGraph thread."""
    graph = get_compiled_graph()
    config = {"configurable": {"thread_id": thread_id}}
    history: List[Dict[str, Any]] = []
    for snap in graph.get_state_history(config):
        values = snap.values if isinstance(snap.values, dict) else {}
        history.append({
            "checkpoint_id": (snap.config.get("configurable") or {}).get("checkpoint_id"),
            "next": list(snap.next or ()),
            "status": values.get("status"),
            "sku_id": values.get("sku_id"),
            "dna_approved": values.get("dna_approved"),
            "pose_plans_count": len(values.get("pose_plans") or []),
            "correction_decision": values.get("correction_decision"),
            "requires_human_review": values.get("requires_human_review"),
            "metadata": snap.metadata,
        })
        if len(history) >= limit:
            break
    return history
