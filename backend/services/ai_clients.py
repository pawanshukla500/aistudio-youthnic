import base64
import io
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple
import httpx
from PIL import Image
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from config import settings
from cache import cache_manager
from firebase_service import download_bytes

logger = logging.getLogger(__name__)

MAX_IMAGE_PROMPT_CHARS = 30000
MAX_REFERENCE_DIM = 1536


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


def load_reference_image(ref: Dict[str, Any], timeout_s: int = 20) -> Optional[Dict[str, Any]]:
    """Fetch reference bytes cleanly from local://, Firebase Storage, or HTTPS URL."""
    url = str(ref.get("download_url") or ref.get("downloadUrl") or "").strip()
    storage_path = str(ref.get("storage_path") or ref.get("storagePath") or "").strip()
    role = str(ref.get("role") or "additional_product").strip()

    raw_bytes = b""
    try:
        if url.startswith("local://"):
            local_path = url[len("local://"):]
            if os.path.exists(local_path):
                with open(local_path, "rb") as fh:
                    raw_bytes = fh.read()
        elif url.startswith("http://") or url.startswith("https://"):
            # Skip mock placeholder hosts during offline tests quickly
            if "example.com" not in url and not url.startswith("https://mock/"):
                with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
                    resp = client.get(url)
                    if resp.status_code == 200 and resp.content:
                        raw_bytes = resp.content
        if not raw_bytes and storage_path and not storage_path.startswith("desktop/"):
            raw_bytes = download_bytes(storage_path)
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
    except Exception:
        pass

    return {
        "role": role,
        "bytes": raw_bytes,
        "mime_type": mime,
        "base64": base64.b64encode(raw_bytes).decode("ascii"),
        "width": width,
        "height": height,
        "filename": os.path.basename(storage_path or url or f"{role}.jpg") or f"{role}.jpg",
    }


def _meta_vision_json(prompt: str, images: List[Dict[str, Any]], timeout_s: int = 25) -> Dict[str, Any]:
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
        try:
            with httpx.Client(timeout=timeout_s) as client:
                resp = client.post(
                    "https://api.meta.ai/v1/responses",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model_name,
                        "input": [{"role": "user", "content": content_items}],
                        "reasoning": {"effort": "low"},
                        "max_output_tokens": 8192,
                    },
                )
            data = resp.json() if resp.content else {}
            if resp.status_code >= 400:
                msg = str((data.get("error") or {}).get("message") or data.get("message") or f"Meta HTTP {resp.status_code}")
                last_err = RuntimeError(msg)
                if resp.status_code == 404 or "not found" in msg.lower() or "not available" in msg.lower():
                    continue
                raise last_err

            text = _extract_responses_text(data)
            parsed = parse_json_payload(text)
            if not parsed:
                raise RuntimeError(f"Meta {model_name} returned empty/non-JSON output")
            cache_manager.record_provider_result("meta", True)
            return {
                "provider": "meta",
                "model": model_name,
                "reasoning": "low",
                "data": parsed,
            }
        except Exception as exc:
            last_err = exc
            cache_manager.record_provider_result("meta", False, str(exc))
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

    model_name = "gemini-2.5-flash"
    with httpx.Client(timeout=timeout_s) as client:
        resp = client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"responseMimeType": "application/json"},
            },
        )
    data = resp.json() if resp.content else {}
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
    """Call Meta Muse Spark primary -> LangChain ChatOpenAI Luna/Terra -> Gemini.

    Returns None ONLY when no provider keys are configured (offline tests).
    """
    has_meta = bool((settings.META_MODEL_API_KEY or "").strip())
    has_openai = bool((settings.OPENAI_API_KEY or "").strip())
    has_gemini = bool((settings.GEMINI_API_KEY or "").strip())

    if not (has_meta or has_openai or has_gemini):
        return None

    errors: List[str] = []
    if has_meta:
        try:
            return _meta_vision_json(prompt, images, timeout_s=min(25, settings.VISION_TIMEOUT_SECONDS))
        except Exception as exc:
            logger.warning(f"Primary Meta vision ({purpose}) failed: {exc}")
            errors.append(f"meta: {exc}")

    if has_openai:
        for model_name, effort in (("gpt-5.6-luna", "high"), ("gpt-5.6-terra", "low")):
            try:
                return _langchain_openai_vision_json(
                    prompt,
                    images,
                    model=model_name,
                    reasoning_effort=effort,
                    timeout_s=settings.VISION_TIMEOUT_SECONDS,
                )
            except Exception as exc:
                logger.warning(f"OpenAI fallback {model_name} ({purpose}) failed: {exc}")
                cache_manager.record_provider_result("openai", False, str(exc))
                errors.append(f"{model_name}: {exc}")

    if has_gemini:
        try:
            return _gemini_vision_json(prompt, images, timeout_s=settings.VISION_TIMEOUT_SECONDS)
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
    model: str = "gpt-image-2.5-flare-2026-09-08",
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
        files = []
        for idx, ref in enumerate(refs[:8], start=1):
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

    payload = resp.json() if resp.content else {}
    if resp.status_code >= 400:
        err_obj = payload.get("error") or {}
        err_msg = str(err_obj.get("message") or payload.get("message") or f"OpenAI Image HTTP {resp.status_code}")
        cache_manager.record_provider_result("openai_images", False, err_msg)
        raise RuntimeError(f"OpenAI image generation failed ({resp.status_code}): {err_msg}")

    items = payload.get("data") or []
    first = items[0] if items else {}
    if first.get("b64_json"):
        img_bytes = base64.b64decode(first["b64_json"])
    elif first.get("url"):
        with httpx.Client(timeout=60) as client:
            dl = client.get(first["url"])
            dl.raise_for_status()
            img_bytes = dl.content
    else:
        raise RuntimeError("OpenAI image API returned no image payload")

    mime_type = "image/jpeg" if img_bytes[:2] == b"\xff\xd8" else "image/png"
    usage = payload.get("usage")
    cost_usd = estimate_image_cost_usd(model, usage)
    cache_manager.record_provider_result("openai_images", True)
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
        embeddings = OpenAIEmbeddings(model="text-embedding-3-small", api_key=api_key)
        return embeddings.embed_query(text)
    except Exception as exc:
        logger.warning(f"Embedding generation failed: {exc}")
        return None
