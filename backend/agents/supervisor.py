import logging
from typing import Dict, Any
from agents.evidence_agent import ProductEvidenceAgent
from agents.dna_agent import ProductDNAAgent
from agents.memory_agent import KnowledgeMemoryAgent
from agents.pose_planning_agent import CreativePosePlanningAgent
from agents.router_agent import GenerationRouterAgent
from agents.qa_agent import ComputerVisionQAAgent
from agents.correction_agent import CorrectionAgent
from agents.learning_agent import LearningOptimizationAgent
from agents.reliability_agent import ReliabilityAgent

logger = logging.getLogger(__name__)


class SupervisorOrchestratorAgent:
    """Master workflow orchestrator managing state transitions, agent handoffs,

    budget validation, and conditional branches across the photoshoot lifecycle.
    """

    def __init__(self):
        self.evidence_agent = ProductEvidenceAgent()
        self.dna_agent = ProductDNAAgent()
        self.memory_agent = KnowledgeMemoryAgent()
        self.pose_agent = CreativePosePlanningAgent()
        self.router_agent = GenerationRouterAgent()
        self.qa_agent = ComputerVisionQAAgent()
        self.correction_agent = CorrectionAgent()
        self.learning_agent = LearningOptimizationAgent()
        self.reliability_agent = ReliabilityAgent()

    def step_inspect_evidence(self, state: Dict[str, Any]) -> Dict[str, Any]:
        logger.info(f"Supervisor: Inspecting evidence for SKU {state.get('sku_id')}")
        return self.evidence_agent.process(state)

    def step_extract_dna(self, state: Dict[str, Any]) -> Dict[str, Any]:
        logger.info(f"Supervisor: Extracting/Verifying Product DNA for SKU {state.get('sku_id')}")
        return self.dna_agent.process(state)

    def step_retrieve_memory(self, state: Dict[str, Any]) -> Dict[str, Any]:
        logger.info(f"Supervisor: Retrieving fashion knowledge and learned rules for SKU {state.get('sku_id')}")
        return self.memory_agent.process(state)

    def step_plan_poses(self, state: Dict[str, Any]) -> Dict[str, Any]:
        logger.info(f"Supervisor: Planning 6 catalog poses with style quarantine for SKU {state.get('sku_id')}")
        return self.pose_agent.process(state)

    def step_route_generation(self, state: Dict[str, Any]) -> Dict[str, Any]:
        logger.info(f"Supervisor: Routing provider and quality for SKU {state.get('sku_id')}")
        return self.router_agent.process(state)
