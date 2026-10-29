import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { coarseGarmentFamilyForCategory } from "../lib/garmentPoses.ts";
import {
  effectiveShowcaseShot,
  nextShowcaseOutcomeCounts,
  normalizeShowcasePlan,
  planShowcaseOutcomeWrite,
  resolveShowcaseShotType,
  selectShowcaseFeedbackGuidance,
  showcaseOutcomeKey,
} from "../lib/showcaseFeature.ts";
import { ANALYSIS_VERSION, buildCombinedAnalysisPrompt, getPoseSlots, normalizeAnalysis } from "../lib/profiles.ts";
import { composeGenerationPrompt } from "../lib/generationPrompt.ts";
import { MAX_IMAGE_REFERENCES, roleLabel, selectReferences } from "../lib/referencePolicy.ts";

function pose(id: string, poseNumber: number) {
  return {
    id,
    title: `Pose ${poseNumber}`,
    poseNumber,
    description: "test",
    cameraAngle: "eye level",
    framing: "3:4",
    bodyPosition: "standing",
    handPlacement: "relaxed",
    expression: "warm",
    highlightedDetails: [],
    productVisibilityRules: [],
    primaryReference: "front",
    purpose: "test",
    consistencyNotes: "locked",
    prompt: "Generate the frame.",
    enabled: true,
  };
}

const bottomPlan = {
  heroFeature: "wide gold tissue flared palazzo with a 4-inch woven border",
  featureRegion: "bottom_wear",
  shotType: "full_body_feature",
  whyItSells: "the flare and border are what distinguish this set",
  evidenceReference: "bottom",
  framing: "3:4 head-to-toe, angled so the flare opens toward camera",
  cameraAngle: "Slightly low eye-level to lengthen the flare",
  bodyPosition: "Mid-turn with the leading leg forward so the flare opens",
  handPlacement: "Hands lifted clear of the hips",
  expression: "Calm and confident",
  distinctFrom: "Pose 1 is straight-on and whole-outfit; this is angled and led by the palazzo flare",
  visibilityRules: ["the border must read unbroken around the hem"],
};

Deno.test("a plan needs a named feature and a region to be usable", () => {
  assertEquals(normalizeShowcasePlan(null), null);
  assertEquals(normalizeShowcasePlan({ heroFeature: "", featureRegion: "bottom_wear" }), null);
  assertEquals(normalizeShowcasePlan({ heroFeature: "gold border", featureRegion: "nonsense" }), null);

  const plan = normalizeShowcasePlan({ heroFeature: "gold zari border", featureRegion: "hem_border" });
  assert(plan);
  // An unstated shot type is derived from the region rather than left blank.
  assertEquals(plan.shotType, "macro_detail");
  assertEquals(showcaseOutcomeKey(plan), "hem_border:macro_detail");
});

Deno.test("a tight shot on the close-up's own subject is widened, not duplicated", () => {
  const collides = normalizeShowcasePlan({
    heroFeature: "sequinned square neckline yoke",
    featureRegion: "neckline",
    shotType: "macro_detail",
  })!;
  const widened = resolveShowcaseShotType(collides, { heroDetail: "the sequinned neckline yoke embroidery" });
  assertEquals(widened.widenedFromCloseup, true);
  assertEquals(widened.shotType, "full_body_feature");

  // A different subject at the same distance is legitimate coverage.
  const distinct = normalizeShowcasePlan({
    heroFeature: "bell sleeve cuff with mirror work",
    featureRegion: "sleeve",
    shotType: "macro_detail",
  })!;
  assertEquals(
    resolveShowcaseShotType(distinct, { heroDetail: "the sequinned neckline yoke embroidery" }).widenedFromCloseup,
    false,
  );

  // A drape subject widens to a drape frame rather than a full-body one.
  const pallu = normalizeShowcasePlan({
    heroFeature: "pallu zari artwork",
    featureRegion: "pallu",
    shotType: "half_body_detail",
  })!;
  assertEquals(resolveShowcaseShotType(pallu, { heroDetail: "pallu zari artwork" }).shotType, "drape_feature");

  // With no recorded close-up subject there is nothing to collide with.
  assertEquals(resolveShowcaseShotType(collides, {}).widenedFromCloseup, false);
});

Deno.test("the sixth pose slot is built from the chosen feature", () => {
  const slots = getPoseSlots({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "Palazzo, wide flare" },
    showcasePlan: bottomPlan,
  });
  assertEquals(slots.length, 6);
  const showcase = slots[5];
  assertEquals(showcase.id, "showcase");
  assertStringIncludes(showcase.title, "palazzo");
  assertStringIncludes(showcase.prompt, "wide gold tissue flared palazzo");
  assert(showcase.productVisibilityRules.some((rule) => rule.includes("border must read unbroken")));
  assert(showcase.productVisibilityRules.some((rule) => rule.includes("never a repeat of the hero framing")));
});

Deno.test("without a plan the slot falls back to the family template", () => {
  const slots = getPoseSlots({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "Palazzo, wide flare" },
  });
  assertEquals(slots[5].id, "showcase");
  assertStringIncludes(slots[5].title, "Top & Bottom");
});

Deno.test("normalizeAnalysis carries the plan into creative direction and the pose plan", () => {
  const normalized = normalizeAnalysis({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "Palazzo, wide flare" },
    showcasePlan: bottomPlan,
  }, "kurta set");
  assertEquals(normalized.creativeDirection.showcasePlan?.featureRegion, "bottom_wear");
  assertStringIncludes(normalized.posePlan[5].prompt, "wide gold tissue flared palazzo");
});

Deno.test("F-17 verbose manifest evidence canonicalizes before pose reference selection", () => {
  const evidenceReference = roleLabel("fabric_pattern");
  assert(evidenceReference.length > 120);
  const normalized = normalizeAnalysis({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "Palazzo, wide flare" },
    showcasePlan: {
      heroFeature: "gold thread yoke embroidery",
      featureRegion: "embroidery",
      shotType: "macro_detail",
      evidenceReference,
    },
  }, "kurta set");

  assertEquals(normalized.creativeDirection.showcasePlan?.evidenceReference, "fabric_pattern");
  const primaryReference = normalized.posePlan[5].primaryReference;
  assertEquals(primaryReference, "fabric_pattern");
  const selected = selectReferences(
    [
      { role: "front", hash: "front" },
      { role: "bottom", hash: "bottom" },
      { role: "fabric_pattern", hash: "fabric" },
      { role: "back", hash: "back" },
    ],
    [],
    "showcase",
    "kurta_or_kurti_set",
    MAX_IMAGE_REFERENCES,
    primaryReference,
  );
  assertEquals(selected[0]?.role, "fabric_pattern");
});

Deno.test("the generation prompt names the feature and forbids both duplications", () => {
  const prompt = composeGenerationPrompt({
    skuName: "KURTA-SET-01",
    productDetails: "Kurta set with gold palazzo",
    pose: pose("showcase", 6) as never,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "Palazzo, wide flare" },
      creativeDirection: { showcasePlan: bottomPlan, closeupHeroDetail: "the sequinned neckline yoke" },
    },
    references: [{ role: "front" }, { role: "bottom" }],
  });
  assertStringIncludes(prompt, "SHOWCASE FRAME SUBJECT: wide gold tissue flared palazzo");
  assertStringIncludes(prompt, "SHOWCASE FRAME MUST NOT DUPLICATE");
  assertStringIncludes(prompt, "SHOWCASE FRAME MUST NOT REPEAT THE CLOSE-UP");
  assertStringIncludes(prompt, "the sequinned neckline yoke");
  assertStringIncludes(prompt, "SHOWCASE FRAME DISTINCTION");
  assertStringIncludes(prompt, "the border must read unbroken around the hem");
  // The fixed-formula rules must not also fire.
  assertEquals(prompt.includes("SHOWCASE FRAME HARD RULE (COMPLETE SET)"), false);
});

Deno.test("a colliding subject is told to shoot wider rather than re-crop", () => {
  const prompt = composeGenerationPrompt({
    skuName: "KURTI-01",
    productDetails: "Embroidered kurti",
    pose: pose("showcase", 6) as never,
    session: {
      productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "none - standalone garment" },
      creativeDirection: {
        showcasePlan: { heroFeature: "sequinned square neckline yoke", featureRegion: "neckline", shotType: "macro_detail" },
        closeupHeroDetail: "the sequinned neckline yoke embroidery",
      },
    },
    references: [{ role: "front" }],
  });
  assertStringIncludes(prompt, "shoot the named feature at a wider distance here");
  assertStringIncludes(prompt, "Frame head-to-toe");
});

Deno.test("a legacy analysis without a plan still gets the fixed showcase rule", () => {
  const prompt = composeGenerationPrompt({
    skuName: "SAREE-01",
    productDetails: "Silk saree",
    pose: pose("showcase", 6) as never,
    session: {
      category: "saree",
      productIdentity: {
        garmentFamily: "saree",
        sareeTruth: { body: { baseColor: "ivory" } },
        sareeDrapePlan: { baseDrapeFamily: "open pallu" },
      },
    },
    references: [{ role: "saree_front_drape" }],
  });
  assertStringIncludes(prompt, "SHOWCASE FRAME HARD RULE (DRAPE-LED)");
});

Deno.test("the analysis prompt asks for a chosen feature and forbids a hero repeat", () => {
  const prompt = buildCombinedAnalysisPrompt({
    skuName: "SKU-1",
    productDetails: "",
    category: "kurta set",
    modelDirection: "",
    sceneDirection: "",
    referenceManifest: [{ number: 1, role: "front" }],
    showcaseFeedback: "- bottom_wear as full_body_feature: kept 4 time(s) - this reads well for this category.",
  });
  assertStringIncludes(prompt, "THE SIXTH FRAME IS DECIDED BY YOU");
  assertStringIncludes(prompt, "MANDATORY NON-DUPLICATION");
  assertStringIncludes(prompt, "It must NOT be a second full-body hero");
  assertStringIncludes(prompt, "It must NOT re-shoot pose 5's subject");
  assertStringIncludes(prompt, "SIXTH-FRAME FEEDBACK");
  assertStringIncludes(prompt, "bottom_wear as full_body_feature");
  assertStringIncludes(prompt, '"showcasePlan":{"heroFeature":""');
  assertEquals(ANALYSIS_VERSION, "generation-session-v32-listing-identity-leads-analysis");
});

Deno.test("a widened frame is what the slot, the prompt and the feedback key all use", () => {
  const collidingCreative = {
    showcasePlan: { heroFeature: "sequinned square neckline yoke", featureRegion: "neckline", shotType: "macro_detail" },
    closeupHeroDetail: "the sequinned neckline yoke embroidery",
  };
  const shot = effectiveShowcaseShot(collidingCreative);
  assert(shot);
  assertEquals(shot.shotType, "full_body_feature");
  assertEquals(shot.widenedFromCloseup, true);
  // The key the feedback row is written under must be the widened frame.
  assertEquals(showcaseOutcomeKey({ featureRegion: shot.plan.featureRegion, shotType: shot.shotType }), "neckline:full_body_feature");

  // The stored pose brief must not still describe the tight crop.
  const slots = getPoseSlots({
    productIdentity: { garmentFamily: "kurta_or_kurti_set" },
    showcasePlan: { ...collidingCreative.showcasePlan, framing: "Tight macro crop on the yoke" },
    closeupHeroDetail: collidingCreative.closeupHeroDetail,
  });
  assertEquals(slots[5].framing.includes("Tight macro crop"), false);
  assertStringIncludes(slots[5].framing, "Frame head-to-toe");

  assertEquals(effectiveShowcaseShot({}), null);
  assertEquals(effectiveShowcaseShot({ showcasePlan: { heroFeature: "x" } }), null);
});

Deno.test("a model-supplied showcase pose cannot drop the plan's guarantees", () => {
  const normalized = normalizeAnalysis({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "Palazzo, wide flare" },
    showcasePlan: bottomPlan,
    posePlan: [
      { id: "showcase", title: "Hero repeat", prompt: "Straight-on full body", productVisibilityRules: ["whole outfit visible"], enabled: false },
    ],
  }, "kurta set");
  const showcase = normalized.posePlan[5];
  // Its own prose is kept...
  assertEquals(showcase.title, "Hero repeat");
  // ...but not at the cost of the subject, the non-duplication rule, or the frame.
  assertEquals(showcase.enabled, true);
  assert(showcase.productVisibilityRules.some((rule) => rule.includes("wide gold tissue flared palazzo")));
  assert(showcase.productVisibilityRules.some((rule) => rule.includes("never a repeat of the hero framing")));
  assert(showcase.productVisibilityRules.includes("whole outfit visible"));
});

Deno.test("the sixth-frame prompt does not lean on another frame having been shot", () => {
  const slots = getPoseSlots({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "Palazzo, wide flare" },
    showcasePlan: bottomPlan,
  });
  // The analysis contract requires every pose prompt to be self-contained.
  assertEquals(/established in Pose 1|same as full_front|consistent with previous poses/i.test(slots[5].prompt), false);
  assertStringIncludes(slots[5].prompt, "locked model identity");
});

Deno.test("feedback guidance is org, category and family scoped and needs real signal", () => {
  const rows = [
    { id: "a", organization_id: "org-1", product_category: "kurta set", garment_family: "kurta_or_kurti_set", feature_region: "bottom_wear", shot_type: "full_body_feature", selected_count: 5 },
    { id: "b", organization_id: "org-1", product_category: "kurta set", garment_family: "kurta_or_kurti_set", feature_region: "complete_set", shot_type: "full_body_feature", rejected_count: 4, regenerated_count: 2 },
    // No feedback recorded yet.
    { id: "c", organization_id: "org-1", product_category: "kurta set", garment_family: "kurta_or_kurti_set", feature_region: "sleeve", shot_type: "macro_detail" },
    // Another tenant.
    { id: "d", organization_id: "org-2", product_category: "kurta set", garment_family: "kurta_or_kurti_set", feature_region: "print", shot_type: "macro_detail", selected_count: 9 },
    // Another category.
    { id: "e", organization_id: "org-1", product_category: "saree", garment_family: "saree", feature_region: "pallu", shot_type: "drape_feature", selected_count: 9 },
    // Another family within the same category.
    { id: "f", organization_id: "org-1", product_category: "kurta set", garment_family: "dress", feature_region: "silhouette", shot_type: "full_body_feature", selected_count: 7 },
  ];
  const selection = selectShowcaseFeedbackGuidance(rows, {
    organizationId: "org-1",
    productCategory: "kurta set",
    garmentFamily: "kurta_or_kurti_set",
  });
  assertEquals(selection.ids, ["a", "b"]);
  assertStringIncludes(selection.guidance, "bottom_wear as full_body_feature: kept 5 time(s)");
  assertStringIncludes(selection.guidance, "complete_set as full_body_feature: reworked or rejected 6 time(s)");
  assertEquals(selection.guidance.includes("sleeve"), false);
  assertEquals(selection.guidance.includes("print"), false);
  assertEquals(selection.guidance.includes("pallu"), false);
  assertEquals(selection.guidance.includes("silhouette"), false);

  assertEquals(selectShowcaseFeedbackGuidance(rows, { organizationId: "", productCategory: "kurta set" }).ids, []);
  assertEquals(selectShowcaseFeedbackGuidance(null, { organizationId: "org-1", productCategory: "kurta set" }).ids, []);

  // A caller that does not yet know the family must not inherit one.
  assertEquals(
    selectShowcaseFeedbackGuidance(rows, { organizationId: "org-1", productCategory: "kurta set" }).ids,
    [],
  );
});

Deno.test("a QA-only refusal is reported as negative, not as zero", () => {
  const guidance = selectShowcaseFeedbackGuidance(
    [{ id: "a", organization_id: "org-1", product_category: "saree", garment_family: "saree", feature_region: "pallu", shot_type: "macro_detail", qa_failed_count: 3 }],
    { organizationId: "org-1", productCategory: "saree", garmentFamily: "saree" },
  ).guidance;
  assertStringIncludes(guidance, "reworked or rejected 3 time(s)");
  assertEquals(guidance.includes("0 time(s)"), false);
});

Deno.test("a broad category yields no family, a specific one resolves it", () => {
  assertEquals(coarseGarmentFamilyForCategory("ethnic/fusion"), "");
  assertEquals(coarseGarmentFamilyForCategory("saree"), "saree");
  assertEquals(coarseGarmentFamilyForCategory("kurta set"), "kurta_or_kurti_set");
  assertEquals(coarseGarmentFamilyForCategory("dress"), "dress");
});

Deno.test("outcome counts move independently and average quality only on keeps", () => {
  const first = nextShowcaseOutcomeCounts(null, "selected", 92);
  assertEquals(first.selectedCount, 1);
  assertEquals(first.avgQuality, 92);

  const second = nextShowcaseOutcomeCounts(
    { selected_count: 1, avg_quality: 92 },
    "selected",
    96,
  );
  assertEquals(second.selectedCount, 2);
  assertEquals(second.avgQuality, 94);

  // A rejection or regeneration must not move the quality average.
  const rejected = nextShowcaseOutcomeCounts({ selected_count: 2, avg_quality: 94 }, "rejected", 10);
  assertEquals(rejected.rejectedCount, 1);
  assertEquals(rejected.selectedCount, 2);
  assertEquals(rejected.avgQuality, 94);

  const regenerated = nextShowcaseOutcomeCounts({ regenerated_count: 3 }, "regenerated");
  assertEquals(regenerated.regeneratedCount, 4);

  const qaFailed = nextShowcaseOutcomeCounts({}, "qa_failed");
  assertEquals(qaFailed.qaFailedCount, 1);
});

Deno.test("the outcome write is compare-and-set against the row it read", () => {
  const insert = planShowcaseOutcomeWrite([], "selected", 90);
  assertEquals(insert.action, "insert");

  const update = planShowcaseOutcomeWrite(
    [
      { id: "newer", created_at: "2026-02-01T00:00:00Z", selected_count: 1 },
      { id: "older", created_at: "2026-01-01T00:00:00Z", selected_count: 4, rejected_count: 1 },
    ],
    "rejected",
  );
  assertEquals(update.action, "update");
  if (update.action !== "update") throw new Error("expected an update");
  // The oldest duplicate is the canonical row, matching the prompt-pattern writer.
  assertEquals(update.id, "older");
  assertEquals(update.expected.selectedCount, 4);
  assertEquals(update.expected.rejectedCount, 1);
  assertEquals(update.next.rejectedCount, 2);
});

Deno.test("Pose 6 weaves concrete garment details, aesthetic photoshoot direction, and collision-widened framing through normalizeAnalysis", () => {
  const normalized = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "emerald green",
      fabric: "organza silk",
      embroidery: "gold zari gota patti",
      bottomWearDetails: "Farshi pajama with 6-inch joined hem",
    },
    creativeDirection: {
      closeupMode: "product_detail",
      closeupHeroDetail: "sequinned square neckline yoke",
      showcasePlan: {
        heroFeature: "sequinned square neckline yoke",
        featureRegion: "yoke",
        shotType: "macro_detail",
        framing: "Tight macro crop on the yoke",
        cameraAngle: "Macro straight-on",
        bodyPosition: "Chest crop only",
      },
    },
    posePlan: [
      {
        id: "showcase",
        title: "Custom Yoke Showcase",
        framing: "Tight macro crop on the yoke",
        cameraAngle: "Macro straight-on",
        bodyPosition: "Chest crop only",
        prompt: "Tight macro shot of yoke.",
      },
    ],
  }, "kurta set");

  // Synonym "yoke" normalizes to "neckline"
  assertEquals(normalized.creativeDirection.showcasePlan?.featureRegion, "neckline");
  const showcase = normalized.posePlan[5];
  assertEquals(showcase.id, "showcase");
  // Colliding macro crop is widened even when candidate posePlan[5] had tight framing
  assertEquals(showcase.framing.includes("Tight macro crop"), false);
  assertStringIncludes(showcase.framing, "Frame head-to-toe");
  // Concrete garment specs and aesthetic photoshoot direction are woven in
  assertStringIncludes(showcase.prompt, "emerald green organza silk");
  assertStringIncludes(showcase.prompt, "gold zari gota patti");
  assertStringIncludes(showcase.prompt, "Editorial full-length fashion photoshoot aesthetics");
  assert(showcase.productVisibilityRules.some((rule) => rule.includes("emerald green organza silk")));
});

Deno.test("top_only mode suppresses a bottom_wear showcasePlan and falls back to top-only showcase framing", () => {
  const slots = getPoseSlots({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "ivory",
      fabric: "chanderi",
      bottomWearDetails: "Palazzo, wide flare",
    },
    showcasePlan: bottomPlan,
    bottomWearMode: "top_only",
  });
  assertEquals(slots[5].title.includes("palazzo"), false);
  assertStringIncludes(slots[5].title, "Full-Length Silhouette Showcase");
  assertEquals(/established in Pose 1|same as full_front|consistent with previous poses/i.test(slots[5].prompt), false);
});

Deno.test("normalizeAnalysis top_only removes model-supplied bottom showcase prose", () => {
  const normalized = normalizeAnalysis({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "ivory",
      fabric: "chanderi",
      bottomWearDetails: "Palazzo, wide flare",
    },
    showcasePlan: bottomPlan,
    posePlan: [{
      id: "showcase",
      title: "Palazzo flare hero",
      description: "Show the palazzo hem and wide flare",
      cameraAngle: "Low angle on the palazzo",
      framing: "Head-to-toe palazzo frame",
      bodyPosition: "Turn to open the palazzo legs",
      handPlacement: "Hands beside the palazzo",
      expression: "Calm",
      highlightedDetails: ["palazzo flare"],
      productVisibilityRules: ["palazzo border stays visible"],
      primaryReference: "bottom",
      purpose: "Sell the palazzo",
      consistencyNotes: "Keep the palazzo consistent",
      prompt: "Generate a full-body palazzo showcase.",
    }],
  }, "kurta set", { bottomWearMode: "top_only" });

  const showcase = normalized.posePlan[5];
  assertEquals(showcase.title, "Full-Length Silhouette Showcase");
  assertEquals(showcase.primaryReference, "front");
  assertEquals(JSON.stringify(showcase).toLowerCase().includes("palazzo"), false);
  assertEquals(normalized.creativeDirection.showcasePlan, null);
});

Deno.test("CodeAnt Major: prompt-time defense removes rejected top-only showcase metadata from legacy sessions", () => {
  for (const [key, featureRegion] of [["showcasePlan", "bottom_wear"], ["showcase_plan", "complete_set"]] as const) {
    const prompt = composeGenerationPrompt({
      skuName: "TOP-ONLY-LEGACY",
      productDetails: "Standalone ankle-length kurti",
      pose: pose("showcase", 6) as never,
      session: {
        productIdentity: {
          garmentFamily: "kurta_or_kurti_set",
          length: "ankle-length",
          bottomWearDetails: "none - standalone garment",
        },
        creativeDirection: { [key]: { ...bottomPlan, featureRegion } },
        bottomWearMode: "top_only",
      },
      references: [{ role: "front" }],
    });

    assertEquals(prompt.includes(bottomPlan.heroFeature), false);
    assertEquals(prompt.includes(`"${key}"`), false);
    assertStringIncludes(prompt, '"showcaseIntent":"full_length_silhouette"');
  }
});

Deno.test("Pose 6 garment summary preserves bottom specifications within five parts", () => {
  const slots = getPoseSlots({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "emerald green",
      fabric: "organza silk",
      embroidery: "gold zari yoke",
      pattern: "woven butti repeat",
      neckline: "square neckline",
      sleeveType: "full sleeves",
      silhouette: "straight kurta",
      bottomWearDetails: "Farshi pajama with 6-inch joined hem",
    },
    showcasePlan: {
      heroFeature: "gold zari yoke",
      featureRegion: "embroidery",
      shotType: "macro_detail",
    },
  });

  const showcase = slots[5];
  assertStringIncludes(showcase.prompt, "bottom wear: Farshi pajama with 6-inch joined hem");
  const specificationRule = showcase.productVisibilityRules.find((rule) =>
    rule.startsWith("preserve exact garment specifications: ")
  );
  assert(specificationRule);
  const summary = specificationRule.replace("preserve exact garment specifications: ", "");
  assertStringIncludes(summary, "bottom wear: Farshi pajama");
  assertEquals(summary.split("; ").length <= 5, true);
});
