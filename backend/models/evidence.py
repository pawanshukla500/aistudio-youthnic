import hashlib
from typing import Literal, Optional, Dict, Any, List
from pydantic import BaseModel, Field


ReferenceRole = Literal[
    "front",
    "back",
    "bottom",
    "fabric_pattern",
    "mannequin",
    "additional_product",
    "model_identity",
    "style_reference",
    "approved_pose",
    # Saree specific roles
    "saree_front_drape",
    "saree_back_drape",
    "saree_body_detail",
    "saree_pallu_spread",
    "saree_border_tassels",
    "saree_blouse_front",
    "saree_blouse_back_piece",
]

NON_PRODUCT_ROLES = {"style_reference", "model_identity", "approved_pose"}
PRODUCT_AUTHORITY_ROLES = {
    "front",
    "back",
    "bottom",
    "fabric_pattern",
    "mannequin",
    "additional_product",
    "saree_front_drape",
    "saree_back_drape",
    "saree_body_detail",
    "saree_pallu_spread",
    "saree_border_tassels",
    "saree_blouse_front",
    "saree_blouse_back_piece",
}


class BoundingBox(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0, description="Normalized top-left x")
    y: float = Field(..., ge=0.0, le=1.0, description="Normalized top-left y")
    width: float = Field(..., gt=0.0, le=1.0, description="Normalized width")
    height: float = Field(..., gt=0.0, le=1.0, description="Normalized height")


class RegionCropEvidence(BaseModel):
    crop_id: Optional[str] = None
    region_name: str = Field(..., description="Target garment region e.g. 'yoke', 'salwar_hem', 'sleeves'")
    bounding_box: BoundingBox
    crop_storage_path: Optional[str] = None
    crop_download_url: Optional[str] = None
    mask_storage_path: Optional[str] = None
    construction_notes: Optional[str] = None


class ProductReferenceEvidence(BaseModel):
    id: Optional[str] = None
    organization_id: str
    sku_id: str
    role: ReferenceRole
    storage_path: str
    download_url: str
    sha256_hash: str
    mime_type: str = "image/jpeg"
    dimensions: Dict[str, int] = Field(default_factory=lambda: {"width": 0, "height": 0})
    region_type: str = "general"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    is_authoritative: bool = True
    metadata: Dict[str, Any] = Field(default_factory=dict)
    crops: List[RegionCropEvidence] = Field(default_factory=list)

    @property
    def is_garment_truth(self) -> bool:
        return self.role in PRODUCT_AUTHORITY_ROLES

    @property
    def is_style_quarantine(self) -> bool:
        return self.role == "style_reference"


def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
