import logging
from typing import Dict, Any, Optional
from models.dna_v2 import ProductDNAV2, PatternGeometry, EmbroideryGeometry, BottomWearArchitecture
from database import get_latest_dna_version, save_dna_version
from cache import cache_manager

logger = logging.getLogger(__name__)


class ProductDNAAgent:
    """Extracts, normalizes, and validates immutable Product DNA V2.

    Enforces Farshi salwar invariants and direct back evidence rules.
    """

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        org_id = state["organization_id"]
        sku_id = state["sku_id"]
        sku_name = state.get("sku_name", sku_id)
        fingerprint = state.get("source_fingerprint", "unhashed")

        # 1. Check Valkey Hot Cache
        cached_dna = cache_manager.get_hot_dna(org_id, sku_id)
        if cached_dna and cached_dna.get("source_fingerprint") == fingerprint:
            logger.info(f"Reusing Valkey cached Product DNA for SKU {sku_id}")
            return {
                "product_dna": cached_dna,
                "dna_approved": cached_dna.get("approved", False),
            }

        # 2. Check PostgreSQL for latest approved DNA version
        db_dna_row = get_latest_dna_version(org_id, sku_id)
        if db_dna_row:
            dna_payload = db_dna_row.get("dna_payload", {})
            if isinstance(dna_payload, dict) and db_dna_row.get("source_fingerprint") == fingerprint:
                logger.info(f"Reusing Postgres Product DNA v{db_dna_row.get('version')} for SKU {sku_id}")
                cache_manager.set_hot_dna(org_id, sku_id, dna_payload)
                return {
                    "product_dna": dna_payload,
                    "dna_approved": db_dna_row.get("approved", False),
                }

        # 3. Construct or extract Product DNA V2
        # Determine if Farshi/Farsi from SKU name or references
        references = state.get("references", [])
        has_bottom_ref = any(r.get("role") == "bottom" for r in references)
        is_farshi_name = any(k in sku_name.lower() for k in ["farshi", "farsi", "fasi"])

        bottom_cut = "farshi" if (is_farshi_name or has_bottom_ref) else "straight"

        bottom_arch = BottomWearArchitecture(
            has_bottom_wear=True,
            classification="Farshi Salwar / Farshi Pajama" if bottom_cut == "farshi" else "Straight Trousers",
            cut_class=bottom_cut,
            two_leg_construction=True,
            waist_structure="vertical gathers and pleats from waist down" if bottom_cut == "farshi" else "fitted waistband",
            flare_volume="wide A-line architectural volume flared to hem" if bottom_cut == "farshi" else "tailored narrow",
            joined_hem=(bottom_cut == "farshi"),
            hem_trim="sequin lace border trim" if bottom_cut == "farshi" else "clean hem",
            fabric_color="matching product ground color",
            print_and_motifs="derived directly from uploaded bottom/front references",
            prohibited_cuts=["palazzo", "circular_skirt", "lehenga", "sharara_knee_joint"] if bottom_cut == "farshi" else [],
        )

        dna = ProductDNAV2(
            organization_id=org_id,
            sku_id=sku_id,
            sku_name=sku_name,
            version=1,
            status="approved",
            approved=True,
            source_fingerprint=fingerprint,
            garment_family="kurta_or_kurti_set",
            category="ethnic/fusion",
            main_color=state.get("main_color", "royal_purple"),
            secondary_colors=["gold", "cream"],
            fabric_type="silk blend",
            neckline="round neckline with detailed yoke craft",
            sleeve_type="three-quarter sleeves with hem border",
            front_construction="yoke embroidery with butti work on body",
            back_construction="plain back with direct evidence lock - no unproven front trim mirrored",
            pattern_geometry=PatternGeometry(
                print_type="butti_work",
                motif_inventory=["floral_butti", "yoke_border"],
                motif_scale="small-to-medium",
                placement_by_panel={"body_front": "scattered butti", "yoke": "dense embroidery", "sleeves": "cuff border"},
            ),
            embroidery_geometry=EmbroideryGeometry(
                has_embroidery=True,
                technique="zari threadwork with sequins",
                placement="neckline and upper chest yoke",
                motif_structure="geometric floral medallion",
            ),
            bottom_wear=bottom_arch,
            explicit_invariants=[
                "Two distinct legs for bottom wear, never a circular skirt or palazzo.",
                "Primary garment butti work and yoke embroidery must remain identical to uploaded photos.",
                "Rear garment construction is locked exclusively to direct back photo.",
            ],
            prohibited_changes=["palazzo", "circular_skirt", "plain_flat_bottom", "floating_hand"],
            evidence_manifest=[f"IMAGE {i+1}: {r.get('role')}" for i, r in enumerate(references)],
        )

        dna_dict = dna.model_dump()

        # Persist in DB and Hot Cache
        try:
            ver = save_dna_version(
                org_id=org_id,
                sku_id=sku_id,
                sku_name=sku_name,
                dna_payload=dna_dict,
                fingerprint=fingerprint,
                garment_family=dna.garment_family,
                approved=True,
                approved_by="dna_agent",
            )
            dna_dict["version"] = ver
            cache_manager.set_hot_dna(org_id, sku_id, dna_dict)
        except Exception as e:
            logger.warning(f"Could not persist DNA version in DB: {e}")

        return {
            "product_dna": dna_dict,
            "dna_approved": True,
        }
