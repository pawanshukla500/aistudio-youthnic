import json
import logging
import threading
import time
from typing import Optional, Any, Dict, Tuple, Set
import redis

from config import settings

logger = logging.getLogger(__name__)

_valkey_lock = threading.Lock()
_valkey_client: Optional[redis.Redis] = None
MAX_LOCAL_FALLBACK_KEYS = 128


def is_valkey_open() -> bool:
    """Return True when the shared Valkey client is currently initialized."""
    with _valkey_lock:
        return _valkey_client is not None


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
                max_connections=4,
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


class ValkeyCacheManager:
    def __init__(self):
        self._lock = threading.RLock()
        self._custom_r = None
        self._offline_until = 0.0
        self._local_fallback: Dict[str, Tuple[str, Optional[float]]] = {}
        self._pending_deletes: Set[str] = set()
        # value, absolute expiry (time.time()) or None when the write has no TTL
        self._pending_writes: Dict[str, Tuple[str, Optional[float]]] = {}

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
            now = time.time()
            if key not in self._local_fallback and len(self._local_fallback) >= MAX_LOCAL_FALLBACK_KEYS:
                expired_keys = [
                    k for k, (_, exp) in self._local_fallback.items()
                    if exp is not None and now >= exp
                ]
                for k in expired_keys:
                    self._local_fallback.pop(k, None)
                while len(self._local_fallback) >= MAX_LOCAL_FALLBACK_KEYS:
                    oldest_key = next(iter(self._local_fallback))
                    self._local_fallback.pop(oldest_key, None)
            expires_at = (now + ex) if ex is not None else None
            self._local_fallback[key] = (value, expires_at)

    def clear_local_fallback(self) -> None:
        """Release in-memory fallback entries when idling to keep RSS minimal."""
        with self._lock:
            self._local_fallback.clear()

    def _remember_write(self, key: str, value: str, ex: Optional[int]) -> None:
        """Queue a Valkey write that happened while the cache was unreachable."""
        with self._lock:
            self._local_set(key, value, ex=ex)
            expires_at = None if ex is None else time.time() + max(0, ex)
            self._pending_writes[key] = (value, expires_at)
            self._pending_deletes.discard(key)

    def _reconcile_pending(self):
        """Flush offline writes and invalidations before trusting Redis again.

        A write during a Valkey sleep must be replayed. Treating it as a delete
        dropped Product DNA on the next read. Replay keeps the remaining TTL.
        """
        with self._lock:
            now = time.time()
            for key, (_value, expires_at) in list(self._pending_writes.items()):
                if expires_at is not None and expires_at <= now:
                    self._pending_writes.pop(key, None)
                    self._local_fallback.pop(key, None)
            if not self._pending_deletes and not self._pending_writes:
                return
            writes = []
            for key, (value, expires_at) in self._pending_writes.items():
                remaining = None if expires_at is None else max(1, int(expires_at - now))
                writes.append((key, value, expires_at, remaining))
            write_keys = {key for key, _value, _expires_at, _remaining in writes}
            deletes = [key for key in self._pending_deletes if key not in write_keys]
        if deletes:
            self.r.delete(*deletes)
        applied = []
        for key, value, expires_at, remaining in writes:
            self.r.set(key, value, ex=remaining)
            applied.append((key, value, expires_at))
        corrective: list[str] = []
        with self._lock:
            self._pending_deletes.difference_update(deletes)
            for key, value, expires_at in applied:
                if key in self._pending_deletes:
                    corrective.append(key)
                    self._pending_writes.pop(key, None)
                    continue
                if self._pending_writes.get(key) != (value, expires_at):
                    continue
                self._pending_writes.pop(key, None)
        if corrective:
            self.r.delete(*corrective)
            with self._lock:
                for key in corrective:
                    if key not in self._pending_writes:
                        self._pending_deletes.discard(key)

    def _safe_get(self, key: str) -> Optional[str]:
        if self._is_offline():
            return self._local_get(key)
        try:
            self._reconcile_pending()
            # A successful Redis miss is authoritative. Another process may have
            # deleted the shared key; this process's local copy must not revive it.
            return self.r.get(key)
        except Exception as e:
            self._mark_offline(e)
            return self._local_get(key)

    def _safe_set(self, key: str, value: str, ex: Optional[int] = None, nx: bool = False) -> bool:
        if self._is_offline():
            with self._lock:
                if nx:
                    return False
            self._remember_write(key, value, ex)
            return True
        try:
            self._reconcile_pending()
            acquired = bool(self.r.set(key, value, ex=ex, nx=nx))
            if acquired:
                with self._lock:
                    self._local_set(key, value, ex=ex)
                    self._pending_deletes.discard(key)
                    pending = self._pending_writes.get(key)
                    if pending and pending[0] == value:
                        self._pending_writes.pop(key, None)
            return acquired
        except Exception as e:
            self._mark_offline(e)
            with self._lock:
                if nx:
                    return False
            self._remember_write(key, value, ex)
            return True

    def _safe_delete(self, *keys: str, defer_invalidation: bool = True):
        with self._lock:
            for k in keys:
                self._local_fallback.pop(k, None)
                self._pending_writes.pop(k, None)
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

    # 3. Provider Health Cache (Circuit breaker status, TTL: 60s)
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

    # 4. Invalidation
    def invalidate_sku_cache(self, org_id: str, sku_id: str):
        dna_key = f"cache:dna:v2:{org_id}:{sku_id}"
        with self._lock:
            self._pending_writes.pop(dna_key, None)
            self._local_fallback.pop(dna_key, None)
        self._safe_delete(dna_key)


cache_manager = ValkeyCacheManager()
