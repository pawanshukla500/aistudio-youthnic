import atexit
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import logging
import threading
from typing import Dict, Any, List
from PIL import Image

from models.evidence import PRODUCT_AUTHORITY_ROLES
from database import save_reference_evidence, save_region_crop, update_reference_evidence_dimensions
from cache import cache_manager
from services.ai_clients import load_reference_image
from firebase_service import upload_bytes, get_storage_client

logger = logging.getLogger(__name__)

_EVIDENCE_BACKFILL_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="evidence-crop")
_EVIDENCE_BACKFILL_SEMAPHORE = threading.BoundedSemaphore(24)
atexit.register(_EVIDENCE_BACKFILL_EXECUTOR.shutdown, wait=False, cancel_futures=True)


class ProductEvidenceAgent:
    """Inspects uploaded images, verifies reference roles, computes byte SHA-256 hashes,
    generates center craftsmanship region crops, and isolates style references from product truth.
    """

    def _build_and_store_region_crop(
        self,
        org_id: str,
        evidence_id: str,
        sku_id: str,
        role: str,
        loaded: Dict[str, Any],
    ):
        raw_bytes = loaded.get("bytes") or b""
        if not raw_bytes or not evidence_id:
            return
        try:
            with Image.open(io.BytesIO(raw_bytes)) as img:
                w, h = img.size
                if w < 64 or h < 64:
                    return
                # Center-weighted crop capturing primary motif / embroidery / weave region
                x1, y1 = int(w * 0.2), int(h * 0.2)
                x2, y2 = int(w * 0.8), int(h * 0.8)
                crop = img.convert("RGB").crop((x1, y1, x2, y2))
                buf = io.BytesIO()
                crop.save(buf, format="JPEG", quality=88)
                crop_bytes = buf.getvalue()

            crop_path = f"evidence_crops/{org_id}/{sku_id}/{role}_{evidence_id}.jpg"
            crop_url = ""
            if get_storage_client() is not None:
                crop_url = upload_bytes(crop_path, crop_bytes, content_type="image/jpeg")

            save_region_crop(
                org_id=org_id,
                evidence_id=evidence_id,
                sku_id=sku_id,
                region_name=f"{role}_detail_crop",
                bounding_box={
                    "x": round(x1 / w, 4),
                    "y": round(y1 / h, 4),
                    "width": round((x2 - x1) / w, 4),
                    "height": round((y2 - y1) / h, 4),
                },
                crop_storage_path=crop_path,
                crop_download_url=crop_url,
                construction_notes=f"Auto-cropped {role} primary detail region",
            )
        except Exception as exc:
            logger.debug(f"Region crop creation skipped for {role}: {exc}")

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        org_id = state["organization_id"]
        sku_id = state["sku_id"]
        raw_references = state.get("references", [])
        allow_local = bool(state.get("allow_local_references", False))

        validated_references: List[Dict[str, Any]] = []
        hash_parts: List[str] = []
        db_persisted_ok = True

        manifest_sig = hashlib.sha256(
            "|".join(
                sorted(
                    f"{sku_id}:{str(r.get('role', 'additional_product'))}:"
                    f"{str(r.get('hash') or r.get('sha256_hash') or '')}:"
                    f"{str(r.get('storagePath') or r.get('storage_path') or '')}:"
                    f"{str(r.get('downloadUrl') or r.get('download_url') or '')}"
                    for r in raw_references
                )
            ).encode("utf-8")
        ).hexdigest()[:24]

        if raw_references and not state.get("force_refresh"):
            cached_manifest = cache_manager.get_manifest_cache(org_id, manifest_sig)
            if (
                cached_manifest
                and isinstance(cached_manifest.get("references"), list)
                and cached_manifest.get("source_fingerprint")
            ):
                return {
                    "references": cached_manifest["references"],
                    "source_fingerprint": cached_manifest["source_fingerprint"],
                }

        from concurrent.futures import ThreadPoolExecutor

        def _load_one(ref: Dict[str, Any]):
            role = str(ref.get("role", "additional_product"))
            url = str(ref.get("downloadUrl") or ref.get("download_url") or "")
            storage_path = str(ref.get("storagePath") or ref.get("storage_path") or "")
            return load_reference_image(
                {"role": role, "download_url": url, "storage_path": storage_path},
                allow_local=allow_local,
                organization_id=org_id,
            )

        has_seed_and_hashes = (
            not state.get("force_refresh")
            and isinstance(state.get("seed_analysis"), dict)
            and bool(raw_references)
            and all(bool(r.get("hash") or r.get("sha256_hash")) for r in raw_references)
        )
        if has_seed_and_hashes:
            loaded_list = [None for _ in raw_references]
        elif len(raw_references) > 1:
            with ThreadPoolExecutor(max_workers=min(6, len(raw_references))) as pool:
                loaded_list = list(pool.map(_load_one, raw_references))
        else:
            loaded_list = [_load_one(ref) for ref in raw_references]

        for ref, loaded in zip(raw_references, loaded_list):
            role = str(ref.get("role", "additional_product"))
            url = str(ref.get("downloadUrl") or ref.get("download_url") or "")
            storage_path = str(ref.get("storagePath") or ref.get("storage_path") or "")
            raw_hash = ref.get("hash") or ref.get("sha256_hash")
            dimensions = ref.get("dimensions") or {}
            mime_type = str(ref.get("mimeType") or ref.get("mime_type") or "image/jpeg")

            if loaded and loaded.get("bytes"):
                computed_hash = hashlib.sha256(loaded["bytes"]).hexdigest()
                if not raw_hash:
                    raw_hash = computed_hash
                if loaded.get("width") and loaded.get("height"):
                    dimensions = {"width": int(loaded["width"]), "height": int(loaded["height"])}
                mime_type = str(loaded.get("mime_type") or mime_type)

            if not raw_hash:
                raw_hash = hashlib.sha256(f"{role}:{storage_path or url}".encode()).hexdigest()

            is_product_truth = role in PRODUCT_AUTHORITY_ROLES
            is_style = role == "style_reference"
            is_model = role == "model_identity"

            entry = {
                "role": role,
                "download_url": url,
                "storage_path": storage_path,
                "sha256_hash": raw_hash,
                "dimensions": dimensions,
                "mime_type": mime_type,
                "is_authoritative": is_product_truth,
                "is_style_quarantined": is_style,
                "is_model_lock": is_model,
                "region_type": ref.get("region_type", "general"),
                "confidence": float(ref.get("confidence", 1.0)),
            }
            validated_references.append(entry)
            hash_parts.append(f"{role}:{raw_hash}")

            evidence_id = ""
            try:
                evidence_id = save_reference_evidence(
                    org_id=org_id,
                    sku_id=sku_id,
                    role=role,
                    storage_path=storage_path,
                    download_url=url,
                    sha256_hash=raw_hash,
                    mime_type=mime_type,
                    dimensions=dimensions,
                    region_type=entry["region_type"],
                    confidence=entry["confidence"],
                )
            except Exception as e:
                db_persisted_ok = False
                logger.warning(f"Could not persist reference evidence: {e}")

            if is_product_truth and evidence_id:
                if loaded:
                    self._build_and_store_region_crop(org_id, evidence_id, sku_id, role, loaded)
                elif has_seed_and_hashes and (url or storage_path) and _EVIDENCE_BACKFILL_SEMAPHORE.acquire(blocking=False):
                    def _backfill_one(
                        _org_id: str = org_id,
                        _evidence_id: str = evidence_id,
                        _sku_id: str = sku_id,
                        _role: str = role,
                        _url: str = url,
                        _storage_path: str = storage_path,
                    ) -> None:
                        try:
                            fetched = load_reference_image(
                                {"role": _role, "download_url": _url, "storage_path": _storage_path},
                                allow_local=allow_local,
                                organization_id=_org_id,
                            )
                            if not fetched:
                                return
                            if fetched.get("width") and fetched.get("height"):
                                update_reference_evidence_dimensions(
                                    _org_id,
                                    _evidence_id,
                                    {"width": int(fetched["width"]), "height": int(fetched["height"])},
                                    mime_type=str(fetched.get("mime_type") or "") or None,
                                )
                            self._build_and_store_region_crop(_org_id, _evidence_id, _sku_id, _role, fetched)
                        except Exception as exc:
                            logger.debug(f"Seeded evidence backfill skipped for {_role}: {exc}")
                        finally:
                            _EVIDENCE_BACKFILL_SEMAPHORE.release()

                    try:
                        _EVIDENCE_BACKFILL_EXECUTOR.submit(_backfill_one)
                    except Exception:
                        _EVIDENCE_BACKFILL_SEMAPHORE.release()

        composite_fingerprint = hashlib.sha256("|".join(sorted(hash_parts)).encode()).hexdigest()

        if validated_references and db_persisted_ok:
            cache_manager.set_manifest_cache(
                org_id,
                manifest_sig,
                {
                    "references": validated_references,
                    "source_fingerprint": composite_fingerprint,
                },
            )

        return {
            "references": validated_references,
            "source_fingerprint": composite_fingerprint,
        }
