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

Deno.test("seeded top_only, farshi, saree, and dupatta rows survive 350-char row cap without truncation or cross-bleed", () => {
  const seededRows = [
    row({
      id: "seed-farshi",
      topic: "bottom_wear",
      title: "Farshi / farsi pajama cut and print lock",
      guidance:
        "Farshi ONLY: 2 trouser legs, narrow hem from waist side, 6-inch joined hem panel tapering 4 inches inward from upper hem seam, waist & side-joint pleats. Copy bottom color & print verbatim; never palazzo, lehenga, or poncha. Never apply to non-Farshi cuts.",
      tags: ["bottom", "farshi", "farsi", "print"],
      priority: 90,
    }),
    row({
      id: "seed-saree",
      category: "saree",
      topic: "saree_drape",
      title: "Gen-Z saree drape and editorial pose discipline",
      guidance:
        "Gen-Z saree poise: fluid Nivi/uploaded drape, crisp stacked waist pleats, exact pallu boundary & equal borders. Vary poses cleanly (hero front, 3/4 turn, seated editorial, true rear blouse/pallu, macro craft, motion showcase). Unstitched drape only — zero trousers or duplicate pallus.",
      tags: ["saree", "genz", "drape"],
      priority: 85,
    }),
    row({
      id: "seed-dupatta",
      category: "kurta_or_kurti_set",
      topic: "dupatta_drape",
      title: "Multi-piece kurti set dupatta detection and rear clearance",
      guidance:
        "Scan mannequin/flat-lay, additional_product, front & back for dupatta/stole. Render exact fabric, ombré colors, motifs & gota trim across all frames; drape forward over both arms on Pose 3 back view so rear neckline stays 100% clear. Keep Pose 5 on primary kurti craft.",
      tags: ["dupatta", "kurti_set"],
      priority: 82,
    }),
    row({
      id: "seed-top-only",
      category: "kurta_or_kurti_set",
      topic: "top_only",
      title: "Standalone top-only kurti proportion and non-set rule",
      guidance:
        "Standalone top-only kurti: pair ONLY with plain solid neutral styling trousers; never copy top print, embroidery, or color onto bottoms, and apply non-Farshi straight/relaxed styling only. Vary poses to highlight neckline, sleeves, length & primary craft.",
      tags: ["top_only", "kurti"],
      priority: 80,
    }),
  ];

  const topOnly = selectFashionKnowledgeGuidance(seededRows, {
    organizationId: "org-a",
    garmentFamily: "kurta_or_kurti_set",
    bottomCutClass: "none",
  });
  assertEquals(topOnly.ids, ["seed-dupatta", "seed-top-only"]);
  assertEquals(topOnly.guidance.includes("[truncated]"), false);

  const farshi = selectFashionKnowledgeGuidance(seededRows, {
    organizationId: "org-a",
    garmentFamily: "kurta_or_kurti_set",
    bottomCutClass: "farshi",
  });
  assertEquals(farshi.ids, ["seed-farshi", "seed-dupatta"]);
  assertEquals(farshi.guidance.includes("[truncated]"), false);
  assertStringIncludes(farshi.guidance, "Pose 3 back view");

  const saree = selectFashionKnowledgeGuidance(seededRows, {
    organizationId: "org-a",
    garmentFamily: "saree",
  });
  assertEquals(saree.ids, ["seed-saree"]);
  assertEquals(saree.guidance.includes("[truncated]"), false);
  assertStringIncludes(saree.guidance, "zero trousers");
});
