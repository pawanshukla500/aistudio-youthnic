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
            socket_timeout=2,
            socket_connect_timeout=1,
            retry_on_timeout=False,
        )
    return _valkey_client


class ValkeyCacheManager:
    def __init__(self):
        self.r = get_valkey()
        self._offline_until = 0.0
        self._local_fallback: Dict[str, str] = {}

    def _is_offline(self) -> bool:
        return time.time() < self._offline_until

    def _mark_offline(self, err: Exception):
        self._offline_until = time.time() + 15.0
        logger.debug(f"Valkey unreachable, temporarily using local fallback: {err}")

    def _safe_get(self, key: str) -> Optional[str]:
        if self._is_offline():
            return self._local_fallback.get(key)
        try:
            return self.r.get(key)
        except Exception as e:
            self._mark_offline(e)
            return self._local_fallback.get(key)

    def _safe_set(self, key: str, value: str, ex: Optional[int] = None, nx: bool = False) -> bool:
        if nx and key in self._local_fallback:
            return False
        self._local_fallback[key] = value
        if self._is_offline():
            return True
        try:
            return bool(self.r.set(key, value, ex=ex, nx=nx))
        except Exception as e:
            self._mark_offline(e)
            return True

    def _safe_delete(self, *keys: str):
        for k in keys:
            self._local_fallback.pop(k, None)
        if self._is_offline():
            return
        try:
            if keys:
                self.r.delete(*keys)
        except Exception as e:
            self._mark_offline(e)

    # 1. Hot Product DNA Cache (TTL: 24h, invalidated on DNA update)
    def get_hot_dna(self, org_id: str, sku_id: str) -> Optional[Dict[str, Any]]:
        key = f"cache:dna:v2:{org_id}:{sku_id}"
        val = self._safe_get(key)
        return json.loads(val) if val else None

    def set_hot_dna(self, org_id: str, sku_id: str, dna_dict: Dict[str, Any], ttl: int = 86400):
        key = f"cache:dna:v2:{org_id}:{sku_id}"
        self._safe_set(key, json.dumps(dna_dict), ex=ttl)

    def invalidate_hot_dna(self, org_id: str, sku_id: str):
        key = f"cache:dna:v2:{org_id}:{sku_id}"
        self._safe_delete(key)

    # 2. Reference Manifest & Fingerprint Cache (TTL: 7 days)
    def get_manifest_cache(self, org_id: str, fingerprint: str) -> Optional[Dict[str, Any]]:
        key = f"cache:manifest:{org_id}:{fingerprint}"
        val = self._safe_get(key)
        return json.loads(val) if val else None

    def set_manifest_cache(self, org_id: str, fingerprint: str, manifest_data: Dict[str, Any], ttl: int = 604800):
        key = f"cache:manifest:{org_id}:{fingerprint}"
        self._safe_set(key, json.dumps(manifest_data), ex=ttl)

    # 3. Scene and Model Continuity Cache (TTL: 12h)
    def get_scene_lock(self, org_id: str, sku_id: str) -> Optional[Dict[str, Any]]:
        key = f"cache:scene:{org_id}:{sku_id}"
        val = self._safe_get(key)
        return json.loads(val) if val else None

    def set_scene_lock(self, org_id: str, sku_id: str, scene_data: Dict[str, Any], ttl: int = 43200):
        key = f"cache:scene:{org_id}:{sku_id}"
        self._safe_set(key, json.dumps(scene_data), ex=ttl)

    # 4. Compiled Prompt Cache (TTL: 4h)
    def get_compiled_prompt(self, org_id: str, sku_id: str, pose_number: int, prompt_hash: str) -> Optional[str]:
        key = f"cache:prompt:{org_id}:{sku_id}:{pose_number}:{prompt_hash}"
        return self._safe_get(key)

    def set_compiled_prompt(self, org_id: str, sku_id: str, pose_number: int, prompt_hash: str, prompt: str, ttl: int = 14400):
        key = f"cache:prompt:{org_id}:{sku_id}:{pose_number}:{prompt_hash}"
        self._safe_set(key, prompt, ex=ttl)

    # 5. Provider Health Cache (Circuit breaker status, TTL: 60s)
    def get_provider_health(self, provider: str) -> Dict[str, Any]:
        key = f"health:provider:{provider}"
        val = self._safe_get(key)
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
        self._safe_set(key, json.dumps(current), ex=300)

    # 6. Duplicate-Job Protection & Lock
    def is_job_active(self, org_id: str, sku_id: str) -> bool:
        key = f"lock:active_job:{org_id}:{sku_id}"
        if self._is_offline():
            return key in self._local_fallback
        try:
            return bool(self.r.exists(key))
        except Exception as e:
            self._mark_offline(e)
            return key in self._local_fallback

    def mark_job_active(self, org_id: str, sku_id: str, job_id: str, ttl: int = 1800) -> bool:
        key = f"lock:active_job:{org_id}:{sku_id}"
        return self._safe_set(key, job_id, nx=True, ex=ttl)

    def release_job_active(self, org_id: str, sku_id: str):
        key = f"lock:active_job:{org_id}:{sku_id}"
        self._safe_delete(key)

    # 7. Invalidation
    def invalidate_sku_cache(self, org_id: str, sku_id: str):
        prefix = f"cache:"
        suffix = f":{org_id}:{sku_id}"
        for k in list(self._local_fallback.keys()):
            if k.startswith(prefix) and suffix in k:
                self._local_fallback.pop(k, None)
        if not self._is_offline():
            pattern = f"cache:*:{org_id}:{sku_id}*"
            try:
                for k in self.r.scan_iter(match=pattern):
                    self._safe_delete(k)
            except Exception as e:
                self._mark_offline(e)
        self._safe_delete(f"cache:dna:v2:{org_id}:{sku_id}", f"cache:scene:{org_id}:{sku_id}")


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
