import pytest
from models.dna_v2 import ProductDNAV2, PatternGeometry, EmbroideryGeometry, BottomWearArchitecture


def test_product_dna_v2_creation_and_defaults():
    dna = ProductDNAV2(
        organization_id="7d56360f-2c96-4eb2-923e-f22b7fe36605",
        sku_id="sku_test_001",
        sku_name="T62-Peppa-Purple",
        source_fingerprint="abc123hash",
        main_color="purple",
        fabric_type="silk",
    )
    assert dna.version == 1
    assert dna.status == "draft"
    assert dna.approved is False
    assert dna.confidence_score == 0.95
    assert "Quarantine style reference outfit" in dna.style_quarantine_rules[0]


def test_dna_with_pattern_and_embroidery():
    dna = ProductDNAV2(
        organization_id="org_test",
        sku_id="sku_test_002",
        sku_name="Mogra Kurti",
        source_fingerprint="fingerprint_xyz",
        main_color="ivory",
        pattern_geometry=PatternGeometry(
            print_type="boota",
            motif_inventory=["peacock", "paisley"],
            motif_scale="medium",
        ),
        embroidery_geometry=EmbroideryGeometry(
            has_embroidery=True,
            technique="zari work",
            placement="yoke and neckline",
        ),
    )
    assert dna.pattern_geometry.print_type == "boota"
    assert "peacock" in dna.pattern_geometry.motif_inventory
    assert dna.embroidery_geometry.has_embroidery is True
    assert "Rear construction is locked strictly to direct back reference" in dna.explicit_invariants[0]
