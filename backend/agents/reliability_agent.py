import logging
import time
from typing import Dict, Any
from cache import cache_manager

logger = logging.getLogger(__name__)


class ReliabilityAgent:
    """Monitors provider health, tracks latency, checks budget consumption,

    and triggers deterministic recovery or provider failover.
    """

    def check_health(self) -> Dict[str, Any]:
        openai_health = cache_manager.get_provider_health("openai")
        meta_health = cache_manager.get_provider_health("meta")

        return {
            "status": "operational",
            "timestamp": time.time(),
            "providers": {
                "openai": openai_health,
                "meta": meta_health,
            },
        }

    def evaluate_budget(self, current_cost: float, max_budget: float) -> bool:
        if current_cost >= max_budget:
            logger.error(f"Budget exceeded: current ${current_cost:.2f} >= max ${max_budget:.2f}")
            return False
        return True

    def handle_provider_failure(self, provider: str, error_message: str):
        logger.warning(f"Recording failure for provider {provider}: {error_message}")
        cache_manager.record_provider_result(provider, success=False, error=error_message)
