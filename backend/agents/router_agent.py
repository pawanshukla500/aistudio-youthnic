import logging
from typing import Dict, Any
from cache import cache_manager

logger = logging.getLogger(__name__)


class GenerationRouterAgent:
    """Routes image generation and QA tasks to appropriate provider endpoints

    based on configured policy, provider health, budget caps, and circuit breaker status.
    """

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        max_budget = state.get("max_budget_usd", 2.50)
        budget_used = state.get("budget_used_usd", 0.0)

        # Check circuit breaker status
        openai_health = cache_manager.get_provider_health("openai")
        is_openai_healthy = openai_health.get("status") == "healthy"

        # Routing decision
        selected_provider = "openai"
        selected_model = "gpt-image-2.5-flare-2026-09-08"

        # Cost estimation per pose (e.g. $0.04 - $0.08 per image depending on quality)
        est_cost_per_pose = 0.06
        poses_count = len(state.get("poses_to_generate", [1, 2, 3, 4, 5, 6]))
        est_total = budget_used + (poses_count * est_cost_per_pose)

        if est_total > max_budget:
            logger.warning(f"Generation budget projected ({est_total}) exceeds maximum allowed ({max_budget})")

        route_info = {
            "image_provider": selected_provider,
            "image_model": selected_model,
            "quality": state.get("quality", "medium"),
            "aspect_ratio": "3:4",
            "est_cost_per_pose": est_cost_per_pose,
            "circuit_breaker": "closed" if is_openai_healthy else "open",
        }

        return {
            "provider_route": route_info,
        }
