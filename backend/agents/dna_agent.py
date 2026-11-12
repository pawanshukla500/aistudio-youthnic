import logging
from typing import Dict, Any, List, Optional
from models.dna_v2 import (
    ProductDNAV2,
    PatternGeometry,
    EmbroideryGeometry,
    BottomWearArchitecture,
    SareeArchitecture,
)
from models.evidence import PRODUCT_AUTHORITY_ROLES
from database import get_latest_dna_version, save_dna_version
from cache import cache_manager
from services.ai_clients import invoke_vision_json, load_reference_image

logger = logging.getLogger(__name__)


SAREE_BASELINE_INVARIANTS = [
    "Saree is a continuous unstitched drape paired with fitted blouse and underskirt petticoat. Strictly NO pants, NO palazzos, NO salwars, NO trousers.",
    "Pose 5 (Detail Frame) must showcase signature pallu artwork or zari border weave, never an accessory hijack.",
    "Back view (Pose 4) must strictly mirror back product reference showing blouse back neckline and pallu drape.",
]

KURTI_BASELINE_INVARIANTS = [
    "Two distinct legs for bottom wear, never a circular skirt or palazzo.",
    "Primary garment butti work and yoke embroidery must remain identical to uploaded photos.",
    "Rear garment construction is locked exclusively to direct back photo.",
]


def _build_dna_extraction_prompt(sku_name: str, category_hint: str, references: List[Dict[str, Any]]) -> str:
    manifest = ", ".join(f"{i+1}:{r.get('role')}" for i, r in enumerate(references))
    return f"""Analyze the authoritative product reference photos ONLY for SKU "{sku_name}" (category hint: "{category_hint}").
Reference roles provided: [{manifest}].
CRITICAL RULES:
1. Extract ONLY attributes visibly proven in these authoritative product images. Any attribute not clearly visible must be marked "unknown" (never guess or invent back details from front images).
2. For Sarees: preserve drape style, pallu artwork, zari border width/weave, body butti, blouse neckline/sleeves, and enforce no trousers/pants.
3. For Farshi Salwars: preserve two-leg construction, waist gathers, vertical flare, and joined hem panel (never label as palazzo or circular skirt).

Reply with STRICT JSON only matching this schema:
{{
  "garment_family": "saree" | "kurta_or_kurti_set" | "ethnic_dress" | "western_or_fusion",
  "category": "string",
  "silhouette": "string",
  "fit": "string",
  "length": "string",
  "main_color": "string",
  "secondary_colors": ["string"],
  "fabric_type": "string",
  "fabric_texture": "string",
  "neckline": "string",
  "sleeve_type": "string",
  "front_construction": "string",
  "back_construction": "string",
  "pattern_geometry": {{
    "print_type": "string",
    "motif_inventory": ["string"],
    "motif_scale": "string",
    "motif_density": "string",
    "placement_by_panel": {{"body": "string", "border": "string", "pallu_or_yoke": "string"}},
    "accent_colors": ["string"]
  }},
  "embroidery_geometry": {{
    "has_embroidery": true | false,
    "technique": "string",
    "placement": "string",
    "motif_structure": "string",
    "border_construction": "string"
  }},
  "bottom_wear": {{
    "has_bottom_wear": true | false,
    "classification": "string",
    "cut_class": "farshi" | "straight" | "palazzo" | "sharara" | "churidar" | "skirt" | "none",
    "two_leg_construction": true | false,
    "waist_structure": "string",
    "flare_volume": "string",
    "joined_hem": true | false,
    "hem_trim": "string",
    "fabric_color": "string",
    "print_and_motifs": "string"
  }},
  "saree_details": {{
    "drape_style": "nivi" | "string",
    "pallu_direction": "over_left_shoulder" | "string",
    "pallu_zari_type": "string",
    "pallu_artwork_description": "string",
    "border_weave_type": "string",
    "body_butti_type": "string",
    "blouse_fabric_coordination": "string",
    "blouse_sleeve_length": "string",
    "blouse_back_neckline": "string"
  }},
  "explicit_invariants": ["string"],
  "prohibited_changes": ["string"],
  "uncertain_attributes": ["string"],
  "confidence_score": 0.0
}}"""


class ProductDNAAgent:
    """Extracts, normalizes, and validates immutable Product DNA V2 using VLM vision + Pydantic invariants.

    Enforces style quarantine (never passes style_reference to extraction), Farshi salwar invariants,
    and saree unstitched-drape rules.
    """

    def _build_from_vlm(
        self,
        raw: Dict[str, Any],
        org_id: str,
        sku_id: str,
        sku_name: str,
        fingerprint: str,
        is_saree: bool,
        references: List[Dict[str, Any]],
        provider: str,
        model: str,
    ) -> ProductDNAV2:
        family = str(raw.get("garment_family") or ("saree" if is_saree else "kurta_or_kurti_set")).lower()
        is_saree = is_saree or family == "saree"

        pg_raw = raw.get("pattern_geometry") or {}
        eg_raw = raw.get("embroidery_geometry") or {}
        bw_raw = raw.get("bottom_wear") or {}
        sd_raw = raw.get("saree_details") or {}

        if is_saree:
            bottom = BottomWearArchitecture(
                has_bottom_wear=False,
                classification="none",
                cut_class="none",
                two_leg_construction=False,
                joined_hem=False,
                prohibited_cuts=["trousers", "palazzo", "salwar", "churidar", "jeans"],
            )
            saree_details = SareeArchitecture(
                drape_style=str(sd_raw.get("drape_style") or "nivi"),
                pallu_direction=str(sd_raw.get("pallu_direction") or "over_left_shoulder"),
                pallu_zari_type=str(sd_raw.get("pallu_zari_type") or "unknown"),
                pallu_artwork_description=str(sd_raw.get("pallu_artwork_description") or "derived from uploaded pallu reference"),
                border_weave_type=str(sd_raw.get("border_weave_type") or "unknown"),
                body_butti_type=str(sd_raw.get("body_butti_type") or "unknown"),
                blouse_fabric_coordination=str(sd_raw.get("blouse_fabric_coordination") or "unknown"),
                blouse_sleeve_length=str(sd_raw.get("blouse_sleeve_length") or "unknown"),
                blouse_back_neckline=str(sd_raw.get("blouse_back_neckline") or "unknown"),
                no_trousers_rule=True,
            )
            invariants = list(dict.fromkeys([*SAREE_BASELINE_INVARIANTS, *(raw.get("explicit_invariants") or [])]))
            prohibited = list(dict.fromkeys(["trousers", "palazzo", "salwar", "circular_skirt", "floating_hand", *(raw.get("prohibited_changes") or [])]))
        else:
            has_bottom_ref = any(r.get("role") == "bottom" for r in references)
            is_farshi_hint = any(k in sku_name.lower() for k in ("farshi", "farsi", "fasi"))
            allowed_cuts = {"farshi", "straight", "palazzo", "sharara", "churidar", "skirt", "none"}
            cut = str(bw_raw.get("cut_class") or "").lower()
            if is_farshi_hint:
                cut = "farshi"
            elif cut not in allowed_cuts:
                cut = "farshi" if has_bottom_ref else "straight"

            bottom = BottomWearArchitecture(
                has_bottom_wear=bool(bw_raw.get("has_bottom_wear", True)),
                classification=str(bw_raw.get("classification") or ("Farshi Salwar" if cut == "farshi" else "Straight Bottom")),
                cut_class=cut,  # type: ignore[arg-type]
                two_leg_construction=bool(bw_raw.get("two_leg_construction", True)),
                waist_structure=str(bw_raw.get("waist_structure") or "unknown"),
                flare_volume=str(bw_raw.get("flare_volume") or "unknown"),
                joined_hem=bool(bw_raw.get("joined_hem", cut == "farshi")),
                hem_trim=str(bw_raw.get("hem_trim") or "unknown"),
                fabric_color=str(bw_raw.get("fabric_color") or "matching"),
                print_and_motifs=str(bw_raw.get("print_and_motifs") or "unknown"),
                prohibited_cuts=["palazzo", "circular_skirt", "lehenga", "sharara_knee_joint"] if cut == "farshi" else [],
            )
            saree_details = None
            invariants = list(dict.fromkeys([*KURTI_BASELINE_INVARIANTS, *(raw.get("explicit_invariants") or [])]))
            prohibited = list(dict.fromkeys(["floating_hand", *(["palazzo", "circular_skirt"] if cut == "farshi" else []), *(raw.get("prohibited_changes") or [])]))

        return ProductDNAV2(
            organization_id=org_id,
            sku_id=sku_id,
            sku_name=sku_name,
            version=1,
            status="draft",
            approved=False,
            source_fingerprint=fingerprint,
            garment_family="saree" if is_saree else family,
            category=str(raw.get("category") or ("ethnic/saree" if is_saree else "ethnic/fusion")),
            silhouette=str(raw.get("silhouette") or ("nivi_drape" if is_saree else "unknown")),
            fit=str(raw.get("fit") or "regular"),
            length=str(raw.get("length") or "unknown"),
            main_color=str(raw.get("main_color") or "unknown"),
            secondary_colors=[str(c) for c in (raw.get("secondary_colors") or [])],
            fabric_type=str(raw.get("fabric_type") or "unknown"),
            fabric_texture=str(raw.get("fabric_texture") or "unknown"),
            neckline=str(raw.get("neckline") or "unknown"),
            sleeve_type=str(raw.get("sleeve_type") or "unknown"),
            front_construction=str(raw.get("front_construction") or "unknown"),
            back_construction=str(raw.get("back_construction") or "unknown"),
            pattern_geometry=PatternGeometry(
                print_type=str(pg_raw.get("print_type") or "unknown"),
                motif_inventory=[str(m) for m in (pg_raw.get("motif_inventory") or [])],
                motif_scale=str(pg_raw.get("motif_scale") or "medium"),
                motif_density=str(pg_raw.get("motif_density") or "moderate"),
                placement_by_panel={str(k): str(v) for k, v in (pg_raw.get("placement_by_panel") or {}).items()},
                accent_colors=[str(c) for c in (pg_raw.get("accent_colors") or [])],
            ),
            embroidery_geometry=EmbroideryGeometry(
                has_embroidery=bool(eg_raw.get("has_embroidery", False)),
                technique=str(eg_raw.get("technique") or "none"),
                placement=str(eg_raw.get("placement") or "none"),
                motif_structure=str(eg_raw.get("motif_structure") or "none"),
                border_construction=str(eg_raw.get("border_construction") or "none"),
            ),
            bottom_wear=bottom,
            saree_details=saree_details,
            explicit_invariants=invariants,
            prohibited_changes=prohibited,
            evidence_manifest=[f"IMAGE {i+1}: {r.get('role')}" for i, r in enumerate(references)],
            uncertain_attributes=[str(u) for u in (raw.get("uncertain_attributes") or [])],
            confidence_score=float(raw.get("confidence_score") or 0.9),
            metadata={"analysis_source": "vlm", "provider": provider, "model": model},
        )

    def _build_offline_heuristic(
        self,
        org_id: str,
        sku_id: str,
        sku_name: str,
        fingerprint: str,
        is_saree: bool,
        references: List[Dict[str, Any]],
        state: Dict[str, Any],
    ) -> ProductDNAV2:
        if is_saree:
            return ProductDNAV2(
                organization_id=org_id,
                sku_id=sku_id,
                sku_name=sku_name,
                version=1,
                status="draft",
                approved=False,
                source_fingerprint=fingerprint,
                garment_family="saree",
                category="ethnic/saree",
                silhouette="nivi_drape",
                fit="traditional_draped",
                length="full_length_floor_sweep",
                main_color=state.get("main_color", "unknown"),
                secondary_colors=state.get("secondary_colors", []),
                fabric_type=state.get("fabric_type", "unknown"),
                fabric_texture="unknown (awaiting VLM image extraction)",
                neckline="unknown",
                sleeve_type="unknown",
                front_construction="classic nivi drape with waist pleats",
                back_construction="blouse back design with falling pallu drape derived strictly from rear evidence",
                bottom_wear=BottomWearArchitecture(
                    has_bottom_wear=False,
                    classification="none",
                    cut_class="none",
                    two_leg_construction=False,
                    joined_hem=False,
                    prohibited_cuts=["trousers", "palazzo", "salwar", "churidar", "jeans"],
                ),
                saree_details=SareeArchitecture(
                    drape_style="nivi",
                    pallu_direction="over_left_shoulder",
                    pallu_zari_type="unknown",
                    pallu_artwork_description="derived from uploaded pallu reference",
                    no_trousers_rule=True,
                ),
                explicit_invariants=SAREE_BASELINE_INVARIANTS,
                prohibited_changes=["trousers", "palazzo", "salwar", "circular_skirt", "floating_hand"],
                evidence_manifest=[f"IMAGE {i+1}: {r.get('role')}" for i, r in enumerate(references)],
                uncertain_attributes=["main_color", "fabric_type", "pallu_zari_type"],
                confidence_score=0.5,
                metadata={"analysis_source": "heuristic_offline"},
            )

        has_bottom_ref = any(r.get("role") == "bottom" for r in references)
        is_farshi_name = any(k in sku_name.lower() for k in ["farshi", "farsi", "fasi"])
        bottom_cut = "farshi" if (is_farshi_name or has_bottom_ref) else "straight"

        return ProductDNAV2(
            organization_id=org_id,
            sku_id=sku_id,
            sku_name=sku_name,
            version=1,
            status="draft",
            approved=False,
            source_fingerprint=fingerprint,
            garment_family="kurta_or_kurti_set",
            category=state.get("category", "ethnic/fusion"),
            main_color=state.get("main_color", "unknown"),
            fabric_type=state.get("fabric_type", "unknown"),
            neckline="unknown",
            sleeve_type="unknown",
            front_construction="derived strictly from uploaded front image",
            back_construction="derived strictly from direct back evidence",
            bottom_wear=BottomWearArchitecture(
                has_bottom_wear=True,
                classification="Farshi Salwar / Farshi Pajama" if bottom_cut == "farshi" else "Straight Trousers",
                cut_class=bottom_cut,  # type: ignore[arg-type]
                two_leg_construction=True,
                waist_structure="vertical gathers and pleats from waist down" if bottom_cut == "farshi" else "fitted waistband",
                flare_volume="wide A-line architectural volume flared to hem" if bottom_cut == "farshi" else "tailored narrow",
                joined_hem=(bottom_cut == "farshi"),
                hem_trim="border trim derived from bottom reference" if bottom_cut == "farshi" else "clean hem",
                fabric_color="matching product ground color",
                print_and_motifs="derived directly from uploaded bottom/front references",
                prohibited_cuts=["palazzo", "circular_skirt", "lehenga", "sharara_knee_joint"] if bottom_cut == "farshi" else [],
            ),
            explicit_invariants=KURTI_BASELINE_INVARIANTS,
            prohibited_changes=["palazzo", "circular_skirt", "plain_flat_bottom", "floating_hand"] if bottom_cut == "farshi" else ["floating_hand"],
            evidence_manifest=[f"IMAGE {i+1}: {r.get('role')}" for i, r in enumerate(references)],
            uncertain_attributes=["main_color", "fabric_type", "neckline", "sleeve_type"],
            confidence_score=0.5,
            metadata={"analysis_source": "heuristic_offline"},
        )

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        org_id = state["organization_id"]
        sku_id = state["sku_id"]
        sku_name = state.get("sku_name", sku_id)
        fingerprint = state.get("source_fingerprint", "unhashed")
        force_refresh = bool(state.get("force_refresh", False))

        # 1. Check Valkey Hot Cache (skip if force_refresh)
        if not force_refresh:
            cached_dna = cache_manager.get_hot_dna(org_id, sku_id)
            if cached_dna and cached_dna.get("source_fingerprint") == fingerprint:
                logger.info(f"Reusing Valkey cached Product DNA for SKU {sku_id}")
                return {
                    "product_dna": cached_dna,
                    "dna_approved": bool(cached_dna.get("approved", False)),
                }

        # 2. Check PostgreSQL for matching fingerprint
        if not force_refresh:
            db_dna_row = get_latest_dna_version(org_id, sku_id)
            if db_dna_row:
                dna_payload = db_dna_row.get("dna_payload", {})
                if isinstance(dna_payload, dict) and db_dna_row.get("source_fingerprint") == fingerprint:
                    logger.info(f"Reusing Postgres Product DNA v{db_dna_row.get('version')} for SKU {sku_id}")
                    cache_manager.set_hot_dna(org_id, sku_id, dna_payload)
                    return {
                        "product_dna": dna_payload,
                        "dna_approved": bool(db_dna_row.get("approved", False)),
                    }

        # 3. Filter strictly to AUTHORITATIVE product references (Style Quarantine!)
        references = state.get("references", [])
        auth_refs = [r for r in references if r.get("role", "additional_product") in PRODUCT_AUTHORITY_ROLES]
        loaded_images = [img for r in auth_refs if (img := load_reference_image(r)) is not None]

        is_saree = (
            any(k in sku_name.lower() for k in ["saree", "sari"])
            or any("saree" in str(r.get("role", "")).lower() for r in references)
            or str(state.get("garment_family", "")).lower() == "saree"
        )

        dna: Optional[ProductDNAV2] = None
        if loaded_images:
            prompt = _build_dna_extraction_prompt(sku_name, str(state.get("category") or "ethnic/fusion"), auth_refs)
            vlm_res = invoke_vision_json(prompt, loaded_images, purpose="product_truth")
            if vlm_res and isinstance(vlm_res.get("data"), dict):
                dna = self._build_from_vlm(
                    raw=vlm_res["data"],
                    org_id=org_id,
                    sku_id=sku_id,
                    sku_name=sku_name,
                    fingerprint=fingerprint,
                    is_saree=is_saree,
                    references=references,
                    provider=vlm_res["provider"],
                    model=vlm_res["model"],
                )

        if dna is None:
            dna = self._build_offline_heuristic(
                org_id=org_id,
                sku_id=sku_id,
                sku_name=sku_name,
                fingerprint=fingerprint,
                is_saree=is_saree,
                references=references,
                state=state,
            )

        auto_approve = bool(state.get("auto_approve", False))
        if auto_approve:
            dna.approved = True
            dna.status = "approved"
            dna.approved_by = "auto_workflow"

        dna_dict = dna.model_dump()

        try:
            ver = save_dna_version(
                org_id=org_id,
                sku_id=sku_id,
                sku_name=sku_name,
                dna_payload=dna_dict,
                fingerprint=fingerprint,
                garment_family=dna.garment_family,
                approved=dna.approved,
                approved_by=dna.approved_by,
            )
            dna_dict["version"] = ver
            cache_manager.set_hot_dna(org_id, sku_id, dna_dict)
        except Exception as e:
            logger.warning(f"Could not persist DNA version in DB: {e}")

        return {
            "product_dna": dna_dict,
            "dna_approved": bool(dna_dict.get("approved", False)),
        }
