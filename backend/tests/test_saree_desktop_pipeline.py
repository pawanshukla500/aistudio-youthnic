import os
import hashlib
import pytest
from models.evidence import compute_sha256
from models.dna_v2 import ProductDNAV2, SareeArchitecture
from agents.evidence_agent import ProductEvidenceAgent
from agents.dna_agent import ProductDNAAgent
from cache import cache_manager

DESKTOP_DIR_CANDIDATES = [
    r"C:\Users\Pawan Shukla\Desktop\Project Images",
    r"C:\Users\Pawan Shukla\Desktop\Projec Images",
]
DESKTOP_DIR = next((d for d in DESKTOP_DIR_CANDIDATES if os.path.isdir(d)), DESKTOP_DIR_CANDIDATES[0])


VALID_ORG_UUID = "7d56360f-2c96-4eb2-923e-f22b7fe36605"


def test_desktop_saree_evidence_hashing_and_quarantine(tmp_path):
    if os.path.exists(DESKTOP_DIR):
        front_path = os.path.join(DESKTOP_DIR, "Sarees Front.jpeg")
        back_path = os.path.join(DESKTOP_DIR, "Sarees Back.jpg")
        ref_candidates = [
            os.path.join(DESKTOP_DIR, "Reference images.jpg"),
            os.path.join(DESKTOP_DIR, "Refrence images.jpg"),
        ]
        ref_path = next((p for p in ref_candidates if os.path.isfile(p)), ref_candidates[0])
        detail_path = os.path.join(DESKTOP_DIR, "Sarees product image (1).jpg")
    else:
        # Fallback fixture for headless CI environments
        front_path = str(tmp_path / "Sarees_Front.jpeg")
        back_path = str(tmp_path / "Sarees_Back.jpg")
        ref_path = str(tmp_path / "Refrence_images.jpg")
        detail_path = str(tmp_path / "Sarees_detail_1.jpg")
        for p, b in [
            (front_path, b"saree_front_sample_bytes_12345"),
            (back_path, b"saree_back_sample_bytes_12345"),
            (ref_path, b"style_ref_sample_bytes_12345"),
            (detail_path, b"saree_detail_sample_bytes_12345"),
        ]:
            with open(p, "wb") as f:
                f.write(b)

    assert os.path.exists(front_path), "Front saree image must exist"
    assert os.path.exists(back_path), "Back saree image must exist"
    assert os.path.exists(ref_path), "Style reference image must exist"
    assert os.path.exists(detail_path), "Detail saree image must exist"

    with open(front_path, "rb") as f:
        front_hash = compute_sha256(f.read())
    with open(back_path, "rb") as f:
        back_hash = compute_sha256(f.read())
    with open(ref_path, "rb") as f:
        ref_hash = compute_sha256(f.read())
    with open(detail_path, "rb") as f:
        detail_hash = compute_sha256(f.read())

    assert len(front_hash) == 64
    assert len(back_hash) == 64
    assert len(ref_hash) == 64
    assert len(detail_hash) == 64

    # Build reference payload for evidence agent
    raw_references = [
        {
            "role": "saree_front_drape",
            "storagePath": "desktop/Sarees_Front.jpeg",
            "downloadUrl": "local://" + front_path.replace("\\", "/"),
            "hash": front_hash,
        },
        {
            "role": "saree_back_drape",
            "storagePath": "desktop/Sarees_Back.jpg",
            "downloadUrl": "local://" + back_path.replace("\\", "/"),
            "hash": back_hash,
        },
        {
            "role": "saree_pallu_spread",
            "storagePath": "desktop/Sarees_detail_1.jpg",
            "downloadUrl": "local://" + detail_path.replace("\\", "/"),
            "hash": detail_hash,
        },
        {
            "role": "style_reference",
            "storagePath": "desktop/Refrence_images.jpg",
            "downloadUrl": "local://" + ref_path.replace("\\", "/"),
            "hash": ref_hash,
        },
    ]

    sku_id = "SKU-SAREE-DESKTOP-001"
    evidence_agent = ProductEvidenceAgent()
    evidence_out = evidence_agent.process({
        "organization_id": VALID_ORG_UUID,
        "sku_id": sku_id,
        "allow_local_references": True,
        "references": raw_references,
    })

    assert "source_fingerprint" in evidence_out
    assert len(evidence_out["references"]) == 4

    # Style reference must be quarantined
    style_ref = next(r for r in evidence_out["references"] if r["role"] == "style_reference")
    assert style_ref["is_style_quarantined"] is True
    assert style_ref["is_authoritative"] is False

    # Product shots must be authoritative
    front_ref = next(r for r in evidence_out["references"] if r["role"] == "saree_front_drape")
    assert front_ref["is_authoritative"] is True
    assert front_ref["is_style_quarantined"] is False


def test_saree_dna_extraction_and_invariants():
    sku_id = "SKU-SAREE-DESKTOP-002"
    sku_name = "Kanjivaram Silk Saree with Rich Gold Zari Pallu"
    fingerprint = "saree_fingerprint_desktop_v2_123"

    cache_manager.invalidate_hot_dna(VALID_ORG_UUID, sku_id)
    dna_agent = ProductDNAAgent()
    dna_out = dna_agent.process({
        "organization_id": VALID_ORG_UUID,
        "sku_id": sku_id,
        "sku_name": sku_name,
        "source_fingerprint": fingerprint,
        "garment_family": "saree",
        "references": [
            {"role": "saree_front_drape"},
            {"role": "saree_back_drape"},
            {"role": "saree_pallu_spread"},
            {"role": "style_reference"},
        ],
    })

    dna = dna_out["product_dna"]
    assert dna["garment_family"] == "saree"
    assert dna["bottom_wear"]["has_bottom_wear"] is False
    assert dna["bottom_wear"]["cut_class"] == "none"
    assert "trousers" in dna["prohibited_changes"]
    assert "palazzo" in dna["prohibited_changes"]
    assert "salwar" in dna["prohibited_changes"]

    # Invariants must enforce unstitched drape with no pants
    invariants_text = " ".join(dna["explicit_invariants"])
    assert "Strictly NO pants, NO palazzos, NO salwars, NO trousers" in invariants_text
    assert "Pose 5 (Detail Frame) must showcase signature pallu artwork" in invariants_text
    assert "Back view (Pose 4) must strictly mirror back product reference" in invariants_text

    # Saree architecture validation
    assert dna["saree_details"] is not None
    assert dna["saree_details"]["drape_style"] == "nivi"
    assert dna["saree_details"]["no_trousers_rule"] is True


def test_farshi_invariants_isolated_from_non_farshi():
    dna_agent = ProductDNAAgent()
    farshi_dna = dna_agent._build_from_vlm(
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "magenta",
            "bottom_wear": {"has_bottom_wear": True, "cut_class": "farshi"},
        },
        org_id=VALID_ORG_UUID,
        sku_id="FARSHI-01",
        sku_name="MAGENTA-FARSHI-SET",
        fingerprint="fp-farshi",
        is_saree=False,
        references=[{"role": "front"}, {"role": "bottom"}],
        provider="meta",
        model="muse-spark-1.2-contributor",
    )
    palazzo_dna = dna_agent._build_from_vlm(
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "ivory",
            "bottom_wear": {"has_bottom_wear": True, "cut_class": "palazzo"},
        },
        org_id=VALID_ORG_UUID,
        sku_id="PALAZZO-01",
        sku_name="IVORY-PALAZZO-SET",
        fingerprint="fp-palazzo",
        is_saree=False,
        references=[{"role": "front"}, {"role": "bottom"}],
        provider="meta",
        model="muse-spark-1.2-contributor",
    )
    assert farshi_dna.bottom_wear.cut_class == "farshi"
    assert palazzo_dna.bottom_wear.cut_class == "palazzo"

    farshi_text = " ".join(farshi_dna.explicit_invariants).lower()
    palazzo_text = " ".join(palazzo_dna.explicit_invariants).lower()
    assert "tapering 4 inches inward from the upper hem seam" in farshi_text
    assert "narrow from the waist side" in farshi_text
    assert "farshi" not in palazzo_text
    assert "tapering 4 inches inward" not in palazzo_text
    assert "palazzo" not in palazzo_dna.prohibited_changes

    # Negative-Farshi classification string & unresolved cut stay isolated
    neg_farshi_dna = dna_agent._build_from_vlm(
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "ivory",
            "bottom_wear": {"has_bottom_wear": True, "cut_class": "palazzo", "classification": "Palazzo, not Farshi"},
        },
        org_id=VALID_ORG_UUID,
        sku_id="PALAZZO-NEG",
        sku_name="IVORY-PALAZZO",
        fingerprint="fp-pal-neg",
        is_saree=False,
        references=[{"role": "front"}, {"role": "bottom"}],
        provider="meta",
        model="muse-spark-1.2-contributor",
    )
    assert neg_farshi_dna.bottom_wear.cut_class == "palazzo"

    unknown_dna = dna_agent._build_from_vlm(
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "ivory",
            "bottom_wear": {"has_bottom_wear": True, "cut_class": "unknown"},
        },
        org_id=VALID_ORG_UUID,
        sku_id="UNKNOWN-01",
        sku_name="IVORY-SET",
        fingerprint="fp-unk",
        is_saree=False,
        references=[{"role": "front"}, {"role": "bottom"}],
        provider="meta",
        model="muse-spark-1.2-contributor",
    )
    assert unknown_dna.bottom_wear.cut_class == "unknown"
