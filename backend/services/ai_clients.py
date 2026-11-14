import base64
import io
import ipaddress
import json
import logging
import os
import posixpath
import re
import socket
import tempfile
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse
import httpx
from PIL import Image

from config import settings
from cache import cache_manager
from firebase_service import download_bytes

logger = logging.getLogger(__name__)

MAX_IMAGE_PROMPT_CHARS = 30000
MAX_REFERENCE_DIM = 1536
MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
_embeddings_client_cache: Dict[str, Any] = {}


def _safe_resp_json(resp: httpx.Response) -> Dict[str, Any]:
    if not resp.content:
        return {}
    try:
        parsed = resp.json()
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _resolve_safe_public_ip(raw_url: str) -> Optional[str]:
    try:
        parsed = urlparse(raw_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return None
        host = parsed.hostname.strip().lower()
        if host in {"localhost", "metadata.google.internal"}:
            return None
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        if not infos:
            return None
        chosen_ip: Optional[str] = None
        for info in infos:
            addr_str = info[4][0].split("%")[0]
            ip = ipaddress.ip_address(addr_str)
            if getattr(ip, "ipv4_mapped", None):
                ip = ip.ipv4_mapped
            if not ip.is_global or ip.is_multicast:
                return None
            if chosen_ip is None:
                chosen_ip = str(ip)
        return chosen_ip
    except Exception:
        return None


def _is_safe_public_url(raw_url: str) -> bool:
    return _resolve_safe_public_ip(raw_url) is not None


def _is_allowed_org_storage_path(storage_path: str, organization_id: Optional[str]) -> bool:
    cleaned = storage_path.strip().lstrip("/")
    if not cleaned or "\\" in cleaned or ".." in cleaned.split("/"):
        return False
    normalized = posixpath.normpath(cleaned)
    if normalized.startswith("../") or normalized == "..":
        return False
    if not organization_id or not organization_id.strip():
        return False
    org = organization_id.strip()
    if normalized.startswith(f"organizations/{org}/") or normalized.startswith(f"evidence_crops/{org}/") or normalized.startswith(f"{org}/"):
        return True
    if re.match(rf"^users/[^/]+/organizations/{re.escape(org)}/", normalized):
        return True
    return False


def _is_allowed_local_path(local_path: str) -> bool:
    try:
        resolved = os.path.realpath(local_path)
        repo_tests_dir = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "tests"))
        allowed_roots = [repo_tests_dir]
        for candidate in [
            r"C:\Users\Pawan Shukla\Desktop\Project Images",
            r"C:\Users\Pawan Shukla\Desktop\Projec Images",
        ]:
            c_path = os.path.realpath(candidate)
            if os.path.isdir(c_path):
                allowed_roots.append(c_path)
        return any(
            resolved == root or resolved.startswith(root + os.sep)
            for root in allowed_roots
        )
    except Exception:
        return False


def _download_public_image_bounded(url: str, timeout_s: int = 20) -> bytes:
    current = url
    with httpx.Client(timeout=timeout_s, follow_redirects=False) as client:
        for _ in range(4):
            pinned_ip = _resolve_safe_public_ip(current)
            if not pinned_ip:
                raise RuntimeError(f"Blocked untrusted/non-public image URL host: {urlparse(current).hostname}")
            parsed = urlparse(current)
            host = (parsed.hostname or "").strip()
            netloc = parsed.netloc
            formatted_ip = f"[{pinned_ip}]" if ":" in pinned_ip else pinned_ip
            ip_netloc = f"{formatted_ip}:{parsed.port}" if parsed.port else formatted_ip
            pinned_url = parsed._replace(netloc=ip_netloc).geturl()
            headers = {"Host": netloc} if netloc else {}
            req = client.build_request("GET", pinned_url, headers=headers)
            if parsed.scheme == "https" and host:
                req.extensions["sni_hostname"] = host
            resp = client.send(req, stream=True)
            try:
                if 300 <= resp.status_code < 400 and resp.headers.get("location"):
                    current = urljoin(current, resp.headers["location"])
                    continue
                if resp.status_code != 200:
                    return b""
                content_len = resp.headers.get("content-length")
                if content_len:
                    try:
                        if int(content_len) > MAX_DOWNLOAD_BYTES:
                            raise RuntimeError(f"Remote image exceeds {MAX_DOWNLOAD_BYTES} byte limit")
                    except ValueError:
                        pass
                chunks: List[bytes] = []
                total = 0
                for chunk in resp.iter_bytes(chunk_size=65536):
                    total += len(chunk)
                    if total > MAX_DOWNLOAD_BYTES:
                        raise RuntimeError(f"Remote image stream exceeded {MAX_DOWNLOAD_BYTES} byte limit")
                    chunks.append(chunk)
                return b"".join(chunks)
            finally:
                resp.close()
    return b""


def parse_json_payload(raw_text: str) -> Dict[str, Any]:
    """Parse JSON from model text, tolerating fenced markdown blocks."""
    cleaned = (raw_text or "").strip()
    if not cleaned:
        return {}
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            return {}
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}


def _extract_responses_text(data: Dict[str, Any]) -> str:
    direct = str(data.get("output_text") or "").strip()
    if direct:
        return direct
    parts: List[str] = []
    for item in data.get("output") or []:
        if not isinstance(item, dict):
            continue
        for key in ("text", "output_text", "content"):
            val = item.get(key)
            if isinstance(val, str) and val.strip():
                parts.append(val.strip())
            elif key == "content" and isinstance(val, list):
                for c in val:
                    if isinstance(c, dict):
                        txt = str(c.get("text") or c.get("output_text") or "").strip()
                        if txt:
                            parts.append(txt)
                    elif isinstance(c, str) and c.strip():
                        parts.append(c.strip())
    if parts:
        return "\n".join(parts)
    choices = data.get("choices") or []
    if choices and isinstance(choices[0], dict):
        msg = choices[0].get("message") or {}
        if isinstance(msg, dict):
            return str(msg.get("content") or "").strip()
    return ""


def load_reference_image(
    ref: Dict[str, Any],
    timeout_s: int = 20,
    allow_local: bool = False,
    organization_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Fetch reference bytes cleanly from trusted HTTPS URL, org-scoped Firebase Storage, or local test fixtures."""
    url = str(ref.get("download_url") or ref.get("downloadUrl") or "").strip()
    storage_path = str(ref.get("storage_path") or ref.get("storagePath") or "").strip()
    role = str(ref.get("role") or "additional_product").strip()

    raw_bytes = b""
    try:
        if url.startswith("local://"):
            if not allow_local:
                logger.warning(f"Blocked local:// image reference without explicit opt-in for role={role}")
                return None
            local_path = url[len("local://"):]
            if not _is_allowed_local_path(local_path):
                logger.warning(f"Blocked local:// path outside allowed fixtures directory for role={role}")
                return None
            real_local_path = os.path.realpath(local_path)
            if os.path.isfile(real_local_path):
                with open(real_local_path, "rb") as fh:
                    raw_bytes = fh.read(MAX_DOWNLOAD_BYTES + 1)
                if len(raw_bytes) > MAX_DOWNLOAD_BYTES:
                    return None
        elif url.startswith("http://") or url.startswith("https://"):
            # Skip mock placeholder hosts during offline tests quickly
            if "example.com" not in url and not url.startswith("https://mock/"):
                raw_bytes = _download_public_image_bounded(url, timeout_s=timeout_s)
        if not raw_bytes and storage_path and not storage_path.startswith("desktop/"):
            if not _is_allowed_org_storage_path(storage_path, organization_id):
                logger.warning(f"Blocked cross-tenant or invalid storage_path for org={organization_id}")
                return None
            raw_bytes = download_bytes(storage_path, max_bytes=MAX_DOWNLOAD_BYTES)
    except Exception as exc:
        logger.debug(f"Could not load bytes for reference role={role}: {exc}")
        return None

    if not raw_bytes:
        return None

    mime = "image/jpeg"
    width, height = 0, 0
    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            width, height = img.size
            fmt = (img.format or "JPEG").upper()
            mime = "image/png" if fmt == "PNG" else "image/webp" if fmt == "WEBP" else "image/jpeg"
            if max(width, height) > MAX_REFERENCE_DIM:
                resized = img.convert("RGB")
                resized.thumbnail((MAX_REFERENCE_DIM, MAX_REFERENCE_DIM))
                buf = io.BytesIO()
                resized.save(buf, format="JPEG", quality=90)
                raw_bytes = buf.getvalue()
                mime = "image/jpeg"
                width, height = resized.size
    except Exception as exc:
        logger.warning(f"Rejected unreadable or non-image payload for role={role}: {exc}")
        return None

    return {
        "role": role,
        "bytes": raw_bytes,
        "mime_type": mime,
        "base64": base64.b64encode(raw_bytes).decode("ascii"),
        "width": width,
        "height": height,
        "filename": os.path.basename(storage_path or url or f"{role}.jpg") or f"{role}.jpg",
    }


def _meta_vision_json(
    prompt: str,
    images: List[Dict[str, Any]],
    timeout_s: int = 60,
    effort: str = "high",
    deadline: Optional[float] = None,
) -> Dict[str, Any]:
    api_key = (settings.META_MODEL_API_KEY or "").strip()
    if not api_key:
        raise RuntimeError("META_MODEL_API_KEY is not configured")

    content_items: List[Dict[str, Any]] = []
    for idx, img in enumerate(images, start=1):
        content_items.append({"type": "input_text", "text": f"IMAGE {idx} ({img.get('role', 'reference')}):"})
        content_items.append({
            "type": "input_image",
            "image_url": f"data:{img['mime_type']};base64,{img['base64']}",
        })
    content_items.append({"type": "input_text", "text": prompt})

    last_err: Optional[Exception] = None
    for model_name in ("muse-spark-1.2-contributor", "muse-spark-1.3-contributor"):
        remaining = (deadline - time.monotonic()) if deadline is not None else float(timeout_s)
        if remaining < 5:
            last_err = last_err or RuntimeError("Meta vision deadline exhausted before retry")
            break
        per_call_timeout = int(max(5, min(float(timeout_s), remaining)))
        try:
            with httpx.Client(timeout=per_call_timeout) as client:
                resp = client.post(
                    "https://api.meta.ai/v1/responses",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model_name,
                        "input": [{"role": "user", "content": content_items}],
                        "reasoning": {"effort": effort},
                        "max_output_tokens": 16384,
                    },
                )
            data = _safe_resp_json(resp)
            if resp.status_code >= 400:
                msg = str((data.get("error") or {}).get("message") or data.get("message") or f"Meta HTTP {resp.status_code}")
                last_err = RuntimeError(msg)
                if resp.status_code == 404 or "not found" in msg.lower() or "not available" in msg.lower():
                    continue
                break

            text = _extract_responses_text(data)
            parsed = parse_json_payload(text)
            if not parsed:
                raise RuntimeError(f"Meta {model_name} returned empty/non-JSON output")
            cache_manager.record_provider_result("meta", True)
            return {
                "provider": "meta",
                "model": model_name,
                "reasoning": effort,
                "data": parsed,
            }
        except Exception as exc:
            last_err = exc
            break
    if last_err is not None:
        cache_manager.record_provider_result("meta", False, str(last_err))
    raise RuntimeError(f"Meta vision call failed: {last_err}")


def _langchain_openai_vision_json(
    prompt: str,
    images: List[Dict[str, Any]],
    model: str = "gpt-5.6-luna",
    reasoning_effort: str = "high",
    timeout_s: int = 60,
) -> Dict[str, Any]:
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    content_blocks: List[Dict[str, Any]] = []
    for idx, img in enumerate(images, start=1):
        content_blocks.append({"type": "text", "text": f"IMAGE {idx} ({img.get('role', 'reference')}):"})
        content_blocks.append({
            "type": "image_url",
            "image_url": {"url": f"data:{img['mime_type']};base64,{img['base64']}"},
        })
    content_blocks.append({"type": "text", "text": prompt})

    from langchain_core.messages import HumanMessage
    from langchain_openai import ChatOpenAI

    llm = ChatOpenAI(
        model=model,
        api_key=api_key,
        timeout=timeout_s,
        use_responses_api=True,
        reasoning={"effort": reasoning_effort},
    )
    msg = HumanMessage(content=content_blocks)
    response = llm.invoke([msg])
    raw_content = response.content
    if isinstance(raw_content, list):
        raw_text = "\n".join(
            str(b.get("text") or "") if isinstance(b, dict) else str(b)
            for b in raw_content
        )
    else:
        raw_text = str(raw_content or "")
    parsed = parse_json_payload(raw_text)
    if not parsed:
        raise RuntimeError(f"OpenAI {model} returned empty/non-JSON output")
    cache_manager.record_provider_result("openai", True)
    return {
        "provider": "openai",
        "model": model,
        "reasoning": reasoning_effort,
        "data": parsed,
    }


def _gemini_vision_json(prompt: str, images: List[Dict[str, Any]], timeout_s: int = 45) -> Dict[str, Any]:
    api_key = (settings.GEMINI_API_KEY or "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    parts: List[Dict[str, Any]] = []
    for idx, img in enumerate(images, start=1):
        parts.append({"text": f"IMAGE {idx} ({img.get('role', 'reference')}):"})
        parts.append({"inline_data": {"mime_type": img["mime_type"], "data": img["base64"]}})
    parts.append({"text": prompt})

    model_name = "gemini-3.8-flash"
    with httpx.Client(timeout=timeout_s) as client:
        resp = client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "thinkingConfig": {"thinkingLevel": "low"},
                },
            },
        )
    data = _safe_resp_json(resp)
    if resp.status_code >= 400:
        msg = str((data.get("error") or {}).get("message") or f"Gemini HTTP {resp.status_code}")
        raise RuntimeError(msg)
    candidates = data.get("candidates") or []
    cand_parts = (((candidates[0] if candidates else {}).get("content") or {}).get("parts") or [])
    raw_text = "\n".join(str(p.get("text") or "") for p in cand_parts if isinstance(p, dict))
    parsed = parse_json_payload(raw_text)
    if not parsed:
        raise RuntimeError("Gemini returned empty/non-JSON output")
    cache_manager.record_provider_result("gemini", True)
    return {
        "provider": "gemini",
        "model": model_name,
        "reasoning": "low",
        "data": parsed,
    }


def invoke_vision_json(
    prompt: str,
    images: List[Dict[str, Any]],
    purpose: str = "product_truth",
) -> Optional[Dict[str, Any]]:
    """Call Meta Muse Spark (high for analysis/pose_planning) -> GPT 6.1 Terra (high) / Luna -> Gemini.

    Returns None ONLY when no provider keys are configured (offline tests).
    """
    has_meta = bool((settings.META_MODEL_API_KEY or "").strip())
    has_openai = bool((settings.OPENAI_API_KEY or "").strip())
    has_gemini = bool((settings.GEMINI_API_KEY or "").strip())

    if not (has_meta or has_openai or has_gemini):
        return None

    is_analysis = purpose in ("product_truth", "pose_planning")
    meta_effort = "high" if is_analysis else "low"
    deadline = time.monotonic() + float(max(30, settings.VISION_TIMEOUT_SECONDS))
    errors: List[str] = []

    if has_meta:
        remaining = deadline - time.monotonic()
        meta_cap = 60 if is_analysis else 25
        meta_timeout = int(max(12, min(meta_cap, remaining)))
        meta_deadline = min(deadline, time.monotonic() + float(meta_timeout))
        try:
            return _meta_vision_json(
                prompt,
                images,
                timeout_s=meta_timeout,
                effort=meta_effort,
                deadline=meta_deadline,
            )
        except Exception as exc:
            logger.warning(f"Primary Meta vision ({purpose}) failed: {exc}")
            errors.append(f"meta: {exc}")

    if has_openai:
        openai_candidates = (
            (("gpt-6.1-terra", "high"), ("gpt-5.6-luna", "high"), ("gpt-5.6-terra", "low"))
            if is_analysis
            else (("gpt-5.6-luna", "low"), ("gpt-6.1-terra", "low"))
        )
        for idx, (model_name, default_effort) in enumerate(openai_candidates):
            remaining = deadline - time.monotonic()
            if remaining < 5:
                break
            has_later_hop = idx < len(openai_candidates) - 1 or has_gemini
            hop_budget = (remaining - 15) if (has_later_hop and remaining > 25) else remaining
            if model_name in ("gpt-6.1-terra", "gpt-5.6-luna") and default_effort == "high" and remaining < 60:
                effort = "low"
            else:
                effort = default_effort
            try:
                return _langchain_openai_vision_json(
                    prompt,
                    images,
                    model=model_name,
                    reasoning_effort=effort,
                    timeout_s=int(max(10, hop_budget)),
                )
            except Exception as exc:
                logger.warning(f"OpenAI fallback {model_name} ({purpose}) failed: {exc}")
                cache_manager.record_provider_result("openai", False, str(exc))
                errors.append(f"{model_name}: {exc}")

    if has_gemini:
        remaining = deadline - time.monotonic()
        if remaining >= 5:
            try:
                return _gemini_vision_json(prompt, images, timeout_s=int(max(10, remaining)))
            except Exception as exc:
                logger.warning(f"Gemini fallback ({purpose}) failed: {exc}")
                cache_manager.record_provider_result("gemini", False, str(exc))
                errors.append(f"gemini: {exc}")

    raise RuntimeError("All configured vision providers failed: " + " | ".join(errors))


def normalize_image_size(aspect_ratio: str, image_size: str, model: str) -> str:
    next_gen_models = {
        "gpt-image-2",
        "gpt-image-2.5-sunburst",
        "gpt-image-2.5-flare",
        "gpt-image-2.5-flare-2026-09-08",
        "gpt-image-2.6-sunburst",
        "gpt-image-2.6-flare",
        "gpt-image-2.6",
    }
    if model not in next_gen_models:
        if aspect_ratio in {"3:4", "2:3", "4:5", "9:16"}:
            return "1024x1536"
        if aspect_ratio in {"16:9", "3:2"}:
            return "1536x1024"
        return "1024x1024"

    is_2k = "2k" in (image_size or "").lower()
    if aspect_ratio == "3:4":
        return "1536x2048" if is_2k else "768x1024"
    if aspect_ratio == "2:3":
        return "1024x1536"
    if aspect_ratio == "4:5":
        return "1280x1600" if is_2k else "832x1040"
    if aspect_ratio == "9:16":
        return "1152x2048" if is_2k else "720x1280"
    if aspect_ratio == "16:9":
        return "2048x1152" if is_2k else "1536x864"
    if aspect_ratio == "3:2":
        return "1536x1024"
    return "2048x2048" if is_2k else "1024x1024"


def estimate_image_cost_usd(model: str, usage: Optional[Dict[str, Any]] = None) -> float:
    rates = {
        "gpt-image-2.6-sunburst": 0.18,
        "gpt-image-2.6-flare": 0.16,
        "gpt-image-2.6": 0.16,
        "gpt-image-2.5-sunburst": 0.12,
        "gpt-image-2.5-flare-2026-09-08": 0.08,
        "gpt-image-2.5-flare": 0.08,
        "gpt-image-2": 0.10,
        "gpt-image-1.5": 0.07,
        "gpt-image-1": 0.06,
    }
    if usage:
        output_tokens = float(usage.get("output_tokens") or 0)
        input_tokens = float(usage.get("input_tokens") or 0)
        if output_tokens or input_tokens:
            cost = (input_tokens / 1_000_000.0) * 8.0 + (output_tokens / 1_000_000.0) * 30.0
            return round(max(cost, 0.01), 4)
    return rates.get(model, 0.08)


def generate_catalog_image(
    prompt: str,
    model: str = "gpt-image-2.6-sunburst",
    aspect_ratio: str = "3:4",
    image_size: str = "2K",
    quality: str = "medium",
    reference_images: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Generate a catalog frame via OpenAI Image Edits (or Generations if no ref bytes)."""
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured for image generation")

    bounded_prompt = (prompt or "")[:MAX_IMAGE_PROMPT_CHARS]
    size = normalize_image_size(aspect_ratio, image_size, model)
    refs = reference_images or []

    headers = {"Authorization": f"Bearer {api_key}"}
    if refs:
        # Prioritize primary garment truth refs ahead of auxiliary refs within OpenAI's 8-image limit
        priority = {
            "front": 0, "saree_front_drape": 0,
            "back": 1, "saree_back_drape": 1,
            "bottom": 2, "saree_pallu_spread": 2,
            "fabric_pattern": 3, "saree_body_detail": 3, "saree_border_tassels": 3,
            "mannequin": 4, "saree_blouse_front": 4, "saree_blouse_back_piece": 4,
            "model_identity": 5, "style_reference": 6,
        }
        ordered_refs = sorted(refs, key=lambda r: priority.get(str(r.get("role") or ""), 7))[:8]
        role_map_lines = [
            f"- image[{idx}]: role={r.get('role', 'reference')} ({'STYLE BACKDROP ONLY - NEVER COPY CLOTHING' if r.get('role') == 'style_reference' else 'AUTHORITATIVE GARMENT/IDENTITY'})"
            for idx, r in enumerate(ordered_refs)
        ]
        bounded_prompt = (
            "REFERENCE INDEX MAP:\n" + "\n".join(role_map_lines) + "\n\n" + (prompt or "")
        )[:MAX_IMAGE_PROMPT_CHARS]

        files = []
        for idx, ref in enumerate(ordered_refs, start=1):
            fname = f"{idx:02d}_{ref.get('role', 'ref')}_{ref.get('filename', 'img.jpg')}"
            files.append(("image[]", (fname, ref["bytes"], ref.get("mime_type", "image/jpeg"))))
        form_data: Dict[str, Any] = {
            "model": model,
            "prompt": bounded_prompt,
            "size": size,
            "quality": quality,
            "output_format": "jpeg",
        }
        if model in {"gpt-image-1.5", "gpt-image-1"}:
            form_data["input_fidelity"] = "high"
        with httpx.Client(timeout=settings.IMAGE_GEN_TIMEOUT_SECONDS) as client:
            resp = client.post("https://api.openai.com/v1/images/edits", headers=headers, data=form_data, files=files)
    else:
        with httpx.Client(timeout=settings.IMAGE_GEN_TIMEOUT_SECONDS) as client:
            resp = client.post(
                "https://api.openai.com/v1/images/generations",
                headers={**headers, "Content-Type": "application/json"},
                json={
                    "model": model,
                    "prompt": bounded_prompt,
                    "size": size,
                    "quality": quality,
                    "output_format": "jpeg",
                },
            )

    payload = _safe_resp_json(resp)
    if resp.status_code >= 400:
        err_obj = payload.get("error") or {}
        err_msg = str(err_obj.get("message") or payload.get("message") or f"OpenAI Image HTTP {resp.status_code}")
        cache_manager.record_provider_result("openai", False, err_msg)
        raise RuntimeError(f"OpenAI image generation failed ({resp.status_code}): {err_msg}")

    items = payload.get("data") or []
    first = items[0] if items else {}
    if first.get("b64_json"):
        img_bytes = base64.b64decode(first["b64_json"])
    elif first.get("url"):
        img_bytes = _download_public_image_bounded(first["url"], timeout_s=60)
        if not img_bytes:
            raise RuntimeError("OpenAI image URL download returned no bytes")
    else:
        raise RuntimeError("OpenAI image API returned no image payload")

    mime_type = "image/jpeg"
    try:
        with Image.open(io.BytesIO(img_bytes)) as out_img:
            fmt = (out_img.format or "JPEG").upper()
            mime_type = "image/png" if fmt == "PNG" else "image/webp" if fmt == "WEBP" else "image/jpeg"
    except Exception:
        if img_bytes[:8] == b"\x89PNG\r\n\x1a\n":
            mime_type = "image/png"
    usage = payload.get("usage")
    cost_usd = estimate_image_cost_usd(model, usage)
    cache_manager.record_provider_result("openai", True)
    return {
        "image_bytes": img_bytes,
        "mime_type": mime_type,
        "model": model,
        "size": size,
        "request_id": resp.headers.get("x-request-id", ""),
        "usage": usage or {},
        "cost_usd": cost_usd,
    }


def embed_text(text: str) -> Optional[List[float]]:
    """Compute a 1536-dim embedding vector via LangChain OpenAIEmbeddings when key is configured."""
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key or not (text or "").strip():
        return None
    try:
        from langchain_openai import OpenAIEmbeddings

        embeddings = _embeddings_client_cache.get(api_key)
        if embeddings is None:
            if len(_embeddings_client_cache) >= 4:
                _embeddings_client_cache.clear()
            embeddings = OpenAIEmbeddings(model="text-embedding-3-small", api_key=api_key)
            _embeddings_client_cache[api_key] = embeddings
        return embeddings.embed_query(text)
    except Exception as exc:
        logger.warning(f"Embedding generation failed: {exc}")
        return None

