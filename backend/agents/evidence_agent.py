import hashlib
import io
import logging
from typing import Dict, Any, List
from PIL import Image

from models.evidence import PRODUCT_AUTHORITY_ROLES
from database import save_reference_evidence, save_region_crop
from services.ai_clients import load_reference_image
from firebase_service import upload_bytes, get_storage_client

logger = logging.getLogger(__name__)


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

        for ref in raw_references:
            role = str(ref.get("role", "additional_product"))
            url = str(ref.get("downloadUrl") or ref.get("download_url") or "")
            storage_path = str(ref.get("storagePath") or ref.get("storage_path") or "")

            loaded = load_reference_image(
                {"role": role, "download_url": url, "storage_path": storage_path},
                allow_local=allow_local,
                organization_id=org_id,
            )
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
                logger.warning(f"Could not persist reference evidence: {e}")

            if is_product_truth and loaded and evidence_id:
                self._build_and_store_region_crop(org_id, evidence_id, sku_id, role, loaded)

        composite_fingerprint = hashlib.sha256("|".join(sorted(hash_parts)).encode()).hexdigest()

        return {
            "references": validated_references,
            "source_fingerprint": composite_fingerprint,
        }
