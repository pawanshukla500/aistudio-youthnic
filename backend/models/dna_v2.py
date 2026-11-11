from typing import List, Dict, Optional, Literal, Any
from pydantic import BaseModel, Field, model_validator


FARSHI_SALWAR_STRUCTURE = (
    "Voluminous flared trousers with TWO DISTINCT LEGS (never a lehenga or circular skirt). "
    "Vertical pleats or gathers from waist/hip create an architectural A-line flare toward the hem. "
    "Features a joined hem panel (approx. 5-6 inches) with sequin/lace trim. "
    "Strictly prohibited: circular skirt flare, tubular palazzo pants, gathered salwar ponchas, or knee-jointed shararas."
)


class PatternGeometry(BaseModel):
    print_type: str = "none"
    motif_inventory: List[str] = Field(default_factory=list)
    motif_scale: str = "medium"
    motif_density: str = "moderate"
    motif_repeat: str = "regular"
    placement_by_panel: Dict[str, str] = Field(default_factory=dict)
    accent_colors: List[str] = Field(default_factory=list)


class EmbroideryGeometry(BaseModel):
    has_embroidery: bool = False
    technique: str = "none"
    placement: str = "none"
    motif_structure: str = "none"
    scale_relative_to_garment: str = "proportional"
    border_construction: str = "none"
    neckline_relation: str = "none"


class SareeArchitecture(BaseModel):
    drape_style: str = "nivi"
    pallu_direction: str = "over_left_shoulder"
    pallu_zari_type: str = "none"
    pallu_artwork_description: Optional[str] = None
    border_weave_type: str = "none"
    border_width_cm: float = 0.0
    body_butti_type: str = "none"
    blouse_fabric_coordination: str = "contrast_or_matching"
    blouse_sleeve_length: str = "elbow_length"
    blouse_back_neckline: str = "deep_u_or_round"
    pleat_count_approx: int = 7
    underskirt_petticoat_type: str = "cotton_or_satin_petticoat"
    no_trousers_rule: bool = True


class BottomWearArchitecture(BaseModel):
    has_bottom_wear: bool = False
    classification: str = "none"
    cut_class: Literal["farshi", "straight", "palazzo", "sharara", "churidar", "skirt", "none"] = "none"
    two_leg_construction: bool = True
    waist_structure: str = "standard"
    flare_volume: str = "standard"
    joined_hem: bool = False
    hem_trim: str = "none"
    fabric_color: str = "matching"
    print_and_motifs: str = "same_as_evidence"
    prohibited_cuts: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def enforce_farshi_invariants(self) -> "BottomWearArchitecture":
        if self.cut_class == "farshi" or "farshi" in self.classification.lower() or "farsi" in self.classification.lower():
            self.cut_class = "farshi"
            self.two_leg_construction = True
            self.joined_hem = True
            if "palazzo" not in [c.lower() for c in self.prohibited_cuts]:
                self.prohibited_cuts.append("palazzo")
            if "circular_skirt" not in [c.lower() for c in self.prohibited_cuts]:
                self.prohibited_cuts.append("circular_skirt")
            if "sharara_knee_joint" not in [c.lower() for c in self.prohibited_cuts]:
                self.prohibited_cuts.append("sharara_knee_joint")
            if "lehenga" not in [c.lower() for c in self.prohibited_cuts]:
                self.prohibited_cuts.append("lehenga")
        return self


class ProductDNAV2(BaseModel):
    organization_id: str
    sku_id: str
    sku_name: str
    version: int = 1
    status: Literal["draft", "pending_approval", "approved", "deprecated", "rejected"] = "draft"
    approved: bool = False
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    source_fingerprint: str

    # Classification
    garment_family: str = "kurta_or_kurti_set"
    category: str = "ethnic/fusion"
    silhouette: str = "straight"
    fit: str = "regular"
    length: str = "knee-length"

    # Color & Fabric
    main_color: str
    secondary_colors: List[str] = Field(default_factory=list)
    fabric_type: str = "cotton"
    fabric_texture: str = "smooth"
    fabric_weight: str = "light-to-medium"
    sheen: str = "matte"
    transparency: str = "opaque"

    # Details
    neckline: str = "round"
    sleeve_type: str = "three-quarter"
    front_construction: str = "straight panel"
    back_construction: str = "plain back with direct evidence lock"
    closures: str = "none"
    side_slits: str = "standard side slits"
    hem_finish: str = "stitched clean hem"

    # Pattern & Embroidery
    pattern_geometry: PatternGeometry = Field(default_factory=PatternGeometry)
    embroidery_geometry: EmbroideryGeometry = Field(default_factory=EmbroideryGeometry)

    # Bottom Wear
    bottom_wear: BottomWearArchitecture = Field(default_factory=BottomWearArchitecture)

    # Saree Architecture
    saree_details: Optional[SareeArchitecture] = None

    # Invariants, Quarantine & Uncertainty
    explicit_invariants: List[str] = Field(default_factory=list)
    prohibited_changes: List[str] = Field(default_factory=list)
    style_quarantine_rules: List[str] = Field(default_factory=lambda: [
        "Quarantine style reference outfit: 100% discard all clothing, fabric, colors, and jewelry worn by style model.",
        "Dress generated model exclusively in verified product references.",
    ])
    uncertain_attributes: List[str] = Field(default_factory=list)
    confidence_score: float = Field(default=0.95, ge=0.0, le=1.0)
    evidence_manifest: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_dna_consistency(self) -> "ProductDNAV2":
        # Saree validation
        if self.garment_family.lower() == "saree" or "saree" in self.sku_name.lower() or "sari" in self.sku_name.lower():
            self.garment_family = "saree"
            self.bottom_wear.has_bottom_wear = False
            self.bottom_wear.classification = "none"
            self.bottom_wear.cut_class = "none"
            self.bottom_wear.two_leg_construction = False
            self.bottom_wear.joined_hem = False

            saree_rules = [
                "Saree is a continuous unstitched drape paired with fitted blouse and underskirt petticoat. Strictly NO pants, NO palazzos, NO salwars, NO trousers.",
                "Pose 5 (Detail Frame) must showcase signature pallu artwork or zari border weave, never an accessory hijack.",
                "Back view (Pose 3) must strictly mirror back product reference showing blouse back neckline and pallu drape.",
            ]
            for r in saree_rules:
                if r not in self.explicit_invariants:
                    self.explicit_invariants.append(r)
            for p in ["trousers", "palazzo", "salwar", "churidar", "jeans"]:
                if p not in self.prohibited_changes:
                    self.prohibited_changes.append(p)

        # Farshi Salwar validation
        if self.bottom_wear.cut_class == "farshi":
            farshi_rule = "Farshi salwar requires distinct two-leg construction with vertical gathers and joined hem. Never substitute palazzo."
            if farshi_rule not in self.explicit_invariants:
                self.explicit_invariants.append(farshi_rule)
            if "palazzo" not in self.prohibited_changes:
                self.prohibited_changes.append("palazzo")
            if "skirt" not in self.prohibited_changes:
                self.prohibited_changes.append("skirt")

        # Back construction rule: Front details must not be mirrored without evidence
        back_rule = "Rear construction is locked strictly to direct back reference. No unproven front trims or necklines may be mirrored on back."
        if back_rule not in self.explicit_invariants:
            self.explicit_invariants.append(back_rule)

        return self


def create_empty_dna_draft(org_id: str, sku_id: str, sku_name: str, fingerprint: str) -> ProductDNAV2:
    return ProductDNAV2(
        organization_id=org_id,
        sku_id=sku_id,
        sku_name=sku_name,
        source_fingerprint=fingerprint,
        main_color="unspecified",
    )
