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
        requested_model = state.get("requested_model") or state.get("image_model")
        valid_openai_models = [
            "gpt-image-2.6-sunburst",
            "gpt-image-2.6-flare",
            "gpt-image-2.6",
            "gpt-image-2.5-flare-2026-09-08",
            "gpt-image-2.5-flare",
            "gpt-image-2.5-sunburst",
        ]
        if requested_model in valid_openai_models:
            selected_model = requested_model
        else:
            selected_model = "gpt-image-2.6-sunburst"

        # Cost estimation per pose aligned with ai_clients.estimate_image_cost_usd
        if "2.6-sunburst" in selected_model:
            est_cost_per_pose = 0.18
        elif "2.6" in selected_model:
            est_cost_per_pose = 0.16
        elif "2.5-sunburst" in selected_model:
            est_cost_per_pose = 0.12
        else:
            est_cost_per_pose = 0.08
        poses_count = len(state.get("poses_to_generate", [1, 2, 3, 4, 5, 6]))
        est_total = budget_used + (poses_count * est_cost_per_pose)

        if est_total > max_budget:
            if selected_model != "gpt-image-2.5-flare-2026-09-08":
                logger.warning(
                    f"Projected budget (${est_total:.2f}) exceeds limit (${max_budget:.2f}); downgrading model to gpt-image-2.5-flare-2026-09-08"
                )
                selected_model = "gpt-image-2.5-flare-2026-09-08"
                est_cost_per_pose = 0.08
                est_total = budget_used + (poses_count * est_cost_per_pose)
            if est_total > max_budget:
                raise ValueError(
                    f"Projected generation cost (${est_total:.2f}) exceeds maximum budget (${max_budget:.2f})."
                )

        route_info = {
            "image_provider": selected_provider,
            "image_model": selected_model,
            "quality": state.get("quality", "medium"),
            "aspect_ratio": "3:4",
            "est_cost_per_pose": est_cost_per_pose,
            "est_total_cost_usd": round(est_total, 4),
            "circuit_breaker": "closed" if is_openai_healthy else "open",
        }

        return {
            "provider_route": route_info,
        }
