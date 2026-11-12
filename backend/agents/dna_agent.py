import logging
import re
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from models.dna_v2 import (
    ProductDNAV2,
    PatternGeometry,
    EmbroideryGeometry,
    BottomWearArchitecture,
    SareeArchitecture,
)
from models.evidence import PRODUCT_AUTHORITY_ROLES
from database import get_latest_dna_version, save_dna_version, approve_dna_version
from cache import cache_manager
from services.ai_clients import invoke_vision_json, load_reference_image

logger = logging.getLogger(__name__)


def _coerce_confidence(value: Any, default: float = 0.9) -> float:
    if value is None:
        return default
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    if num > 1.0:
        num = num / 100.0
    return max(0.0, min(1.0, num))


SAREE_BASELINE_INVARIANTS = [
    "Saree is a continuous unstitched drape paired with fitted blouse and underskirt petticoat. Strictly NO pants, NO palazzos, NO salwars, NO trousers.",
    "Pose 5 (Detail Frame) must showcase signature pallu artwork or zari border weave, never an accessory hijack.",
    "Back view (Pose 4) must strictly mirror back product reference showing blouse back neckline and pallu drape.",
]

KURTI_BASELINE_INVARIANTS = [
    "Primary garment butti work, neckline, silhouette, and yoke embroidery must remain identical to uploaded photos.",
    "Rear garment construction is locked exclusively to direct back photo.",
]

FARSHI_BASELINE_INVARIANTS = [
    "Two distinct legs for Farshi salwar bottom wear, never a circular skirt or open wide palazzo.",
    "Farshi hem is quite narrow from the waist side, with a 6-inch joined hem panel tapering 4 inches inward from the upper hem seam.",
]


def _build_dna_extraction_prompt(sku_name: str, category_hint: str, references: List[Dict[str, Any]]) -> str:
    manifest = ", ".join(f"{i+1}:{r.get('role')}" for i, r in enumerate(references))
    return f"""Analyze the authoritative product reference photos ONLY for SKU "{sku_name}" (category hint: "{category_hint}").
Reference roles provided: [{manifest}].
CRITICAL RULES:
1. Extract ONLY attributes visibly proven in these authoritative product images. Any attribute not clearly visible must be marked "unknown" (never guess or invent back details from front images).
2. Scan ALL uploaded product slots (including mannequin/flat-lay and additional_product) for an included dupatta, stole, or shawl; record it if shown, while keeping top-only kurtis strictly top-only ("has_bottom_wear": false, "cut_class": "none").
3. For Sarees: preserve drape style, pallu artwork, zari border width/weave, body butti, blouse neckline/sleeves, and enforce no trousers/pants.
4. For Farshi Salwars ONLY: classify as "farshi" whenever the SKU/notes name farshi/farsi/fasi OR the bottom-wear photo shows waist/hip-yoke pleats plus a distinct ~5-7 inch horizontal joined hem cuff/panel separated by a horizontal seam, gota, piping, or lace joint above the ankle (even on a flatlay where cuff stripes reverse angle or taper softly). For Farshi, preserve two-leg construction, waist pleats + side-joint pleats, narrow hem relative to waist fullness, and a 6-inch joined hem panel tapering 4 inches inward from upper hem seam. Never apply Farshi taper rules to unbroken plain palazzos, shararas, churidars, straight trousers, or skirts.

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

        pg_raw = raw.get("pattern_geometry") if isinstance(raw.get("pattern_geometry"), dict) else {}
        eg_raw = raw.get("embroidery_geometry") if isinstance(raw.get("embroidery_geometry"), dict) else {}
        bw_raw = raw.get("bottom_wear") if isinstance(raw.get("bottom_wear"), dict) else {}
        sd_raw = raw.get("saree_details") if isinstance(raw.get("saree_details"), dict) else {}

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
            sku_lower = sku_name.lower()
            has_neg_farshi = bool(re.search(r"\b(?:not|non|never|without|no)\s+(?:a\s+)?(?:farshi|farsi|fasi)\b", sku_lower))
            is_farshi_hint = bool(re.search(r"\b(?:farshi|farsi|fasi)\b", sku_lower)) and not has_neg_farshi
            allowed_cuts = {"farshi", "straight", "palazzo", "sharara", "churidar", "skirt", "unknown", "none"}
            explicit_non_farshi = {"straight", "palazzo", "sharara", "churidar", "skirt"}
            cut = str(bw_raw.get("cut_class") or "").lower().strip()
            has_bottom_wear = (
                has_bottom_ref
                or is_farshi_hint
                or (
                    bool(bw_raw.get("has_bottom_wear"))
                    if "has_bottom_wear" in bw_raw
                    else (family == "kurta_or_kurti_set" and cut not in {"", "none"})
                )
            )
            if not has_bottom_wear:
                cut = "none"
            elif is_farshi_hint:
                cut = "farshi"
            elif cut in explicit_non_farshi:
                cut = cut
            elif has_bottom_ref and cut == "none":
                cut = "farshi"
            elif cut not in allowed_cuts or not cut:
                cut = "unknown"

            raw_joined_hem = bw_raw.get("joined_hem")
            joined_hem_flag = bool(raw_joined_hem) if raw_joined_hem is not None else (cut == "farshi")
            hem_trim_text = str(bw_raw.get("hem_trim") or "").lower()
            has_farshi_panel_seam = (
                joined_hem_flag
                and bool(re.search(r"\b(?:4|5|6|7|8)[-\s]*inch\b|hem\s*panel|lower\s*panel|joined\s*panel|horizontal\s*(?:joint|seam)\b", hem_trim_text))
                and not has_neg_farshi
            )
            if has_bottom_wear and cut in {"palazzo", "unknown", ""} and has_farshi_panel_seam:
                cut = "farshi"

            raw_classification = str(bw_raw.get("classification") or "").strip()
            if not has_bottom_wear:
                classification = "none"
            elif cut == "farshi":
                classification = raw_classification if re.search(r"\b(?:farshi|farsi)\b", raw_classification, re.I) else "Farshi Salwar"
            elif cut in explicit_non_farshi:
                classification = cut.title()
            else:
                classification = raw_classification or cut.title()

            raw_two_leg = bw_raw.get("two_leg_construction")
            bottom = BottomWearArchitecture(
                has_bottom_wear=has_bottom_wear,
                classification=classification,
                cut_class=cut,  # type: ignore[arg-type]
                two_leg_construction=bool(raw_two_leg) if raw_two_leg is not None else (has_bottom_wear and cut != "skirt"),
                waist_structure=str(bw_raw.get("waist_structure") or ("unknown" if has_bottom_wear else "none")),
                flare_volume=str(bw_raw.get("flare_volume") or ("unknown" if has_bottom_wear else "none")),
                joined_hem=joined_hem_flag,
                hem_trim=str(bw_raw.get("hem_trim") or ("unknown" if has_bottom_wear else "none")),
                fabric_color=str(bw_raw.get("fabric_color") or ("matching" if has_bottom_wear else "none")),
                print_and_motifs=str(bw_raw.get("print_and_motifs") or ("unknown" if has_bottom_wear else "none")),
                prohibited_cuts=["palazzo", "circular_skirt", "lehenga", "sharara_knee_joint"] if cut == "farshi" else [],
            )
            saree_details = None
            invariants = list(
                dict.fromkeys(
                    [
                        *KURTI_BASELINE_INVARIANTS,
                        *(FARSHI_BASELINE_INVARIANTS if cut == "farshi" else []),
                        *(raw.get("explicit_invariants") or []),
                    ]
                )
            )
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
            confidence_score=_coerce_confidence(raw.get("confidence_score")),
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
        is_farshi_name = bool(re.search(r"\b(?:farshi|farsi)\b", sku_name.lower()))
        requested_family = str(state.get("garment_family") or "").strip().lower()
        garment_family = requested_family if requested_family in {"kurta_or_kurti_set", "ethnic_dress", "western_or_fusion"} else "kurta_or_kurti_set"
        has_bottom_wear = bool(is_farshi_name or has_bottom_ref or garment_family == "kurta_or_kurti_set")
        if is_farshi_name:
            bottom_cut = "farshi"
        elif has_bottom_wear:
            bottom_cut = "unknown"
        else:
            bottom_cut = "none"

        return ProductDNAV2(
            organization_id=org_id,
            sku_id=sku_id,
            sku_name=sku_name,
            version=1,
            status="draft",
            approved=False,
            source_fingerprint=fingerprint,
            garment_family=garment_family,  # type: ignore[arg-type]
            category=state.get("category", "ethnic/fusion"),
            main_color=state.get("main_color", "unknown"),
            fabric_type=state.get("fabric_type", "unknown"),
            neckline="unknown",
            sleeve_type="unknown",
            front_construction="derived strictly from uploaded front image",
            back_construction="derived strictly from direct back evidence",
            bottom_wear=BottomWearArchitecture(
                has_bottom_wear=has_bottom_wear,
                classification="Farshi Salwar / Farshi Pajama" if bottom_cut == "farshi" else ("none" if not has_bottom_wear else "unknown"),
                cut_class=bottom_cut,  # type: ignore[arg-type]
                two_leg_construction=has_bottom_wear,
                waist_structure="vertical gathers and pleats from waist down" if bottom_cut == "farshi" else ("unknown" if has_bottom_wear else "none"),
                flare_volume="wide A-line architectural volume flared to hem" if bottom_cut == "farshi" else ("unknown" if has_bottom_wear else "none"),
                joined_hem=(bottom_cut == "farshi"),
                hem_trim="border trim derived from bottom reference" if bottom_cut == "farshi" else ("unknown" if has_bottom_wear else "none"),
                fabric_color="matching product ground color" if has_bottom_wear else "none",
                print_and_motifs="derived directly from uploaded bottom/front references" if has_bottom_wear else "none",
                prohibited_cuts=["palazzo", "circular_skirt", "lehenga", "sharara_knee_joint"] if bottom_cut == "farshi" else [],
            ),
            explicit_invariants=KURTI_BASELINE_INVARIANTS,
            prohibited_changes=["palazzo", "circular_skirt", "plain_flat_bottom", "floating_hand"] if bottom_cut == "farshi" else ["floating_hand"],
            evidence_manifest=[f"IMAGE {i+1}: {r.get('role')}" for i, r in enumerate(references)],
            uncertain_attributes=["main_color", "fabric_type", "neckline", "sleeve_type", *( ["bottom_cut"] if bottom_cut == "unknown" else [] )],
            confidence_score=0.5,
            metadata={"analysis_source": "heuristic_offline"},
        )

    def _sync_reuse_approval(
        self,
        org_id: str,
        sku_id: str,
        payload: Dict[str, Any],
        version: int,
        db_approved: bool,
        auto_approve: bool,
    ) -> Dict[str, Any]:
        is_approved = bool(db_approved or payload.get("approved", False))
        synced = {
            **payload,
            "version": int(version or payload.get("version") or 1),
            "approved": is_approved,
            "status": "approved" if is_approved else str(payload.get("status") or "draft"),
        }
        if auto_approve and not is_approved and synced["version"] >= 1:
            try:
                if approve_dna_version(org_id, sku_id, synced["version"], "auto_workflow"):
                    synced["approved"] = True
                    synced["status"] = "approved"
                    synced["approved_by"] = "auto_workflow"
                    synced["approved_at"] = datetime.now(timezone.utc).isoformat()
            except Exception as exc:
                logger.warning(f"Failed auto-approving reused DNA v{synced['version']} for {sku_id}: {exc}")
        return synced

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        org_id = state["organization_id"]
        sku_id = state["sku_id"]
        sku_name = state.get("sku_name", sku_id)
        fingerprint = state.get("source_fingerprint", "unhashed")
        force_refresh = bool(state.get("force_refresh", False))
        auto_approve = bool(state.get("auto_approve", False))
        allow_local = bool(state.get("allow_local_references", False))

        # 1. Check Valkey Hot Cache (skip if force_refresh or heuristic fallback)
        if not force_refresh:
            cached_dna = cache_manager.get_hot_dna(org_id, sku_id)
            if (
                cached_dna
                and cached_dna.get("source_fingerprint") == fingerprint
                and (cached_dna.get("metadata") or {}).get("analysis_source") != "heuristic_offline"
            ):
                synced = self._sync_reuse_approval(
                    org_id, sku_id, cached_dna,
                    int(cached_dna.get("version") or 1),
                    bool(cached_dna.get("approved", False)),
                    auto_approve,
                )
                if synced.get("approved") != cached_dna.get("approved"):
                    cache_manager.set_hot_dna(org_id, sku_id, synced)
                logger.info(f"Reusing Valkey cached Product DNA for SKU {sku_id}")
                return {
                    "product_dna": synced,
                    "dna_approved": bool(synced.get("approved", False)),
                }

        # 2. Check PostgreSQL for matching fingerprint (never reuse heuristic_offline rows)
        if not force_refresh:
            db_dna_row = get_latest_dna_version(org_id, sku_id)
            if db_dna_row:
                dna_payload = db_dna_row.get("dna_payload", {})
                src_mode = (dna_payload.get("metadata") or {}).get("analysis_source") if isinstance(dna_payload, dict) else None
                if (
                    isinstance(dna_payload, dict)
                    and db_dna_row.get("source_fingerprint") == fingerprint
                    and src_mode != "heuristic_offline"
                ):
                    row_ver = int(db_dna_row.get("version") or dna_payload.get("version") or 1)
                    synced = self._sync_reuse_approval(
                        org_id, sku_id, dna_payload,
                        row_ver,
                        bool(db_dna_row.get("approved", False)),
                        auto_approve,
                    )
                    logger.info(f"Reusing Postgres Product DNA v{row_ver} for SKU {sku_id}")
                    cache_manager.set_hot_dna(org_id, sku_id, synced)
                    return {
                        "product_dna": synced,
                        "dna_approved": bool(synced.get("approved", False)),
                    }

        # 3. Filter strictly to AUTHORITATIVE product references (Style Quarantine!)
        references = state.get("references", [])
        auth_refs = [r for r in references if r.get("role", "additional_product") in PRODUCT_AUTHORITY_ROLES]
        loaded_images = [
            img
            for r in auth_refs
            if (img := load_reference_image(r, allow_local=allow_local, organization_id=org_id)) is not None
        ]

        is_saree = (
            bool(re.search(r"\b(?:sarees?|sari)\b", sku_name.lower()))
            or any("saree" in str(r.get("role", "")).lower() for r in references)
            or str(state.get("garment_family", "")).lower() == "saree"
        )

        dna: Optional[ProductDNAV2] = None
        if loaded_images:
            try:
                prompt = _build_dna_extraction_prompt(sku_name, str(state.get("category") or "ethnic/fusion"), loaded_images)
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
            except Exception as exc:
                logger.warning(f"Vision DNA extraction failed for {sku_id}, falling back to draft heuristic: {exc}")

        is_heuristic = dna is None
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

        if auto_approve and not is_heuristic:
            dna.approved = True
            dna.status = "approved"
            dna.approved_by = "auto_workflow"
            dna.approved_at = datetime.now(timezone.utc)

        dna_dict = dna.model_dump(mode="json")

        persisted = False
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
            persisted = True
            if not is_heuristic:
                cache_manager.set_hot_dna(org_id, sku_id, dna_dict)
        except Exception as e:
            logger.error(f"Could not persist DNA version in DB for {sku_id}: {e}")
            dna_dict["approved"] = False
            dna_dict["status"] = "draft"
            dna_dict["persisted"] = False

        return {
            "product_dna": dna_dict,
            "dna_approved": bool(dna_dict.get("approved", False) and persisted),
            "dna_persisted": persisted,
        }
