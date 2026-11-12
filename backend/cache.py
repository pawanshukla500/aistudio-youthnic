import json
import logging
import threading
import time
import uuid
from typing import Optional, Any, Dict, Tuple, Set
from contextlib import contextmanager
import redis

from config import settings

logger = logging.getLogger(__name__)

_valkey_lock = threading.Lock()
_valkey_client: Optional[redis.Redis] = None


def get_valkey() -> redis.Redis:
    global _valkey_client
    with _valkey_lock:
        if _valkey_client is None:
            _valkey_client = redis.from_url(
                settings.VALKEY_URL,
                decode_responses=True,
                socket_timeout=5,
                socket_connect_timeout=5,
                retry_on_timeout=True,
                socket_keepalive=False,
                health_check_interval=0,
            )
        return _valkey_client


def reset_valkey() -> None:
    """Close and reset shared Valkey client so idle/stale sockets are dropped cleanly."""
    global _valkey_client
    with _valkey_lock:
        if _valkey_client is not None:
            try:
                _valkey_client.close()
            except Exception:
                pass
            _valkey_client = None


def get_memory_rules_cache(org_id: str, cache_key: str) -> Optional[list[str]]:
    return cache_manager.get_memory_rules(org_id, cache_key)


def set_memory_rules_cache(org_id: str, cache_key: str, rules: list[str], ttl: int = 1800) -> None:
    cache_manager.set_memory_rules(org_id, cache_key, rules, ttl=ttl)


def invalidate_memory_rules_cache(org_id: str) -> None:
    cache_manager.invalidate_memory_rules(org_id)


def get_celery_queue_depth(queue_name: str = "celery") -> int:
    try:
        r = get_valkey()
        depth = int(r.llen(queue_name) or 0)
        reset_valkey()
        return depth
    except Exception:
        reset_valkey()
        return 0


class ValkeyCacheManager:
    def __init__(self):
        self._lock = threading.RLock()
        self._custom_r = None
        self._offline_until = 0.0
        self._local_fallback: Dict[str, Tuple[str, Optional[float]]] = {}
        self._pending_deletes: Set[str] = set()
        self._memory_versions: Dict[str, int] = {}

    @property
    def r(self):
        return self._custom_r if self._custom_r is not None else get_valkey()

    @r.setter
    def r(self, client):
        self._custom_r = client

    def _is_offline(self) -> bool:
        with self._lock:
            return time.time() < self._offline_until

    def _mark_offline(self, err: Exception):
        with self._lock:
            self._offline_until = time.time() + 15.0
        logger.debug(f"Valkey unreachable, temporarily using local fallback: {err}")

    def _local_get(self, key: str) -> Optional[str]:
        with self._lock:
            entry = self._local_fallback.get(key)
            if not entry:
                return None
            val, expires_at = entry
            if expires_at is not None and time.time() >= expires_at:
                self._local_fallback.pop(key, None)
                return None
            return val

    def _local_set(self, key: str, value: str, ex: Optional[int] = None):
        with self._lock:
            expires_at = (time.time() + ex) if ex is not None else None
            self._local_fallback[key] = (value, expires_at)

    def _reconcile_pending(self):
        """Flush offline cache invalidations to Redis before trusting Redis reads again."""
        with self._lock:
            if not self._pending_deletes:
                return
            keys = list(self._pending_deletes)
        self.r.delete(*keys)
        with self._lock:
            self._pending_deletes.difference_update(keys)

    def _safe_get(self, key: str) -> Optional[str]:
        if self._is_offline():
            return self._local_get(key)
        try:
            self._reconcile_pending()
            return self.r.get(key)
        except Exception as e:
            self._mark_offline(e)
            return self._local_get(key)

    def _safe_set(self, key: str, value: str, ex: Optional[int] = None, nx: bool = False) -> bool:
        if self._is_offline():
            with self._lock:
                if nx:
                    return False
                self._local_set(key, value, ex=ex)
                self._pending_deletes.add(key)
                return True
        try:
            self._reconcile_pending()
            acquired = bool(self.r.set(key, value, ex=ex, nx=nx))
            if acquired:
                with self._lock:
                    self._local_set(key, value, ex=ex)
                    self._pending_deletes.discard(key)
            return acquired
        except Exception as e:
            self._mark_offline(e)
            with self._lock:
                if nx:
                    return False
                self._local_set(key, value, ex=ex)
                self._pending_deletes.add(key)
                return True

    def _safe_delete(self, *keys: str, defer_invalidation: bool = True):
        with self._lock:
            for k in keys:
                self._local_fallback.pop(k, None)
            if not keys:
                return
            if self._is_offline():
                if defer_invalidation:
                    self._pending_deletes.update(keys)
                return
        try:
            self._reconcile_pending()
            self.r.delete(*keys)
        except Exception as e:
            if defer_invalidation:
                with self._lock:
                    self._pending_deletes.update(keys)
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
            return True
        try:
            self._reconcile_pending()
            return bool(self.r.exists(key))
        except Exception as e:
            self._mark_offline(e)
            return True

    def mark_job_active(self, org_id: str, sku_id: str, job_id: str, ttl: int = 1800) -> bool:
        key = f"lock:active_job:{org_id}:{sku_id}"
        return self._safe_set(key, job_id, nx=True, ex=ttl)

    def release_job_active(self, org_id: str, sku_id: str, expected_job_id: Optional[str] = None):
        key = f"lock:active_job:{org_id}:{sku_id}"
        with self._lock:
            self._local_fallback.pop(key, None)
        if self._is_offline():
            if not expected_job_id:
                with self._lock:
                    self._pending_deletes.add(key)
            return
        try:
            if expected_job_id:
                lua = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
                self.r.eval(lua, 1, key, expected_job_id)
            else:
                self.r.delete(key)
        except Exception as e:
            if not expected_job_id:
                with self._lock:
                    self._pending_deletes.add(key)
            self._mark_offline(e)

    # 7. Memory Rules Cache (Versioned per org, shares offline circuit breaker)
    def _memory_ver(self, org_id: str) -> int:
        org_ns = org_id or "global"
        ver_key = f"memory:ver:{org_ns}"
        val = self._safe_get(ver_key)
        if val is not None:
            try:
                return int(val)
            except ValueError:
                pass
        with self._lock:
            return self._memory_versions.get(org_ns, 0)

    def get_memory_rules(self, org_id: str, cache_key: str) -> Optional[list[str]]:
        org_ns = org_id or "global"
        ver = self._memory_ver(org_ns)
        raw = self._safe_get(f"memory:rules:{org_ns}:v{ver}:{cache_key}")
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(x) for x in parsed]
            except Exception:
                pass
        return None

    def set_memory_rules(self, org_id: str, cache_key: str, rules: list[str], ttl: int = 1800) -> None:
        org_ns = org_id or "global"
        ver = self._memory_ver(org_ns)
        self._safe_set(f"memory:rules:{org_ns}:v{ver}:{cache_key}", json.dumps(rules), ex=ttl)

    def invalidate_memory_rules(self, org_id: str) -> None:
        org_ns = org_id or "global"
        ver_key = f"memory:ver:{org_ns}"
        with self._lock:
            next_local = self._memory_versions.get(org_ns, 0) + 1
            self._memory_versions[org_ns] = next_local
        if self._is_offline():
            self._safe_set(ver_key, str(next_local), ex=604800)
            return
        try:
            self._reconcile_pending()
            new_ver = int(self.r.incr(ver_key))
            self.r.expire(ver_key, 604800)
            with self._lock:
                self._memory_versions[org_ns] = new_ver
                self._local_set(ver_key, str(new_ver), ex=604800)
        except Exception as e:
            self._mark_offline(e)
            self._local_set(ver_key, str(next_local), ex=604800)

    # 8. Invalidation
    def invalidate_sku_cache(self, org_id: str, sku_id: str):
        dna_key = f"cache:dna:v2:{org_id}:{sku_id}"
        scene_key = f"cache:scene:{org_id}:{sku_id}"
        prompt_prefix = f"cache:prompt:{org_id}:{sku_id}:"
        with self._lock:
            for k in list(self._local_fallback.keys()):
                if k == dna_key or k == scene_key or k.startswith(prompt_prefix):
                    self._local_fallback.pop(k, None)
        keys_to_delete = [dna_key, scene_key]
        if not self._is_offline():
            try:
                for k in self.r.scan_iter(match=f"{prompt_prefix}*"):
                    keys_to_delete.append(k)
            except Exception as e:
                self._mark_offline(e)
        self._safe_delete(*keys_to_delete)


# Distributed Lock Context Manager
@contextmanager
def distributed_lock(lock_key: str, timeout_seconds: int = 60, retry_delay: float = 0.2):
    r = get_valkey()
    full_key = f"lock:{lock_key}"
    end_time = time.time() + timeout_seconds
    acquired = False
    token = str(uuid.uuid4())

    try:
        while time.time() < end_time:
            try:
                if r.set(full_key, token, nx=True, ex=timeout_seconds):
                    acquired = True
                    break
            except Exception as e:
                logger.warning(f"Redis lock acquisition error for {lock_key}: {e}")
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
            try:
                r.eval(lua, 1, full_key, token)
            except Exception as e:
                logger.warning(f"Failed releasing distributed lock {full_key}: {e}")


cache_manager = ValkeyCacheManager()
