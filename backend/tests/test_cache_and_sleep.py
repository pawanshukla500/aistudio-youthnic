import json
import threading
import time
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

import pytest


class FakeValkey:
    def __init__(self):
        self.store = {}
        self.hashes = {}
        self.lists = {}

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value, ex=None, nx=False):
        if nx and key in self.store:
            return False
        self.store[key] = value
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

    def llen(self, key):
        return len(self.lists.get(key, []))

    def hlen(self, key):
        return len(self.hashes.get(key, {}))

    def close(self):
        return None


class FakeProc:
    def __init__(self, pid: int = 4242):
        self.pid = pid
        self._terminated = False

    def poll(self):
        return 0 if self._terminated else None

    def terminate(self):
        self._terminated = True

    def wait(self, timeout=None):
        return 0

    def kill(self):
        self._terminated = True


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


def test_memory_rules_cache_and_invalidation(monkeypatch):
    import cache

    fake_valkey = FakeValkey()
    monkeypatch.setattr(cache, "get_valkey", lambda: fake_valkey)

    assert cache.get_memory_rules_cache("org_1", "sig_a") is None
    cache.set_memory_rules_cache("org_1", "sig_a", ["Rule 1", "Rule 2"])
    assert cache.get_memory_rules_cache("org_1", "sig_a") == ["Rule 1", "Rule 2"]

    cache.invalidate_memory_rules_cache("org_1")
    assert cache.get_memory_rules_cache("org_1", "sig_a") is None


def test_evidence_and_pose_agents_use_valkey_caches(monkeypatch):
    import cache
    from agents import evidence_agent, pose_planning_agent

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

    # Pose planning agent caches both scene_lock and compiled prompts in Valkey
    planner = pose_planning_agent.CreativePosePlanningAgent()
    dna = {"sku_id": "sku_cache_1", "sku_name": "Violet Farshi", "bottom_wear": {"cut_class": "farshi"}}
    res = planner.process(
        {
            "organization_id": "7d56360f-2c96-4eb2-923e-f22b7fe36605",
            "sku_id": "sku_cache_1",
            "source_fingerprint": first["source_fingerprint"],
            "product_dna": dna,
        }
    )
    assert len(res["pose_plans"]) == 6
    assert any(k.startswith("cache:scene:") for k in fake_valkey.store)
    assert sum(1 for k in fake_valkey.store if k.startswith("cache:prompt:")) == 6

    # Sibling SKU keys sharing prefix must NOT be evicted by invalidate_sku_cache
    fake_valkey.store["cache:dna:v2:org_a:sku_1"] = "{}"
    fake_valkey.store["cache:dna:v2:org_a:sku_10"] = "{}"
    fake_valkey.store["cache:prompt:org_a:sku_1:1:abc"] = "p1"
    fake_valkey.store["cache:prompt:org_a:sku_10:1:abc"] = "p10"
    cache.cache_manager.invalidate_sku_cache("org_a", "sku_1")
    assert "cache:dna:v2:org_a:sku_1" not in fake_valkey.store
    assert "cache:prompt:org_a:sku_1:1:abc" not in fake_valkey.store
    assert "cache:dna:v2:org_a:sku_10" in fake_valkey.store
    assert "cache:prompt:org_a:sku_10:1:abc" in fake_valkey.store


def test_worker_supervisor_wake_idle_stop_and_http_auth(monkeypatch):
    import worker_supervisor
    from config import settings

    procs = []
    cleanups = []
    state = {"depth": 1, "active": 0}

    def spawn_fn():
        p = FakeProc(pid=1000 + len(procs))
        procs.append(p)
        return p

    supervisor = worker_supervisor.WorkerSupervisor(
        idle_timeout_seconds=0,
        poll_interval_seconds=0.0,
        queue_depth_fn=lambda: state["depth"],
        active_jobs_fn=lambda: state["active"],
        spawn_fn=spawn_fn,
        cleanup_fn=lambda: cleanups.append(True),
    )

    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "wake_secret_123")
    monkeypatch.setattr(settings, "INTERNAL_API_AUTH_BYPASS", False)

    server = ThreadingHTTPServer(("127.0.0.1", 0), worker_supervisor.make_handler(supervisor))
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    try:
        conn = HTTPConnection("127.0.0.1", port, timeout=3)
        conn.request("GET", "/health")
        r1 = conn.getresponse()
        body1 = json.loads(r1.read().decode())
        assert r1.status == 200
        assert body1["worker_running"] is False

        # GET /wake must be rejected with 405 Method Not Allowed
        conn.request("GET", "/wake", headers={"x-internal-secret": "wake_secret_123"})
        r_get_wake = conn.getresponse()
        r_get_wake.read()
        assert r_get_wake.status == 405

        # Unauthorized POST /wake must fail with 401
        conn.request("POST", "/wake")
        r2 = conn.getresponse()
        r2.read()
        assert r2.status == 401

        # Bypass must stay disabled in production even when secret is empty
        monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "")
        monkeypatch.setattr(settings, "INTERNAL_API_AUTH_BYPASS", True)
        monkeypatch.setattr(settings, "ENV", "production")
        conn.request("POST", "/wake")
        r_prod = conn.getresponse()
        r_prod.read()
        assert r_prod.status == 401

        monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "wake_secret_123")
        monkeypatch.setattr(settings, "INTERNAL_API_AUTH_BYPASS", False)
        monkeypatch.setattr(settings, "ENV", "development")

        # Authorized POST /wake spawns worker subprocess once
        conn.request("POST", "/wake", headers={"x-internal-secret": "wake_secret_123"})
        r3 = conn.getresponse()
        body3 = json.loads(r3.read().decode())
        assert r3.status == 202
        assert body3["worker_running"] is True
        assert len(procs) == 1

        # Probe error (None) must conservatively treat worker as busy
        state["depth"] = None
        assert supervisor.has_pending_work(unknown_is_busy=True) is True
        assert supervisor.check_idle_once() is False
        state["depth"] = 1

        # Worker must NOT stop while queue_depth > 0 or active_jobs > 0
        assert supervisor.check_idle_once() is False
        state["depth"] = 0
        state["active"] = 1
        assert supervisor.check_idle_once() is False

        # Once queue + active jobs stay 0, two passes cleanly stop Celery + cleanup sockets
        state["active"] = 0
        assert supervisor.check_idle_once() is False  # First idle observation
        time.sleep(0.01)
        assert supervisor.check_idle_once() is True  # Confirmed idle -> stop subprocess
        assert supervisor.worker_running is False
        assert procs[0]._terminated is True
        assert len(cleanups) >= 1
    finally:
        server.shutdown()
        server.server_close()


def test_wake_celery_worker_sends_secret_header(monkeypatch):
    from routes import generation
    from config import settings

    seen = {}

    class DummyResp:
        status_code = 202

    def fake_post(url, headers=None, timeout=None):
        seen["url"] = url
        seen["headers"] = headers
        return DummyResp()

    monkeypatch.setattr(settings, "CELERY_WORKER_WAKE_URL", "http://worker.test:8080/wake")
    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "top_secret")
    monkeypatch.setattr(generation.httpx, "post", fake_post)

    assert generation.wake_celery_worker() is True
    assert seen["url"] == "http://worker.test:8080/wake"
    assert seen["headers"]["x-internal-secret"] == "top_secret"

    # Inside Railway environment, default private DNS wake URL activates automatically
    monkeypatch.setattr(settings, "CELERY_WORKER_WAKE_URL", "")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_ID", "env_123")
    seen.clear()
    assert generation.wake_celery_worker() is True
    assert seen["url"] == "http://celery-worker.railway.internal:8080/wake"

