import logging
from typing import Optional
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
try:
    from langgraph.checkpoint.postgres import PostgresSaver
except ImportError:
    PostgresSaver = None

import psycopg
from config import settings
from agents.state import AgentWorkflowState
from agents.supervisor import SupervisorOrchestratorAgent

logger = logging.getLogger(__name__)

supervisor = SupervisorOrchestratorAgent()


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


def build_studio_graph(checkpointer=None):
    workflow = StateGraph(AgentWorkflowState)

    # Add workflow nodes
    workflow.add_node("inspect_evidence", node_inspect_evidence)
    workflow.add_node("extract_dna", node_extract_dna)
    workflow.add_node("retrieve_memory", node_retrieve_memory)
    workflow.add_node("plan_poses", node_plan_poses)
    workflow.add_node("route_generation", node_route_generation)

    # Add sequential and conditional edges
    workflow.add_edge(START, "inspect_evidence")
    workflow.add_edge("inspect_evidence", "extract_dna")
    workflow.add_edge("extract_dna", "retrieve_memory")
    workflow.add_edge("retrieve_memory", "plan_poses")
    workflow.add_edge("plan_poses", "route_generation")
    workflow.add_edge("route_generation", END)

    if checkpointer is not None:
        return workflow.compile(checkpointer=checkpointer)
    return workflow.compile()


def get_compiled_graph():
    """Builds compiled graph with PostgresSaver checkpointing if available."""
    checkpointer = None
    if PostgresSaver and settings.DATABASE_URL:
        try:
            conn = psycopg.connect(settings.DATABASE_URL, autocommit=True)
            checkpointer = PostgresSaver(conn)
            logger.info("Using PostgresSaver checkpointer for LangGraph workflow")
        except Exception as e:
            logger.warning(f"Could not initialize PostgresSaver, falling back to MemorySaver: {e}")
            checkpointer = MemorySaver()
    else:
        checkpointer = MemorySaver()

    return build_studio_graph(checkpointer=checkpointer)
