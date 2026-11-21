import time


class FakeValkey:
    def __init__(self):
        self.store = {}
        self.expirations = {}

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value, ex=None, nx=False):
        if nx and key in self.store:
            return False
        self.store[key] = value
        self.expirations[key] = ex
        return True

    def delete(self, *keys):
        removed = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                removed += 1
        return removed

    def exists(self, key):
        return 1 if key in self.store else 0

    def scan_iter(self, match="*"):
        import fnmatch
        return [k for k in list(self.store.keys()) if fnmatch.fnmatch(k, match)]

    def setex(self, key, ttl, value):
        self.store[key] = value

    def incr(self, key):
        val = int(self.store.get(key) or 0) + 1
        self.store[key] = str(val)
        return val

    def expire(self, key, ttl):
        return True

    def close(self):
        return None


def test_settings_prefers_postgres_private_url(monkeypatch):
    from config import Settings

    monkeypatch.setenv("POSTGRES_PRIVATE_URL", "postgresql://priv@postgres.railway.internal:5432/db")
    monkeypatch.setenv("DATABASE_URL", "postgresql://pub@zephyr.proxy.rlwy.net:40295/db")
    s = Settings()
    assert "postgres.railway.internal" in s.DATABASE_URL


def test_database_pool_uses_zero_min_size_and_no_keepalives(monkeypatch):
    import database

    captured = {}

    class DummyPool:
        closed = False

        def __init__(self, **kwargs):
            captured.update(kwargs)

        def close(self):
            self.closed = True

    monkeypatch.setattr(database.settings, "DATABASE_URL", "postgresql://u:p@h:5432/db")
    monkeypatch.setattr(database, "ConnectionPool", DummyPool)
    database.close_pool()

    database.get_pool()
    assert captured["min_size"] == 0
    assert captured["max_idle"] == 60.0
    assert captured["kwargs"]["keepalives"] == 0
    database.close_pool()


def test_offline_dna_write_is_flushed_instead_of_deleted(monkeypatch):
    import cache

    fake_valkey = FakeValkey()
    monkeypatch.setattr(cache, "get_valkey", lambda: fake_valkey)
    manager = cache.cache_manager
    monkeypatch.setattr(manager, "_custom_r", fake_valkey)
    monkeypatch.setattr(manager, "_offline_until", time.time() + 60)
    manager._pending_deletes.clear()
    manager._pending_writes.clear()
    manager._local_fallback.clear()

    manager.set_hot_dna("org_offline", "sku_face", {"source_fingerprint": "fp-1", "main_color": "ivory"})
    assert fake_valkey.store == {}
    assert any(key.startswith("cache:dna:v2:org_offline:sku_face") for key in manager._pending_writes)

    monkeypatch.setattr(manager, "_offline_until", 0.0)
    restored = manager.get_hot_dna("org_offline", "sku_face")
    assert restored["main_color"] == "ivory"
    assert restored["source_fingerprint"] == "fp-1"
    assert fake_valkey.store["cache:dna:v2:org_offline:sku_face"]
    assert "cache:dna:v2:org_offline:sku_face" not in manager._pending_deletes


def test_expired_offline_write_keeps_remaining_ttl_and_drops_when_due(monkeypatch):
    import cache

    fake_valkey = FakeValkey()
    monkeypatch.setattr(cache, "get_valkey", lambda: fake_valkey)
    manager = cache.cache_manager
    monkeypatch.setattr(manager, "_custom_r", fake_valkey)
    monkeypatch.setattr(manager, "_offline_until", time.time() + 60)
    manager._pending_deletes.clear()
    manager._pending_writes.clear()
    manager._local_fallback.clear()

    manager.set_hot_dna("org_ttl", "sku_keep", {"main_color": "keep-me"}, ttl=100)
    key = "cache:dna:v2:org_ttl:sku_keep"
    value, _expires_at = manager._pending_writes[key]
    manager._pending_writes[key] = (value, time.time() + 40)
    monkeypatch.setattr(manager, "_offline_until", 0.0)
    assert manager.get_hot_dna("org_ttl", "sku_keep") == {"main_color": "keep-me"}
    assert 1 <= fake_valkey.expirations[key] <= 40

    monkeypatch.setattr(manager, "_offline_until", time.time() + 60)
    manager.set_hot_dna("org_ttl", "sku_drop", {"main_color": "drop-me"}, ttl=10)
    expired_key = "cache:dna:v2:org_ttl:sku_drop"
    expired_value, _expired_at = manager._pending_writes[expired_key]
    manager._pending_writes[expired_key] = (expired_value, time.time() - 5)
    monkeypatch.setattr(manager, "_offline_until", 0.0)
    assert manager.get_hot_dna("org_ttl", "sku_drop") is None
    assert expired_key not in fake_valkey.store


def test_redis_miss_does_not_revive_local_dna(monkeypatch):
    import cache

    fake_valkey = FakeValkey()
    monkeypatch.setattr(cache, "get_valkey", lambda: fake_valkey)
    manager = cache.cache_manager
    monkeypatch.setattr(manager, "_custom_r", fake_valkey)
    monkeypatch.setattr(manager, "_offline_until", 0.0)
    manager._pending_deletes.clear()
    manager._pending_writes.clear()
    manager._local_fallback.clear()

    manager.set_hot_dna("org_miss", "sku_miss", {"main_color": "ivory"})
    del fake_valkey.store["cache:dna:v2:org_miss:sku_miss"]
    assert manager.get_hot_dna("org_miss", "sku_miss") is None


def test_sku_invalidation_drops_queued_dna(monkeypatch):
    import cache

    fake_valkey = FakeValkey()
    monkeypatch.setattr(cache, "get_valkey", lambda: fake_valkey)
    manager = cache.cache_manager
    monkeypatch.setattr(manager, "_custom_r", fake_valkey)
    monkeypatch.setattr(manager, "_offline_until", time.time() + 60)
    manager._pending_deletes.clear()
    manager._pending_writes.clear()
    manager._local_fallback.clear()

    manager.set_hot_dna("org_drop", "sku_drop", {"main_color": "queued"})
    manager.invalidate_sku_cache("org_drop", "sku_drop")
    monkeypatch.setattr(manager, "_offline_until", 0.0)
    assert manager.get_hot_dna("org_drop", "sku_drop") is None
    assert "cache:dna:v2:org_drop:sku_drop" not in fake_valkey.store


def test_invalidation_during_replay_is_not_restored(monkeypatch):
    import cache

    manager = cache.cache_manager

    class InvalidateOnSet(FakeValkey):
        def set(self, key, value, ex=None, nx=False):
            stored = super().set(key, value, ex=ex, nx=nx)
            if key.startswith("cache:dna:"):
                manager._pending_writes.pop(key, None)
                manager._pending_deletes.add(key)
            return stored

    fake_valkey = InvalidateOnSet()
    monkeypatch.setattr(cache, "get_valkey", lambda: fake_valkey)
    monkeypatch.setattr(manager, "_custom_r", fake_valkey)
    monkeypatch.setattr(manager, "_offline_until", time.time() + 60)
    manager._pending_deletes.clear()
    manager._pending_writes.clear()
    manager._local_fallback.clear()

    manager.set_hot_dna("org_race", "sku_race", {"main_color": "ivory"})
    monkeypatch.setattr(manager, "_offline_until", 0.0)
    assert manager.get_hot_dna("org_race", "sku_race") is None
    assert "cache:dna:v2:org_race:sku_race" not in fake_valkey.store


def test_evidence_agent_uses_manifest_cache_and_sku_invalidation_is_exact(monkeypatch):
    import cache
    from agents import evidence_agent

    fake_valkey = FakeValkey()
    monkeypatch.setattr(cache, "get_valkey", lambda: fake_valkey)
    monkeypatch.setattr(cache.cache_manager, "_offline_until", 0.0)
    monkeypatch.setattr(cache.cache_manager, "_custom_r", fake_valkey)

    load_calls = []

    def fake_load(ref, allow_local=False, organization_id=None):
        load_calls.append(ref["role"])
        return None

    monkeypatch.setattr(evidence_agent, "load_reference_image", fake_load)
    monkeypatch.setattr(evidence_agent, "save_reference_evidence", lambda **kw: "ev_1")

    ev_agent = evidence_agent.ProductEvidenceAgent()
    ev_state = {
        "organization_id": "7d56360f-2c96-4eb2-923e-f22b7fe36605",
        "sku_id": "sku_cache_1",
        "references": [
            {"role": "front", "downloadUrl": "https://example.com/f.jpg", "hash": "h1"},
            {"role": "bottom", "downloadUrl": "https://example.com/b.jpg", "hash": "h2"},
        ],
    }

    first = ev_agent.process(ev_state)
    assert len(load_calls) == 2
    assert any(k.startswith("cache:manifest:") for k in fake_valkey.store)
    second = ev_agent.process(ev_state)
    assert len(load_calls) == 2  # Cache hit skipped re-downloading references
    assert second["source_fingerprint"] == first["source_fingerprint"]

    # Sibling SKU keys sharing prefix must NOT be evicted by invalidate_sku_cache
    fake_valkey.store["cache:dna:v2:org_a:sku_1"] = "{}"
    fake_valkey.store["cache:dna:v2:org_a:sku_10"] = "{}"
    cache.cache_manager.invalidate_sku_cache("org_a", "sku_1")
    assert "cache:dna:v2:org_a:sku_1" not in fake_valkey.store
    assert "cache:dna:v2:org_a:sku_10" in fake_valkey.store


def test_bounded_fallback_cache_and_idle_release():
    import cache
    import database
    import main

    mgr = cache.ValkeyCacheManager()
    for idx in range(cache.MAX_LOCAL_FALLBACK_KEYS + 25):
        mgr._local_set(f"key_{idx}", f"val_{idx}", 60)
    assert len(mgr._local_fallback) <= cache.MAX_LOCAL_FALLBACK_KEYS
    mgr.clear_local_fallback()
    assert len(mgr._local_fallback) == 0

    trimmed = database.release_process_memory()
    assert isinstance(trimmed, bool)

    main.release_idle_resources()
    assert database.is_pool_open() is False
    assert cache.is_valkey_open() is False


