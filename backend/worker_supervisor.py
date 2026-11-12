"""On-demand Celery worker supervisor for zero-idle-cost Railway Serverless operation.

Why this exists:
- A bare `celery worker` continuously polls Valkey (BRPOP/heartbeats every few seconds),
  keeping both the worker service and Valkey awake 24/7.
- This HTTP supervisor listens on $PORT (/health, /wake) without holding open Valkey or
  PostgreSQL sockets when idle.
- When FastAPI submits or regenerates a generation job, it calls POST /wake on the private
  network, spawning `celery worker --without-gossip --without-mingle --without-heartbeat`.
- Once Valkey queue depth, unacked tasks, and active PostgreSQL generation jobs stay empty
  for WORKER_IDLE_SHUTDOWN_SECONDS, the Celery subprocess is stopped gracefully and sockets
  are closed so both celery-worker and Valkey enter Railway Serverless Sleep.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional

import redis

from cache import reset_valkey
from config import settings
from database import close_pool, get_db

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

DEFAULT_CELERY_CMD = [
    sys.executable,
    "-m",
    "celery",
    "-A",
    "celery_app.celery",
    "worker",
    "--loglevel=info",
    "--concurrency=2",
    "--without-gossip",
    "--without-mingle",
    "--without-heartbeat",
]


def default_queue_depth() -> Optional[int]:
    """Check pending + unacked Celery items in Valkey via a short-lived closed client."""
    client = None
    try:
        client = redis.from_url(
            settings.VALKEY_URL,
            decode_responses=True,
            socket_timeout=5,
            socket_connect_timeout=5,
            retry_on_timeout=False,
            socket_keepalive=False,
            health_check_interval=0,
        )
        pending = int(client.llen("celery") or 0)
        unacked = int(client.hlen("unacked") or 0)
        return pending + unacked
    except Exception as exc:
        logger.debug("Valkey queue depth check skipped: %s", exc)
        return None
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass


def default_active_jobs_count() -> Optional[int]:
    """Count queued/processing generation_jobs rows in PostgreSQL."""
    if not settings.DATABASE_URL:
        return 0
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS cnt FROM public.generation_jobs WHERE status IN ('queued', 'processing')"
                )
                row = cur.fetchone()
                return int((row or {}).get("cnt") or 0)
    except Exception as exc:
        logger.debug("Active DB jobs check skipped: %s", exc)
        return None


def default_cleanup() -> None:
    reset_valkey()
    close_pool()


class WorkerSupervisor:
    """Manages an on-demand Celery subprocess with idle auto-stop."""

    def __init__(
        self,
        *,
        idle_timeout_seconds: Optional[int] = None,
        poll_interval_seconds: float = 15.0,
        queue_depth_fn: Callable[[], Optional[int]] = default_queue_depth,
        active_jobs_fn: Callable[[], Optional[int]] = default_active_jobs_count,
        spawn_fn: Optional[Callable[[], Any]] = None,
        cleanup_fn: Callable[[], None] = default_cleanup,
    ) -> None:
        self.idle_timeout_seconds = int(
            idle_timeout_seconds if idle_timeout_seconds is not None else settings.WORKER_IDLE_SHUTDOWN_SECONDS
        )
        self.poll_interval_seconds = float(poll_interval_seconds)
        self._queue_depth_fn = queue_depth_fn
        self._active_jobs_fn = active_jobs_fn
        self._spawn_fn = spawn_fn or (lambda: subprocess.Popen(DEFAULT_CELERY_CMD))
        self._cleanup_fn = cleanup_fn

        self._lock = threading.Lock()
        self._wake_event = threading.Event()
        self._stop_event = threading.Event()
        self._proc: Any = None
        self._last_activity_at: float = 0.0
        self._last_idle_seen_at: Optional[float] = None
        self._monitor_thread: Optional[threading.Thread] = None

    @property
    def worker_running(self) -> bool:
        with self._lock:
            return self._proc is not None and self._proc.poll() is None

    def start_background_monitor(self) -> None:
        if self._monitor_thread is None or not self._monitor_thread.is_alive():
            self._monitor_thread = threading.Thread(
                target=self._monitor_loop, name="celery-idle-monitor", daemon=True
            )
            self._monitor_thread.start()

    def wake(self) -> int:
        """Ensure Celery subprocess is running and reset the idle timer."""
        with self._lock:
            now = time.monotonic()
            self._last_activity_at = now
            self._last_idle_seen_at = None
            if self._proc is None or self._proc.poll() is not None:
                logger.info("Waking on-demand Celery worker subprocess.")
                self._proc = self._spawn_fn()
            pid = int(getattr(self._proc, "pid", 0) or 0)
        self._wake_event.set()
        return pid

    def has_pending_work(self, *, unknown_is_busy: bool = True) -> bool:
        depth = self._queue_depth_fn()
        active = self._active_jobs_fn()
        if depth is None or active is None:
            return unknown_is_busy
        return depth > 0 or active > 0

    def check_idle_once(self) -> bool:
        """Evaluate idle state once; stops Celery subprocess if idle window elapsed.

        Returns True if the worker was stopped in this pass.
        """
        with self._lock:
            proc = self._proc
            if proc is None:
                return False
            if proc.poll() is not None:
                self._proc = None
                self._last_idle_seen_at = None
                self._cleanup_fn()
                return True
            last_activity = self._last_activity_at

        now = time.monotonic()
        if (now - last_activity) < self.idle_timeout_seconds or self.has_pending_work(unknown_is_busy=True):
            with self._lock:
                self._last_idle_seen_at = None
            return False

        confirm_now = time.monotonic()
        with self._lock:
            if (confirm_now - self._last_activity_at) < self.idle_timeout_seconds:
                self._last_idle_seen_at = None
                return False
            if self._last_idle_seen_at is None:
                self._last_idle_seen_at = confirm_now
                return False
            if (confirm_now - self._last_idle_seen_at) < min(self.poll_interval_seconds, 10.0):
                return False
            proc = self._proc
            self._proc = None
            self._last_idle_seen_at = None

        if proc is not None and proc.poll() is None:
            logger.info("Celery queue and jobs empty; stopping worker subprocess for zero-idle sleep.")
            try:
                proc.terminate()
                proc.wait(timeout=30)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        self._cleanup_fn()
        return True

    def stop(self) -> None:
        self._stop_event.set()
        self._wake_event.set()
        with self._lock:
            proc = self._proc
            self._proc = None
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=15)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        self._cleanup_fn()

    def _monitor_loop(self) -> None:
        while not self._stop_event.is_set():
            if not self.worker_running:
                # Zero polling while idle so Railway Serverless Sleep triggers cleanly.
                self._wake_event.wait()
                self._wake_event.clear()
                if self._stop_event.is_set():
                    break
            self._stop_event.wait(timeout=self.poll_interval_seconds)
            if not self._stop_event.is_set():
                try:
                    self.check_idle_once()
                except Exception as exc:
                    logger.warning("Worker supervisor idle monitor error: %s", exc)


def make_handler(supervisor: WorkerSupervisor):
    class SupervisorHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            logger.debug(format, *args)

        def _write_json(self, status_code: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized_internal(self) -> bool:
            expected = (settings.INTERNAL_API_SECRET or "").strip()
            if not expected:
                return bool(settings.INTERNAL_API_AUTH_BYPASS and settings.ENV.lower() != "production")
            provided = (self.headers.get("x-internal-secret") or "").strip()
            return bool(provided and hmac.compare_digest(provided, expected))

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path in ("/", "/health", "/readiness"):
                # Never ping Valkey/Postgres here so Railway probes do not keep DB/cache awake.
                self._write_json(
                    200,
                    {
                        "status": "ok",
                        "service": "youthnic-celery-supervisor",
                        "worker_running": supervisor.worker_running,
                    },
                )
                return
            if path == "/wake":
                self._write_json(405, {"detail": "Method not allowed; use POST /wake"})
                return
            self._write_json(404, {"detail": "Not found"})

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/wake":
                self._handle_wake()
                return
            self._write_json(404, {"detail": "Not found"})

        def _handle_wake(self) -> None:
            if not self._authorized_internal():
                self._write_json(401, {"detail": "Invalid or missing internal secret"})
                return
            pid = supervisor.wake()
            self._write_json(
                202,
                {
                    "status": "awake",
                    "worker_running": True,
                    "worker_pid": pid,
                },
            )

    return SupervisorHandler


def _check_initial_backlog(supervisor: WorkerSupervisor) -> None:
    """Check backlog asynchronously after HTTP port bind so cold-starts never delay /health."""
    try:
        if supervisor.has_pending_work(unknown_is_busy=False):
            supervisor.wake()
        else:
            default_cleanup()
    except Exception as exc:
        logger.debug("Initial backlog check skipped: %s", exc)


def main() -> None:
    supervisor = WorkerSupervisor()
    supervisor.start_background_monitor()

    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), make_handler(supervisor))

    shutdown_event = threading.Event()

    def _signal_handler(_signum: int, _frame: Any) -> None:
        # Keep signal handlers async-signal-safe: no logging, subprocess waits, or locks here.
        shutdown_event.set()

    def _shutdown_waiter() -> None:
        shutdown_event.wait()
        logger.info("Shutdown signal received; stopping celery supervisor.")
        supervisor.stop()
        server.shutdown()

    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)
    threading.Thread(target=_shutdown_waiter, name="supervisor-shutdown", daemon=True).start()
    threading.Thread(target=_check_initial_backlog, args=(supervisor,), name="boot-backlog-check", daemon=True).start()

    logger.info("Celery on-demand supervisor listening on 0.0.0.0:%s", port)
    try:
        server.serve_forever()
    finally:
        supervisor.stop()
        server.server_close()


if __name__ == "__main__":
    main()
