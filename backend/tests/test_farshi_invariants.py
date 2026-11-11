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
