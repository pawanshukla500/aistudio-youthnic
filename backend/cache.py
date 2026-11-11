import json
import logging
import time
from typing import Optional, Any, Dict
from contextlib import contextmanager
import redis

from config import settings

logger = logging.getLogger(__name__)

_valkey_client: Optional[redis.Redis] = None


def get_valkey() -> redis.Redis:
    global _valkey_client
    if _valkey_client is None:
        _valkey_client = redis.from_url(
            settings.VALKEY_URL,
            decode_responses=True,
            socket_timeout=5,
            socket_connect_timeout=5,
            retry_on_timeout=True,
        )
    return _valkey_client


class ValkeyCacheManager:
    def __init__(self):
        self.r = get_valkey()

    # 1. Hot Product DNA Cache (TTL: 24h, invalidated on DNA update)
    def get_hot_dna(self, org_id: str, sku_id: str) -> Optional[Dict[str, Any]]:
        key = f"cache:dna:v2:{org_id}:{sku_id}"
        val = self.r.get(key)
        return json.loads(val) if val else None

    def set_hot_dna(self, org_id: str, sku_id: str, dna_dict: Dict[str, Any], ttl: int = 86400):
        key = f"cache:dna:v2:{org_id}:{sku_id}"
        self.r.set(key, json.dumps(dna_dict), ex=ttl)

    # 2. Reference Manifest & Fingerprint Cache (TTL: 7 days)
    def get_manifest_cache(self, org_id: str, fingerprint: str) -> Optional[Dict[str, Any]]:
        key = f"cache:manifest:{org_id}:{fingerprint}"
        val = self.r.get(key)
        return json.loads(val) if val else None

    def set_manifest_cache(self, org_id: str, fingerprint: str, manifest_data: Dict[str, Any], ttl: int = 604800):
        key = f"cache:manifest:{org_id}:{fingerprint}"
        self.r.set(key, json.dumps(manifest_data), ex=ttl)

    # 3. Scene and Model Continuity Cache (TTL: 12h)
    def get_scene_lock(self, org_id: str, sku_id: str) -> Optional[Dict[str, Any]]:
        key = f"cache:scene:{org_id}:{sku_id}"
        val = self.r.get(key)
        return json.loads(val) if val else None

    def set_scene_lock(self, org_id: str, sku_id: str, scene_data: Dict[str, Any], ttl: int = 43200):
        key = f"cache:scene:{org_id}:{sku_id}"
        self.r.set(key, json.dumps(scene_data), ex=ttl)

    # 4. Compiled Prompt Cache (TTL: 4h)
    def get_compiled_prompt(self, org_id: str, sku_id: str, pose_number: int, prompt_hash: str) -> Optional[str]:
        key = f"cache:prompt:{org_id}:{sku_id}:{pose_number}:{prompt_hash}"
        return self.r.get(key)

    def set_compiled_prompt(self, org_id: str, sku_id: str, pose_number: int, prompt_hash: str, prompt: str, ttl: int = 14400):
        key = f"cache:prompt:{org_id}:{sku_id}:{pose_number}:{prompt_hash}"
        self.r.set(key, prompt, ex=ttl)

    # 5. Provider Health Cache (Circuit breaker status, TTL: 60s)
    def get_provider_health(self, provider: str) -> Dict[str, Any]:
        key = f"health:provider:{provider}"
        val = self.r.get(key)
        if val:
            return json.loads(val)
        return {"status": "healthy", "error_count": 0, "last_checked": time.time()}

    def record_provider_result(self, provider: str, success: bool, error: Optional[str] = None):
        key = f"health:provider:{provider}"
        current = self.get_provider_health(provider)
        if success:
            current["status"] = "healthy"
            current["error_count"] = 0
            current["last_success"] = time.time()
        else:
            current["error_count"] = current.get("error_count", 0) + 1
            if current["error_count"] >= 3:
                current["status"] = "degraded"
            current["last_error"] = error
            current["last_failure"] = time.time()
        self.r.set(key, json.dumps(current), ex=300)

    # 6. Duplicate-Job Protection & Lock
    def is_job_active(self, org_id: str, sku_id: str) -> bool:
        key = f"lock:active_job:{org_id}:{sku_id}"
        return bool(self.r.exists(key))

    def mark_job_active(self, org_id: str, sku_id: str, job_id: str, ttl: int = 1800) -> bool:
        key = f"lock:active_job:{org_id}:{sku_id}"
        return bool(self.r.set(key, job_id, nx=True, ex=ttl))

    def release_job_active(self, org_id: str, sku_id: str):
        key = f"lock:active_job:{org_id}:{sku_id}"
        self.r.delete(key)

    # 7. Invalidation
    def invalidate_sku_cache(self, org_id: str, sku_id: str):
        pattern = f"cache:*:{org_id}:{sku_id}*"
        for k in self.r.scan_iter(match=pattern):
            self.r.delete(k)
        self.r.delete(f"cache:dna:v2:{org_id}:{sku_id}")
        self.r.delete(f"cache:scene:{org_id}:{sku_id}")


# Distributed Lock Context Manager
@contextmanager
def distributed_lock(lock_key: str, timeout_seconds: int = 60, retry_delay: float = 0.2):
    r = get_valkey()
    full_key = f"lock:{lock_key}"
    end_time = time.time() + timeout_seconds
    acquired = False
    token = str(time.time())

    try:
        while time.time() < end_time:
            if r.set(full_key, token, nx=True, ex=timeout_seconds):
                acquired = True
                break
            time.sleep(retry_delay)

        if not acquired:
            raise TimeoutError(f"Could not acquire distributed lock for {lock_key} within {timeout_seconds}s")
        yield
    finally:
        if acquired:
            # Atomic release using Lua script to prevent deleting newer holder
            lua = """
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            else
                return 0
            end
            """
            r.eval(lua, 1, full_key, token)


cache_manager = ValkeyCacheManager()
