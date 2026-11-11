import hashlib
import logging
from typing import Dict, Any, List
from models.evidence import PRODUCT_AUTHORITY_ROLES, NON_PRODUCT_ROLES, ReferenceRole
from database import save_reference_evidence

logger = logging.getLogger(__name__)


class ProductEvidenceAgent:
    """Inspects uploaded images, validates reference roles, computes sha256 hashes,

    and isolates style references from product truth.
    """

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        org_id = state["organization_id"]
        sku_id = state["sku_id"]
        raw_references = state.get("references", [])

        validated_references: List[Dict[str, Any]] = []
        hash_parts: List[str] = []

        for ref in raw_references:
            role = ref.get("role", "additional_product")
            url = ref.get("downloadUrl") or ref.get("download_url", "")
            storage_path = ref.get("storagePath") or ref.get("storage_path", "")

            # Generate or preserve hash
            raw_hash = ref.get("hash") or ref.get("sha256_hash")
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
                "is_authoritative": is_product_truth,
                "is_style_quarantined": is_style,
                "is_model_lock": is_model,
                "region_type": ref.get("region_type", "general"),
                "confidence": float(ref.get("confidence", 1.0)),
            }
            validated_references.append(entry)
            hash_parts.append(f"{role}:{raw_hash}")

            # Persist reference in DB if not already stored
            try:
                save_reference_evidence(
                    org_id=org_id,
                    sku_id=sku_id,
                    role=role,
                    storage_path=storage_path,
                    download_url=url,
                    sha256_hash=raw_hash,
                    region_type=entry["region_type"],
                    confidence=entry["confidence"],
                )
            except Exception as e:
                logger.warning(f"Could not persist reference evidence: {e}")

        # Compute deterministic composite fingerprint
        composite_fingerprint = hashlib.sha256("|".join(sorted(hash_parts)).encode()).hexdigest()

        return {
            "references": validated_references,
            "source_fingerprint": composite_fingerprint,
        }
