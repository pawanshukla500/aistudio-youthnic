import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { selectFashionKnowledgeGuidance } from "../lib/fashionKnowledge.ts";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "farshi-1",
    organization_id: null,
    category: "kurta_or_kurti_set",
    topic: "bottom_wear",
    title: "Farshi / farsi pajama cut and print lock",
    guidance:
      "Farshi pajama is extremely voluminous two-leg trousers, not palazzo or lehenga. Copy the large metallic floral motifs from the bottom-visible references; never render solid magenta or micro-dots.",
    tags: ["bottom", "farshi", "farsi", "print"],
    priority: 90,
    is_active: true,
    ...overrides,
  };
}

Deno.test("fashion knowledge prefers farshi cut/print rows and ignores pose-framing bottoms", () => {
  const selected = selectFashionKnowledgeGuidance([
    row({
      id: "framing",
      title: "Bottom hem readability",
      topic: "bottoms",
      tags: ["bottom", "pose"],
      priority: 99,
      guidance: "Keep the waistband and hem inside the frame for full-length catalog poses.",
    }),
    row(),
    row({
      id: "org-other",
      organization_id: "org-b",
      title: "Other tenant farshi",
    }),
  ], { organizationId: "org-a", garmentFamily: "kurta_or_kurti_set" });

  assertEquals(selected.ids, ["farshi-1"]);
  assertStringIncludes(selected.guidance, "two-leg trousers");
  assertStringIncludes(selected.guidance, "large metallic floral");
  assertEquals(selected.guidance.includes("waistband"), false);
});

Deno.test("fashion knowledge fails closed without an organization and skips inactive rows", () => {
  assertEquals(selectFashionKnowledgeGuidance([row()], { organizationId: "" }), { ids: [], guidance: "" });
  assertEquals(
    selectFashionKnowledgeGuidance([row({ is_active: false })], { organizationId: "org-a" }),
    { ids: [], guidance: "" },
  );
  assertEquals(
    selectFashionKnowledgeGuidance([row()], { organizationId: "org-a", garmentFamily: "saree" }),
    { ids: [], guidance: "" },
  );
});

Deno.test("fashion knowledge isolates Farshi from non-Farshi cuts while allowing saree and dupatta rules", () => {
  const rows = [
    row(),
    row({
      id: "saree-genz-1",
      category: "saree",
      topic: "saree_drape",
      title: "Gen-Z saree drape",
      guidance: "Present sarees with clean Gen-Z Nivi shoulder drape and crisp pleated borders.",
      tags: ["saree", "genz", "drape"],
      priority: 85,
    }),
    row({
      id: "dupatta-1",
      category: "kurta_or_kurti_set",
      topic: "dupatta_drape",
      title: "Dupatta detection and forward rear drape",
      guidance: "Inspect mannequin/flat-lay uploads for dupatta and sweep forward on pose 3 back view.",
      tags: ["dupatta"],
      priority: 80,
    }),
  ];

  const palazzoSelection = selectFashionKnowledgeGuidance(rows, {
    organizationId: "org-a",
    garmentFamily: "kurta_or_kurti_set",
    bottomCutClass: "palazzo",
  });
  assertEquals(palazzoSelection.ids, ["dupatta-1"]);
  assertEquals(palazzoSelection.guidance.includes("Farshi"), false);

  const farshiSelection = selectFashionKnowledgeGuidance(rows, {
    organizationId: "org-a",
    garmentFamily: "kurta_or_kurti_set",
    bottomCutClass: "farshi",
  });
  assertEquals(farshiSelection.ids, ["farshi-1", "dupatta-1"]);

  const sareeSelection = selectFashionKnowledgeGuidance(rows, {
    organizationId: "org-a",
    garmentFamily: "saree",
  });
  assertEquals(sareeSelection.ids, ["saree-genz-1"]);
});
