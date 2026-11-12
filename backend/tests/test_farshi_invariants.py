import pytest
from models.dna_v2 import BottomWearArchitecture, ProductDNAV2


def test_farshi_bottom_wear_invariants_enforced():
    bottom = BottomWearArchitecture(
        has_bottom_wear=True,
        classification="Farshi Salwar",
        cut_class="farshi",
    )
    # Check validator enforcement
    assert bottom.two_leg_construction is True
    assert bottom.joined_hem is True
    assert "palazzo" in [p.lower() for p in bottom.prohibited_cuts]
    assert "circular_skirt" in [p.lower() for p in bottom.prohibited_cuts]


def test_dna_with_farshi_injects_invariants():
    dna = ProductDNAV2(
        organization_id="org_test",
        sku_id="sku_farshi_01",
        sku_name="Mogra Farshi Suit",
        source_fingerprint="hash_farshi",
        main_color="green",
        bottom_wear=BottomWearArchitecture(
            has_bottom_wear=True,
            classification="Farshi Pajama",
            cut_class="farshi",
        ),
    )
    # The DNA model validator must inject the Farshi rule into explicit invariants
    invariants_text = " ".join(dna.explicit_invariants)
    assert "Farshi salwar requires distinct two-leg construction" in invariants_text
    assert "palazzo" in dna.prohibited_changes
    assert "skirt" in dna.prohibited_changes


def test_vlm_palazzo_with_joined_5_inch_panel_promotes_to_farshi():
    from agents.dna_agent import ProductDNAAgent

    agent = ProductDNAAgent()
    dna = agent._build_from_vlm(
        org_id="org_test",
        sku_id="sku_farshi_panel",
        sku_name="Untitled studio product",
        provider="meta",
        model="muse-spark-1.2-contributor",
        references=[{"role": "front"}, {"role": "bottom"}],
        fingerprint="fp_farshi_panel",
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "deep fuchsia",
            "bottom_wear": {
                "has_bottom_wear": True,
                "classification": "Palazzo",
                "cut_class": "palazzo",
                "two_leg_construction": True,
                "waist_structure": "elasticated gathered waist",
                "flare_volume": "moderate flare",
                "joined_hem": True,
                "hem_trim": "thin gold gota separating ~5-inch hem panel from leg at ankle",
            },
        },
        is_saree=False,
    )
    assert dna.bottom_wear.cut_class == "farshi"
    assert dna.bottom_wear.classification == "Farshi Salwar"


def test_vlm_unbroken_palazzo_stays_palazzo():
    from agents.dna_agent import ProductDNAAgent

    agent = ProductDNAAgent()
    dna = agent._build_from_vlm(
        org_id="org_test",
        sku_id="sku_palazzo_01",
        sku_name="Rose Kurti Palazzo",
        provider="meta",
        model="muse-spark-1.2-contributor",
        references=[{"role": "front"}, {"role": "bottom"}],
        fingerprint="fp_palazzo_01",
        raw={
            "garment_family": "kurta_or_kurti_set",
            "main_color": "rose pink",
            "bottom_wear": {
                "has_bottom_wear": True,
                "classification": "Palazzo",
                "cut_class": "palazzo",
                "two_leg_construction": True,
                "joined_hem": False,
                "hem_trim": "clean stitched open hem",
            },
        },
        is_saree=False,
    )
    assert dna.bottom_wear.cut_class == "palazzo"
    assert dna.bottom_wear.classification == "Palazzo"
