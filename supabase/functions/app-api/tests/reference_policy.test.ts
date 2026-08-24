import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  MAX_IMAGE_REFERENCES,
  canUsePoseOneAnchor,
  isSareeReferenceSet,
  missingRequiredReferenceLabels,
  roleLabel,
  selectReferences,
} from "../lib/referencePolicy.ts";

Deno.test("critical saree regions survive provider-limit truncation before duplicates and anchors", () => {
  const references = [
    { role: "model_identity", hash: "model" },
    ...Array.from({ length: 12 }, (_, index) => ({ role: "saree_front_drape", hash: `front-${index}` })),
    { role: "saree_back_drape", hash: "back" },
    { role: "saree_body_detail", hash: "body" },
    { role: "saree_pallu_spread", hash: "pallu" },
    { role: "saree_border_tassels", hash: "border" },
    { role: "saree_blouse_front", hash: "blouse-front" },
    { role: "saree_blouse_back_piece", hash: "blouse-back" },
    { role: "style_reference", hash: "style" },
  ];
  const selected = selectReferences(
    references,
    [{ role: "approved_pose", hash: "anchor" }],
    "full_front",
    "saree",
  );
  const roles = selected.map((reference) => reference.role);

  assertEquals(selected.length, MAX_IMAGE_REFERENCES);
  for (const required of ["saree_front_drape", "saree_back_drape", "saree_body_detail", "saree_pallu_spread"]) {
    assert(roles.includes(required), `${required} must be protected from truncation.`);
  }
  assertEquals(roles.includes("style_reference"), false);
  assertEquals(roles.includes("approved_pose"), false);
});

Deno.test("legacy saree aliases remain valid and pallu has a distinct authority label", () => {
  const selected = selectReferences([
    { role: "front" },
    { role: "back" },
    { role: "fabric_pattern" },
    { role: "saree_pallu_spread" },
  ], [], "back", "saree");

  assertEquals(selected.map((reference) => reference.role).sort(), ["back", "fabric_pattern", "front", "saree_pallu_spread"].sort());
  assertStringIncludes(roleLabel("saree_pallu_spread"), "FULLY SPREAD PALLU");
});

Deno.test("Pose 1 cannot become a saree anchor before strict verification", () => {
  assertEquals(canUsePoseOneAnchor("saree", "requires_human_review"), false);
  assertEquals(canUsePoseOneAnchor("saree", "unverified"), false);
  assertEquals(canUsePoseOneAnchor("saree", "rejected_by_qa"), false);
  assertEquals(canUsePoseOneAnchor("saree", "automatically_verified"), true);
  assertEquals(canUsePoseOneAnchor("saree", "human_approved"), true);
  assertEquals(canUsePoseOneAnchor("dress", "passed"), true);
});

Deno.test("Studio and Bulk/Catalog share the same region-aware readiness policy", () => {
  const references = [
    { role: "front", downloadUrl: "front.jpg" },
    { role: "back", downloadUrl: "back.jpg" },
    { role: "fabric_pattern", downloadUrl: "body.jpg" },
    { role: "saree_pallu_spread", downloadUrl: "pallu.jpg" },
  ];

  assertEquals(isSareeReferenceSet(references, "saree"), true);
  assertEquals(missingRequiredReferenceLabels(references, "saree"), []);
  assertEquals(
    missingRequiredReferenceLabels(references.filter((reference) => reference.role !== "saree_pallu_spread"), "saree"),
    ["fully spread pallu"],
  );
});
