import atexit
from concurrent.futures import ThreadPoolExecutor
import json
import logging
import threading
import traceback
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import quote, unquote, urlparse

import httpx

from config import settings

logger = logging.getLogger(__name__)

_SENTRY_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="sentry-telemetry")
_SENTRY_INFLIGHT = threading.BoundedSemaphore(32)
atexit.register(_SENTRY_EXECUTOR.shutdown, wait=False, cancel_futures=True)


def parse_sentry_dsn(raw_dsn: Optional[str]) -> Optional[Dict[str, str]]:
    trimmed = str(raw_dsn or "").strip()
    if not trimmed:
        return None
    try:
        parsed = urlparse(trimmed)
    except Exception:
        return None
    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        return None
    public_key = unquote(parsed.username or "").strip()
    host = (parsed.netloc.split("@")[-1] or "").strip()
    segments = [seg.strip() for seg in (parsed.path or "").split("/") if seg.strip()]
    if not segments or not public_key or not host:
        return None
    project_id = segments[-1]
    path_prefix = "/" + "/".join(segments[:-1]) if len(segments) > 1 else ""
    envelope_url = (
        f"{scheme}://{host}{path_prefix}/api/{quote(project_id, safe='')}/envelope/"
        f"?sentry_key={quote(public_key, safe='')}&sentry_version=7"
    )
    canonical_dsn = f"{scheme}://{public_key}@{host}{path_prefix}/{project_id}"
    return {
        "protocol": scheme,
        "public_key": public_key,
        "host": host,
        "path_prefix": path_prefix,
        "project_id": project_id,
        "envelope_url": envelope_url,
        "dsn": canonical_dsn,
    }


def build_sentry_event_payload(
    exc: Any,
    *,
    level: str = "error",
    environment: Optional[str] = None,
    tags: Optional[Dict[str, Any]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    event_id = uuid.uuid4().hex
    now_iso = datetime.now(timezone.utc).isoformat()
    exc_type = type(exc).__name__ if isinstance(exc, BaseException) else "RuntimeError"
    exc_value = str(exc) if exc is not None else "Unknown error"
    tb_text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)) if isinstance(exc, BaseException) and exc.__traceback__ else ""

    clean_tags: Dict[str, str] = {"service": "fastapi_orchestrator"}
    for k, v in (tags or {}).items():
        if v is not None and str(v).strip() != "":
            clean_tags[str(k)] = str(v)

    clean_extra: Dict[str, Any] = dict(extra or {})
    if tb_text:
        clean_extra["traceback"] = tb_text

    return {
        "event_id": event_id,
        "timestamp": now_iso,
        "platform": "python",
        "level": level,
        "environment": environment or settings.SENTRY_ENVIRONMENT or settings.ENV or "production",
        "tags": clean_tags,
        "extra": clean_extra,
        "exception": {
            "values": [
                {
                    "type": exc_type,
                    "value": exc_value,
                }
            ]
        },
    }


def build_sentry_envelope(dsn_info: Dict[str, str], event_payload: Dict[str, Any]) -> str:
    header = json.dumps(
        {
            "event_id": event_payload["event_id"],
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "dsn": dsn_info["dsn"],
        }
    )
    item_header = json.dumps({"type": "event", "content_type": "application/json"})
    item_body = json.dumps(event_payload)
    return f"{header}\n{item_header}\n{item_body}\n"


def send_sentry_exception_sync(
    exc: Any,
    *,
    level: str = "error",
    tags: Optional[Dict[str, Any]] = None,
    extra: Optional[Dict[str, Any]] = None,
    raw_dsn: Optional[str] = None,
) -> bool:
    dsn_info = parse_sentry_dsn(raw_dsn if raw_dsn is not None else settings.SENTRY_DSN)
    if not dsn_info:
        return False
    try:
        event_payload = build_sentry_event_payload(exc, level=level, tags=tags, extra=extra)
        envelope = build_sentry_envelope(dsn_info, event_payload)
        with httpx.Client(timeout=4.0) as client:
            resp = client.post(
                dsn_info["envelope_url"],
                headers={"Content-Type": "application/x-sentry-envelope"},
                content=envelope.encode("utf-8"),
            )
            return 200 <= resp.status_code < 300
    except Exception as send_err:
        logger.debug("Sentry telemetry delivery skipped: %s", send_err)
        return False


def _deliver_sentry_task(
    exc: Any,
    level: str,
    tags: Optional[Dict[str, Any]],
    extra: Optional[Dict[str, Any]],
    raw_dsn: Optional[str],
) -> None:
    try:
        send_sentry_exception_sync(
            exc,
            level=level,
            tags=tags,
            extra=extra,
            raw_dsn=raw_dsn,
        )
    finally:
        _SENTRY_INFLIGHT.release()


def capture_sentry_exception(
    exc: Any,
    *,
    level: str = "error",
    tags: Optional[Dict[str, Any]] = None,
    extra: Optional[Dict[str, Any]] = None,
    raw_dsn: Optional[str] = None,
) -> None:
    dsn_val = raw_dsn if raw_dsn is not None else settings.SENTRY_DSN
    if not parse_sentry_dsn(dsn_val):
        return
    if not _SENTRY_INFLIGHT.acquire(blocking=False):
        logger.debug("Sentry telemetry queue full; dropping excess capture")
        return
    try:
        _SENTRY_EXECUTOR.submit(_deliver_sentry_task, exc, level, tags, extra, dsn_val)
    except Exception:
        _SENTRY_INFLIGHT.release()
