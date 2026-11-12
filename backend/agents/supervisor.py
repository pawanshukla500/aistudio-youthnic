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

    def step_evaluate_qa(self, state: Dict[str, Any]) -> Dict[str, Any]:
        pose_idx = int(state.get("qa_pose_index", state.get("current_pose_index", 1)))
        pose_type = str(state.get("qa_pose_type", "full_front"))
        image_url = str(state.get("qa_target_image_url") or "")
        dna = state.get("product_dna") or {}
        eval_res = self.qa_agent.evaluate(
            org_id=state["organization_id"],
            job_id=state.get("job_id", "workflow_job"),
            generation_id=f"{state.get('job_id', 'wf')}_pose_{pose_idx}",
            sku_id=state["sku_id"],
            pose_index=pose_idx,
            pose_type=pose_type,
            image_url=image_url,
            product_dna=dna,
            ai_raw_evaluation=state.get("ai_raw_evaluation"),
            reference_images=state.get("references"),
        )
        qa_map = dict(state.get("qa_evaluations") or {})
        qa_map[pose_idx] = eval_res.model_dump()

        if eval_res.outcome == "pass":
            if eval_res.requires_human_review:
                return {
                    "qa_evaluations": qa_map,
                    "correction_decision": "human_review",
                    "requires_human_review": True,
                    "status": "human_review_required",
                }
            return {
                "qa_evaluations": qa_map,
                "correction_decision": "pass",
                "requires_human_review": False,
                "status": "qa_passed",
            }

        attempts = dict(state.get("retry_counts") or {})
        attempt_count = int(attempts.get(pose_idx, 1))
        bottom_cut = str(((dna or {}).get("bottom_wear") or {}).get("cut_class") or "")
        if str((dna or {}).get("garment_family") or "").lower() == "saree":
            bottom_cut = "saree"
        action, updated_instruction = self.correction_agent.decide_action(
            pose_index=pose_idx,
            attempt_count=attempt_count,
            failed_checks=eval_res.failed_checks,
            guidance=eval_res.correction_guidance,
            anatomical_defect=eval_res.anatomical_defect_detected,
            style_violation=eval_res.style_quarantine_violation,
            bottom_cut=bottom_cut,
        )
        decision = "human_review" if action in ("human_review", "escalate") else "regenerate"
        return {
            "qa_evaluations": qa_map,
            "correction_decision": decision,
            "updated_instruction": updated_instruction,
            "requires_human_review": decision == "human_review",
            "status": "human_review_required" if decision == "human_review" else "correction_required",
        }

    def step_apply_correction(self, state: Dict[str, Any]) -> Dict[str, Any]:
        pose_idx = int(state.get("qa_pose_index", state.get("current_pose_index", 1)))
        qa_map = state.get("qa_evaluations") or {}
        last_qa = qa_map.get(pose_idx) or {}
        instruction = str(state.get("updated_instruction") or last_qa.get("correction_guidance") or "")
        self.correction_agent.record_correction(
            org_id=state["organization_id"],
            job_id=state.get("job_id", "workflow_job"),
            generation_id=f"{state.get('job_id', 'wf')}_pose_{pose_idx}",
            sku_id=state["sku_id"],
            pose_index=pose_idx,
            stage="qa_evaluation",
            mismatch=", ".join(last_qa.get("failed_checks") or ["qa_mismatch"]),
            action="pose_regeneration",
        )
        corrections = list(state.get("corrections") or [])
        corrections.append({"pose_index": pose_idx, "instruction": instruction, "action": "regenerate"})
        retry_counts = dict(state.get("retry_counts") or {})
        retry_counts[pose_idx] = int(retry_counts.get(pose_idx, 1)) + 1
        return {
            "corrections": corrections,
            "retry_counts": retry_counts,
            "status": "regeneration_scheduled",
        }

    def step_record_learning(self, state: Dict[str, Any]) -> Dict[str, Any]:
        dna = state.get("product_dna") or {}
        family = str(dna.get("garment_family") or "kurta_or_kurti_set")
        bw = dna.get("bottom_wear") or {}
        bottom_cut = "none" if family.lower() == "saree" or not bw.get("has_bottom_wear", True) else str(bw.get("cut_class") or "unknown")
        rule_type = "bottom_wear_preservation" if bottom_cut == "farshi" else ("fabric_fall" if family.lower() == "saree" else "scene_continuity")
        self.learning_agent.record_approved_outcome(
            org_id=state["organization_id"],
            sku_id=state["sku_id"],
            rule_type=rule_type,
            rule_text=f"Verified catalog generation for {dna.get('sku_name', state.get('sku_id'))} ({bottom_cut})",
            positive_guidance="; ".join(dna.get("explicit_invariants") or []),
            negative_constraints=dna.get("prohibited_changes") or [],
            category=str(dna.get("category") or "ethnic/fusion"),
            garment_family=family,
            bottom_cut=bottom_cut,
        )
        return {"status": "completed"}
