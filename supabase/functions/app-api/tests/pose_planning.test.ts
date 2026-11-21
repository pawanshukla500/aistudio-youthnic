import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  isReferenceLowPostureSlot,
  isStyleReferenceProfile,
  localPosePlanningDecision,
  MAX_REFERENCE_DIRECTIVE,
  mergeGraphPosePlanning,
  normalizeExpressionPlan,
  normalizePosePlanning,
  normalizeReferencePose,
  normalizeReferencePosture,
  plannedPoseExpression,
  type PosePlanningContext,
  posePlanningGraphPayload,
  referenceAdoptionBlockReason,
  type ReferencePose,
  slotReferencePlan,
  storedPosePlanning,
  styleReferenceProfileFromAnalysis,
} from "../lib/posePlanning.ts";
import {
  buildCombinedAnalysisPrompt,
  getPoseSlots,
  normalizeAnalysis,
  posePlanningContextFor,
  sanitizeHeldObjectText,
  type JsonRecord,
} from "../lib/profiles.ts";

const seated: ReferencePose = normalizeReferencePose({
  posture: "seated",
  description: "Seated on a low stool, torso turned slightly, one knee raised, head tilted",
  seatOrSupport: "low wooden stool",
  distinctiveness: "signature",
  signatureDescription: "one knee raised with the forearm resting on it",
  attitude: "Quiet, self-assured",
  suitableForProduct: "yes",
  suitabilityReason: "front design stays readable",
});

// Stored plans and cached analyses travel through jsonb, which drops undefined keys.
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const ctx = (overrides: Partial<PosePlanningContext> = {}): PosePlanningContext => ({
  poseFamily: "long_kurti",
  bottomCutClass: "none",
  showcaseFeatureRegion: "embroidery",
  showcaseShotType: "full_body_feature",
  ...overrides,
});

Deno.test("reference posture synonyms, empty signatures and suitability normalize", () => {
  assertEquals(normalizeReferencePosture("Sitting cross-legged on the floor"), "seated");
  assertEquals(normalizeReferencePosture("kneels on one knee"), "kneeling");
  assertEquals(normalizeReferencePosture("squatting low"), "crouching");
  assertEquals(normalizeReferencePosture("lying on her side"), "reclining");
  assertEquals(normalizeReferencePosture("leans against the doorway"), "leaning");
  assertEquals(normalizeReferencePosture("mid-stride walk"), "walking");
  assertEquals(normalizeReferencePosture("stands tall"), "standing");
  assertEquals(normalizeReferencePosture("twirl"), "other");
  assertEquals(normalizeReferencePosture(""), "none");
  assertEquals(normalizeReferencePosture("no person"), "none");

  const unwritten = normalizeReferencePose({ posture: "seated", distinctiveness: "signature", suitableForProduct: "true" });
  assertEquals(unwritten.distinctiveness, "generic");
  assertEquals(unwritten.signatureDescription, "");
  assertEquals(unwritten.suitableForProduct, "yes");
  assertEquals(normalizeReferencePose({ posture: "leaning", suitableForProduct: "false" }).suitableForProduct, "no");
  assertEquals(normalizeReferencePose({ posture: "leaning", suitableForProduct: "maybe" }).suitableForProduct, "unknown");
  assertEquals(normalizeReferencePose({ posture: "none", description: "empty room" }).description, "");
  assertEquals(normalizeReferencePose({ posture: "seated", seatOrSupport: "none" }).seatOrSupport, "");

  const scrubbed = normalizeReferencePose(
    { posture: "seated", description: "Seated on a bench. Holding an iced coffee cup." },
    (value) => sanitizeHeldObjectText(value, ""),
  );
  assertEquals(scrubbed.description, "Seated on a bench.");
  assertEquals(normalizeExpressionPlan({ energy: "Playful", smile: "grin" }).smile, "soft");
  assertEquals(normalizeExpressionPlan({ energy: "Playful" }).energy, "playful");
});

Deno.test("every hard guard keeps the slot product-led", () => {
  const none = normalizeReferencePose({ posture: "none" });
  assertStringIncludes(referenceAdoptionBlockReason("creative", none, ctx()), "no person");
  const standing = normalizeReferencePose({ posture: "standing", suitableForProduct: "yes" });
  assertStringIncludes(referenceAdoptionBlockReason("creative", standing, ctx()), "generic standing");
  const signatureStanding = normalizeReferencePose({
    posture: "standing",
    distinctiveness: "signature",
    signatureDescription: "crossed ankles with one hand on the doorframe",
    suitableForProduct: "yes",
  });
  assertEquals(referenceAdoptionBlockReason("creative", signatureStanding, ctx()), "");
  const unsuitable = { ...seated, suitableForProduct: "no" as const, suitabilityReason: "hides the hem" };
  assertStringIncludes(referenceAdoptionBlockReason("creative", unsuitable, ctx()), "hides the hem");
  // Only an explicit "yes" adopts; a missing verdict stays product-led.
  const unjudged = { ...seated, suitableForProduct: "unknown" as const };
  assertStringIncludes(referenceAdoptionBlockReason("creative", unjudged, ctx()), "did not confirm");

  // A walking reference, or a stride / lifted foot in any posture, is never copied.
  const walking = normalizeReferencePose({ posture: "walking", description: "Walking toward camera", suitableForProduct: "yes" });
  assertStringIncludes(referenceAdoptionBlockReason("creative", walking, ctx()), "walking stride");
  const liftedHeel = { ...seated, posture: "leaning" as const, description: "Leaning on the pillar, back heel lifted" };
  assertStringIncludes(referenceAdoptionBlockReason("showcase", liftedHeel, ctx()), "lifted foot");
  const midStride = { ...seated, posture: "other" as const, description: "Turning mid-stride toward the window" };
  assertStringIncludes(referenceAdoptionBlockReason("creative", midStride, ctx()), "walking stride");
  // A non-walking posture described as walking is blocked too; "walkway" is not a walk.
  for (const description of ["Leaning as she walks past the pillar", "Leaning out of a WALK", "Leaning mid-walking turn"]) {
    const walkingLean = { ...seated, posture: "leaning" as const, description };
    assertStringIncludes(referenceAdoptionBlockReason("creative", walkingLean, ctx()), "walking stride", description);
  }
  const walkingSignature = { ...seated, distinctiveness: "signature" as const, signatureDescription: "turned as if walking past" };
  assertStringIncludes(referenceAdoptionBlockReason("showcase", walkingSignature, ctx()), "walking stride");
  assertEquals(referenceAdoptionBlockReason("creative", { ...seated, description: "Seated by the walkway" }, ctx()), "");

  assertStringIncludes(referenceAdoptionBlockReason("creative", seated, ctx({ bottomCutClass: "farshi" })), "Farshi");
  const leaning = normalizeReferencePose({ posture: "leaning", suitableForProduct: "yes" });
  assertEquals(referenceAdoptionBlockReason("creative", leaning, ctx({ bottomCutClass: "farshi" })), "");

  // An explicit sit request keeps a non-seated reference out of Pose 4; a seated Pose 4 and Pose 6 still adopt.
  const sit = ctx({ sitRequested: true });
  assertStringIncludes(referenceAdoptionBlockReason("creative", leaning, sit), "notes ask Pose 4 to sit");
  assertEquals(referenceAdoptionBlockReason("creative", seated, sit), "");
  assertEquals(referenceAdoptionBlockReason("showcase", leaning, sit), "");

  const reclining = { ...seated, posture: "reclining" as const };
  assertStringIncludes(referenceAdoptionBlockReason("creative", reclining, ctx({ poseFamily: "saree_ethnic" })), "saree");
  assertEquals(referenceAdoptionBlockReason("creative", seated, ctx({ poseFamily: "saree_bengali" })), "");

  const macro = ctx({ showcaseShotType: "macro_detail" });
  assertStringIncludes(referenceAdoptionBlockReason("showcase", leaning, macro), "tight detail crop");
  assertEquals(referenceAdoptionBlockReason("creative", seated, macro), "");
  assertStringIncludes(referenceAdoptionBlockReason("showcase", seated, ctx({ showcaseFeatureRegion: "bottom_wear" })), "full-length");
  assertEquals(referenceAdoptionBlockReason("showcase", leaning, ctx({ showcaseFeatureRegion: "bottom_wear" })), "");
  assertStringIncludes(referenceAdoptionBlockReason("showcase", seated, ctx({ showcaseShotType: "movement_feature" })), "movement");
});

Deno.test("the local decision adopts only guard-clear slots", () => {
  const plan = localPosePlanningDecision(seated, normalizeExpressionPlan({}), ctx({ showcaseFeatureRegion: "hem_border" }));
  assertEquals(plan.slots.creative.source, "reference");
  assertEquals(plan.slots.creative.posture, "seated");
  assertStringIncludes(plan.slots.creative.directive, "low wooden stool");
  assertStringIncludes(plan.slots.creative.directive, "one knee raised with the forearm resting on it");
  assertEquals(plan.slots.showcase.source, "product");
  assertEquals(plan.planner, "local");
  assertEquals(plan.planKey, "long_kurti|none");
});

Deno.test("normalizePosePlanning is idempotent and re-checks stored adoptions", () => {
  const first = roundTrip(normalizePosePlanning({ referencePose: seated, expressionPlan: { energy: "warm" } }, ctx()));
  assertEquals(roundTrip(normalizePosePlanning(first, ctx())), first);
  assertEquals(first.slots.showcase.source, "reference");
  assertStringIncludes(first.slots.showcase.directive, "different camera angle and framing from Pose 4");

  // A stored or graph adoption that now violates a guard falls back to product.
  const farshi = roundTrip(normalizePosePlanning(first, ctx({ bottomCutClass: "farshi" })));
  assertEquals(farshi.slots.creative.source, "product");
  assertStringIncludes(farshi.slots.creative.rationale, "Farshi");
  assertEquals(roundTrip(normalizePosePlanning(farshi, ctx({ bottomCutClass: "farshi" }))), farshi);
});

Deno.test("maximum-length reference text keeps the directive within the stored cap", () => {
  const longest = normalizeReferencePose({
    ...seated,
    description: `Seated sideways on the bench, ${"torso turned three-quarters with the spine long and the chin lifted, ".repeat(8)}`,
    signatureDescription: `One knee drawn up, ${"the forearm draped loosely over it on a relaxed diagonal line, ".repeat(8)}`,
    seatOrSupport: `low carved wooden bench ${"in the corner of the room ".repeat(6)}`,
  });
  assertEquals([longest.description.length, longest.signatureDescription.length, longest.seatOrSupport.length], [420, 420, 120]);
  const first = roundTrip(normalizePosePlanning({ referencePose: longest }, ctx()));
  for (const slot of [first.slots.creative, first.slots.showcase]) {
    assertEquals(slot.source, "reference");
    assert(slot.directive.length <= MAX_REFERENCE_DIRECTIVE);
    assert(slot.directive.endsWith("never the reference clothing, face, hair or anything in the hands (jewellery follows the styling plan). Keep the uploaded garment's front design, hem and construction readable."));
    assertStringIncludes(slot.directive, `Rest on the ${longest.seatOrSupport}, which must already belong to the locked set.`);
  }
  assertStringIncludes(first.slots.showcase.directive, "different camera angle and framing from Pose 4");
  assertEquals(roundTrip(normalizePosePlanning(first, ctx())), first);
  assertEquals(storedPosePlanning({ posePlanning: first })?.slots, first.slots);
});

Deno.test("mergeGraphPosePlanning ignores malformed responses and re-checks guards", () => {
  const local = localPosePlanningDecision(seated, normalizeExpressionPlan({}), ctx());
  assertEquals(mergeGraphPosePlanning(local, null, ctx()), local);
  assertEquals(mergeGraphPosePlanning(local, "not json", ctx()), local);
  assertEquals(mergeGraphPosePlanning(local, { slots: [] }, ctx()), local);

  const merged = mergeGraphPosePlanning(local, {
    slots: { creative: { source: "product", rationale: "learned penalty" }, showcase: { source: "reference" } },
    expressions: { full_front: "Calm, direct gaze", creative: "" },
    thread_id: "thread_plan_org_abc",
    learned_signals: [{ slot: "creative", outcome_key: "k", effect: "penalty" }, { slot: "closeup", effect: "boost" }],
  }, ctx({ showcaseShotType: "macro_detail" }));
  assertEquals(merged.planner, "langgraph");
  assertEquals(merged.slots.creative, { source: "product", posture: "standing", directive: "", rationale: "learned penalty" });
  assertEquals(merged.slots.showcase.source, "product");
  assertEquals(merged.expressions, { full_front: "Calm, direct gaze" });
  assertEquals(merged.threadId, "thread_plan_org_abc");
  assertEquals(merged.learnedSignals, [{ slot: "creative", outcomeKey: "k", effect: "penalty" }]);
});

Deno.test("stored planning drives slot gating; legacy sessions have none", () => {
  const planning = normalizePosePlanning({ referencePose: seated, expressions: { creative: "Soft smile" }, slots: {
    creative: { source: "reference" },
    showcase: { source: "product", rationale: "tight crop" },
  } }, ctx());
  const session = { posePlanning: planning };
  assertEquals(slotReferencePlan(session, "creative")?.posture, "seated");
  assertEquals(slotReferencePlan(session, "showcase"), null);
  assertEquals(slotReferencePlan(session, "full_front"), null);
  assertEquals(isReferenceLowPostureSlot(session, "creative"), true);
  assertEquals(isReferenceLowPostureSlot(session, "closeup"), false);
  assertEquals(plannedPoseExpression(session, "creative"), "Soft smile");
  assertEquals(storedPosePlanning({}), null);
  assertEquals(storedPosePlanning({ posePlanning: { ...planning, version: 2 } }), null);
  assertEquals(slotReferencePlan({}, "creative"), null);
});

Deno.test("style reference profile keeps room fields and the reference pose only", () => {
  const profile = styleReferenceProfileFromAnalysis({
    creativeDirection: {
      backgroundStyle: "Lime-washed terracotta wall",
      lighting: "Soft window light from camera left",
      seatedPoseRequired: "yes",
      showcasePlan: { heroFeature: "yoke" },
      mood: "Not visible in the supplied references",
      // Planned per product, never cached with the room.
      framing: "Knees-up crop",
      composition: "Model off-centre on the bench",
      propUsage: "Carved wooden bench",
    },
    stylingPlan: { themeInterpretation: "Sunlit artisanal calm", jewellery: "Oxidised silver jhumkas" },
    posePlanning: { referencePose: seated },
  });
  assert(profile);
  assertEquals(profile.creativeDirection, {
    backgroundStyle: "Lime-washed terracotta wall",
    lighting: "Soft window light from camera left",
  });
  assertEquals(profile.referencePose.posture, "seated");
  assertStringIncludes(profile.stylingTaste, "Oxidised silver jhumkas");
  assertEquals(isStyleReferenceProfile(profile), true);
  assertEquals(isStyleReferenceProfile({ ...profile, version: 2 }), false);
  assertEquals(isStyleReferenceProfile({ ...profile, creativeDirection: {} }), false);
  assertEquals(styleReferenceProfileFromAnalysis({ creativeDirection: {} }), null);
});

const promptArgs = {
  skuName: "LONG-KURTI-01",
  productDetails: "Ivory chikankari long kurti",
  category: "kurti",
  modelDirection: "",
  sceneDirection: "",
  referenceManifest: [{ number: 1, role: "FRONT PRODUCT" }, { number: 2, role: "STYLE REFERENCE" }],
};

Deno.test("analysis prompt asks for referencePose, expressionPlan and the frame 4/6 rule", () => {
  const prompt = buildCombinedAnalysisPrompt(promptArgs);
  assertStringIncludes(prompt, '"referencePose":{"posture":"standing|seated|leaning|kneeling|crouching|reclining|walking|other|none"');
  assertStringIncludes(prompt, '"expressionPlan":{"attitude":"...","energy":"serene|calm|warm|playful|confident|dramatic"');
  assertStringIncludes(prompt, "POSE 4 AND POSE 6 MATCH THE REFERENCE POSTURE");
  assertStringIncludes(prompt, "Poses 1, 2, 3, and 5 never copy the reference posture");
  assertStringIncludes(prompt, "never the clothing, face, hair, jewellery, or anything in the hands");
  assertStringIncludes(prompt, "Every pose's expression follows expressionPlan");
  assertEquals(prompt.includes("CACHED STYLE PROFILE"), false);
});

Deno.test("a cached style profile replaces the style image and nothing else", () => {
  const without = buildCombinedAnalysisPrompt(promptArgs);
  const withProfile = buildCombinedAnalysisPrompt({
    ...promptArgs,
    cachedStyleProfile: {
      version: 1,
      creativeDirection: { backgroundStyle: "Lime-washed terracotta wall" },
      referencePose: seated,
      stylingTaste: "Theme: sunlit calm.",
    },
  });
  assertStringIncludes(withProfile, "the STYLE REFERENCE image is NOT attached");
  assertStringIncludes(withProfile, "Lime-washed terracotta wall");
  assertStringIncludes(withProfile, "copy its referencePose fields verbatim");
  assertStringIncludes(withProfile, "plan framing, composition and propUsage fresh for THIS product");
  assertStringIncludes(withProfile, "one knee raised with the forearm resting on it");
  assertEquals(withProfile.includes("front design stays readable"), false);
  assertEquals(withProfile.replace(/\nCACHED STYLE PROFILE[\s\S]*?\n(?=\nREFERENCE AUTHORITY)/, ""), without);
});

const sareeRaw = (referencePose?: unknown): JsonRecord => ({
  productIdentity: { garmentFamily: "saree", category: "saree", mainColor: "Bottle green", fabric: "silk" },
  ...(referencePose ? { referencePose, expressionPlan: { attitude: "Serene poise", energy: "serene", smile: "soft" } } : {}),
  posePlan: [
    { id: "full_front", expression: "Calm glance" },
    { id: "creative", bodyPosition: "Standing contrapposto", prompt: "Create a closer editorial portrait." },
  ],
});

Deno.test("a suitable seated reference is adopted for Pose 4 and Pose 6", () => {
  const normalized = normalizeAnalysis(sareeRaw(seated), "saree");
  assertEquals(normalized.posePlanning!.slots.creative.source, "reference");
  assertEquals(normalized.posePlanning!.slots.showcase.source, "reference");
  const [front, , , creative, , showcase] = normalized.posePlan;
  assertStringIncludes(creative.bodyPosition, "seated posture");
  assertStringIncludes(creative.prompt, "Create a closer editorial portrait.");
  assertStringIncludes(creative.prompt, normalized.posePlanning!.slots.creative.directive);
  assertEquals(/never copy style-reference sitting|Sit only/i.test(JSON.stringify(creative)), false);
  assertEquals(creative.referencePosture, "seated");
  assertStringIncludes(showcase.bodyPosition, "complementary variation");
  assert(showcase.productVisibilityRules.some((rule) => rule.includes("pallu artwork")));
  assertEquals(showcase.referencePosture, "seated");
  assertEquals(front.referencePosture, undefined);
  assertEquals(front.bodyPosition.includes("seated"), false);
  assertEquals(front.attitude, "Serene poise");

  // Cached payloads are re-normalized: the second pass must not drift.
  const again = roundTrip(normalizeAnalysis(roundTrip(normalized) as unknown as JsonRecord, "saree"));
  assertEquals(again.posePlanning, roundTrip(normalized.posePlanning));
  assertEquals(again.posePlan, roundTrip(normalized.posePlan));
});

Deno.test("Farshi SKUs and bottom-reference Farshi keep Pose 4 product-led", () => {
  const raw: JsonRecord = {
    productIdentity: { garmentFamily: "kurta_or_kurti_set", category: "kurta set", bottomWearDetails: "Farshi salwar, joined 6-inch hem" },
    referencePose: seated,
  };
  const farshi = normalizeAnalysis(raw, "kurta set", { skuName: "Farshi set" });
  assertEquals(farshi.posePlanning!.slots.creative.source, "product");
  assertStringIncludes(farshi.posePlanning!.slots.creative.rationale, "Farshi");
  assertEquals(farshi.posePlan[3].referencePosture, undefined);
  assertStringIncludes(farshi.posePlan[3].bodyPosition, "Sit only when the product notes demand sitting");

  // A dedicated bottom photo with an unclassified cut is generated as Farshi (compilePosePrompt).
  const unknownCut: JsonRecord = { ...raw, productIdentity: { garmentFamily: "kurta_or_kurti_set" } };
  assertEquals(normalizeAnalysis(unknownCut, "kurta set", { hasBottomReference: true }).posePlanning!.slots.creative.source, "product");
  assertEquals(
    posePlanningContextFor({ productIdentity: unknownCut.productIdentity }, { hasBottomReference: true }).bottomCutClass,
    "farshi",
  );
});

Deno.test("legacy analyses without referencePose keep today's pose plan", () => {
  const legacy = normalizeAnalysis(sareeRaw(), "saree");
  assertEquals(legacy.posePlanning, undefined);
  assertEquals(legacy.posePlan.some((pose) => "attitude" in pose), false);
  const context = {
    productIdentity: legacy.productIdentity,
    garmentFamily: legacy.productIdentity.garmentFamily,
    category: legacy.productIdentity.category,
  };
  const template = getPoseSlots(context);
  assertEquals(getPoseSlots({ ...context, posePlanning: undefined }), template);
  const creative = legacy.posePlan[3];
  assertEquals(creative.bodyPosition, "Standing contrapposto");
  assertEquals(creative.prompt, "Create a closer editorial portrait.");
  assertEquals(creative.framing, template[3].framing);
  assertEquals(creative.productVisibilityRules, template[3].productVisibilityRules);
  assertEquals(creative.expression, template[3].expression);
  assertEquals(creative.referencePosture, undefined);
  const showcase = legacy.posePlan[5];
  assertEquals(showcase.bodyPosition, template[5].bodyPosition);
  assertEquals(showcase.framing, template[5].framing);
  assertEquals(showcase.prompt, template[5].prompt);
  assertEquals(legacy.posePlan[0].expression, "Calm glance");
  const again = roundTrip(normalizeAnalysis(roundTrip(legacy) as unknown as JsonRecord, "saree"));
  assertEquals(again.posePlan, roundTrip(legacy.posePlan));
  assertEquals(again.posePlanning, undefined);
});

Deno.test("planner expressions and a graph override apply to the pose plan", () => {
  const normalized = normalizeAnalysis(sareeRaw(seated), "saree", {
    posePlanningOverride: {
      slots: { creative: { source: "reference" }, showcase: { source: "product", rationale: "learned penalty" } },
      expressions: { full_front: "Soft direct gaze, closed-lip smile", creative: "Dreamy glance off camera" },
      thread_id: "thread_plan_org_1",
    },
  });
  assertEquals(normalized.posePlanning!.planner, "langgraph");
  assertEquals(normalized.posePlan[0].expression, "Soft direct gaze, closed-lip smile");
  assertEquals(normalized.posePlan[3].expression, "Dreamy glance off camera");
  assertEquals(normalized.posePlan[5].referencePosture, undefined);
  assertEquals(normalized.posePlan[5].bodyPosition.includes("complementary variation"), false);
  const again = roundTrip(normalizeAnalysis(roundTrip(normalized) as unknown as JsonRecord, "saree"));
  assertEquals(again.posePlanning, roundTrip(normalized.posePlanning));
  assertEquals(again.posePlan, roundTrip(normalized.posePlan));
});

Deno.test("posePlanningContextFor reads the sit request and close-up mode, and the planner payload carries both", () => {
  const productIdentity = { garmentFamily: "kurti", category: "kurti" };
  const plain = posePlanningContextFor({ productIdentity });
  assertEquals([plain.sitRequested, plain.closeupMode], [false, "face_and_detail"]);
  assertEquals(posePlanningContextFor({ productIdentity }, { productDetails: "Pose 4 sitting on the bench" }).sitRequested, true);
  const recorded = posePlanningContextFor({
    productIdentity,
    creativeDirection: { seatedPoseRequired: "yes", seatedPoseReason: "Buyer requested a seated pose", closeupMode: "detail only" },
  });
  assertEquals([recorded.sitRequested, recorded.closeupMode], [true, "product_detail"]);
  // A described style photo is the room, not a request.
  const described = { seatedPoseRequired: "yes", seatedPoseReason: "The model sits on stone steps in the style photo" };
  assertEquals(posePlanningContextFor({ productIdentity, creativeDirection: described }).sitRequested, false);
  const payload = posePlanningGraphPayload({
    organizationId: "org_1", threadKey: "fp1", ctx: recorded, garmentFamily: "kurti", category: "kurti",
    local: localPosePlanningDecision(seated, normalizeExpressionPlan({}), recorded), poseExpressions: {},
  });
  assertEquals([payload.sit_requested, payload.closeup_mode], [true, "product_detail"]);
});

const leaningRaw = (posePlan: JsonRecord[]): JsonRecord => ({
  productIdentity: { garmentFamily: "kurta_or_kurti_set", length: "knee length", bottomWearDetails: "none - standalone garment" },
  referencePose: { ...seated, posture: "leaning", seatOrSupport: "", description: "Shoulder leaning on the carved pillar" },
  expressionPlan: { energy: "calm" },
  showcasePlan: {
    heroFeature: "mirror-work yoke running into the side panels",
    featureRegion: "embroidery",
    shotType: "full_body_feature",
    bodyPosition: "Standing mid-turn",
  },
  posePlan,
});

Deno.test("an explicit sit request keeps a leaning reference out of Pose 4 and drops its posture prose", () => {
  const options = { productDetails: "Ivory kurti; Pose 4 sitting on the bench" };
  const raw = leaningRaw([
    ...["full_front", "angled", "back"].map((id) => ({ id })),
    {
      id: "creative",
      title: "Pillar Lean",
      bodyPosition: "Leaning on the carved pillar like the style reference",
      description: "A relaxed lean against the pillar.",
      framing: "Knees-up crop",
      prompt: "Create a knees-up frame in soft window light.",
    },
  ]);
  const normalized = normalizeAnalysis(raw, "kurti", options);
  const template = normalizeAnalysis(leaningRaw([]), "kurti", options).posePlan[3];
  assertEquals(normalized.posePlanning!.slots.creative.source, "product");
  assertStringIncludes(normalized.posePlanning!.slots.creative.rationale, "notes ask Pose 4 to sit");
  assertEquals(normalized.posePlanning!.slots.showcase.source, "reference");
  const creative = normalized.posePlan[3];
  assertEquals(
    [creative.title, creative.bodyPosition, creative.description],
    [template.title, template.bodyPosition, template.description],
  );
  // Prose without a reference posture is the model's own and stays.
  assertEquals([creative.framing, creative.prompt], ["Knees-up crop", "Create a knees-up frame in soft window light."]);
  assertEquals(creative.referencePosture, undefined);
  const again = roundTrip(normalizeAnalysis(roundTrip(normalized) as unknown as JsonRecord, "kurti", options));
  assertEquals(again.posePlan, roundTrip(normalized.posePlan));
});

Deno.test("a product-led Pose 4/6 falls back to its template wherever the model wrote the reference posture", () => {
  const override = { slots: { creative: { source: "product", rationale: "learned penalty" }, showcase: { source: "product" } } };
  const options = { posePlanningOverride: override };
  const raw = leaningRaw([
    ...["full_front", "angled", "back"].map((id) => ({ id })),
    { id: "creative", bodyPosition: "Perched on the stool", framing: "Framed to match the style reference stance" },
    { id: "closeup" },
    { id: "showcase", bodyPosition: "Kneeling beside the bench", prompt: "Create a seated three-quarter frame that sells the yoke." },
  ]);
  const normalized = normalizeAnalysis(raw, "kurti", options);
  const template = normalizeAnalysis(leaningRaw([]), "kurti", options).posePlan;
  assertEquals(normalized.posePlanning!.slots.showcase.source, "product");
  const [creative, showcase] = [normalized.posePlan[3], normalized.posePlan[5]];
  assertEquals([creative.bodyPosition, creative.framing], [template[3].bodyPosition, template[3].framing]);
  // After the showcase merge (the model prompt omitted the hero, so the plan brief was appended).
  assertEquals([showcase.bodyPosition, showcase.prompt], ["Standing mid-turn", template[5].prompt]);
  const again = roundTrip(normalizeAnalysis(roundTrip(normalized) as unknown as JsonRecord, "kurti", options));
  assertEquals(again.posePlan, roundTrip(normalized.posePlan));

  // Legacy analyses (no posePlanning) keep the model's prose exactly.
  const { referencePose: _pose, expressionPlan: _plan, ...legacyRaw } = raw;
  const legacy = normalizeAnalysis(legacyRaw, "kurti");
  assertEquals(legacy.posePlanning, undefined);
  assertEquals(legacy.posePlan[3].bodyPosition, "Perched on the stool");
  assertEquals(legacy.posePlan[5].bodyPosition, "Kneeling beside the bench");
});

Deno.test("a showcase plan keeps its hero framing when Pose 6 adopts the posture", () => {
  const raw: JsonRecord = {
    productIdentity: { garmentFamily: "kurta_or_kurti_set", length: "knee length", bottomWearDetails: "none - standalone garment" },
    referencePose: { ...seated, posture: "leaning", seatOrSupport: "" },
    showcasePlan: {
      heroFeature: "mirror-work yoke running into the side panels",
      featureRegion: "embroidery",
      shotType: "full_body_feature",
      bodyPosition: "Standing mid-turn",
    },
  };
  // Without a model-written Pose 6 prompt, and with one that omits the hero (the plan brief is appended).
  const modelPoses = [
    ...["full_front", "angled", "back", "creative", "closeup"].map((id) => ({ id })),
    { id: "showcase", prompt: "Create a three-quarter frame that sells the yoke mirror work." },
  ];
  for (const variant of [raw, { ...raw, posePlan: modelPoses }]) {
    const normalized = normalizeAnalysis(variant, "kurti");
    assertEquals(normalized.posePlanning!.slots.showcase.source, "reference");
    const showcase = normalized.posePlan[5];
    const directive = normalized.posePlanning!.slots.showcase.directive;
    assertEquals(showcase.bodyPosition, directive);
    assertStringIncludes(showcase.bodyPosition, "leaning posture");
    assertEquals(showcase.prompt.split(directive).length - 1, 1);
    // generationPrompt.ts keeps the first 1,200 pose-prompt chars: the hero brief and product lock fit.
    const kept = showcase.prompt.slice(0, 1_200);
    assertStringIncludes(kept, "mirror-work yoke running into the side panels");
    assertStringIncludes(kept, "exactly as the product references show.");
    assert(showcase.productVisibilityRules.some((rule) => rule.includes("mirror-work yoke")));
    const again = roundTrip(normalizeAnalysis(roundTrip(normalized) as unknown as JsonRecord, "kurti"));
    assertEquals(again.posePlan, roundTrip(normalized.posePlan));
  }
});
