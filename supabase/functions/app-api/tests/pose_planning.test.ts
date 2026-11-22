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
  withoutHeldObjects,
} from "../lib/posePlanning.ts";
import {
  buildCombinedAnalysisPrompt,
  getPoseSlots,
  normalizeAnalysis,
  posePlanningContextFor,
  sanitizeHeldObjectText,
  type JsonRecord,
} from "../lib/profiles.ts";
import { composeGenerationPrompt } from "../lib/generationPrompt.ts";
import { buildPoseQaPrompt } from "../lib/qa.ts";
import { MAX_IMAGE_REFERENCES, roleLabel, selectReferences } from "../lib/referencePolicy.ts";

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

Deno.test("Pose 4 adopts any reference person; only the sit request and construction guards block it, and Pose 6 never adopts", () => {
  const none = normalizeReferencePose({ posture: "none" });
  assertStringIncludes(referenceAdoptionBlockReason("creative", none, ctx()), "no person");
  // A generic stance, an unsuitable verdict and an unconfirmed verdict no longer keep Pose 4 product-led.
  const standing = normalizeReferencePose({ posture: "standing", suitableForProduct: "yes" });
  assertEquals(referenceAdoptionBlockReason("creative", standing, ctx()), "");
  const unsuitable = { ...seated, suitableForProduct: "no" as const, suitabilityReason: "hides the hem" };
  assertEquals(referenceAdoptionBlockReason("creative", unsuitable, ctx()), "");
  assertEquals(referenceAdoptionBlockReason("creative", { ...seated, suitableForProduct: "unknown" as const }, ctx()), "");
  // A walk or lifted foot adopts too: the directive grounds it instead of copying the stride.
  const walking = normalizeReferencePose({ posture: "walking", description: "Walking toward camera", suitableForProduct: "yes" });
  assertEquals(referenceAdoptionBlockReason("creative", walking, ctx()), "");
  assertEquals(referenceAdoptionBlockReason("creative", { ...seated, posture: "leaning" as const, description: "Leaning, back heel lifted" }, ctx()), "");

  // Farshi folds and a reclining saree still protect product truth.
  assertStringIncludes(referenceAdoptionBlockReason("creative", seated, ctx({ bottomCutClass: "farshi" })), "Farshi");
  const leaning = normalizeReferencePose({ posture: "leaning", suitableForProduct: "yes" });
  assertEquals(referenceAdoptionBlockReason("creative", leaning, ctx({ bottomCutClass: "farshi" })), "");
  const reclining = { ...seated, posture: "reclining" as const };
  assertStringIncludes(referenceAdoptionBlockReason("creative", reclining, ctx({ poseFamily: "saree_ethnic" })), "saree");
  assertEquals(referenceAdoptionBlockReason("creative", seated, ctx({ poseFamily: "saree_bengali" })), "");

  // An explicit sit request keeps a non-seated reference out of Pose 4; a seated reference still adopts.
  const sit = ctx({ sitRequested: true });
  assertStringIncludes(referenceAdoptionBlockReason("creative", leaning, sit), "notes ask Pose 4 to sit");
  assertEquals(referenceAdoptionBlockReason("creative", seated, sit), "");

  // Pose 6 is the product-highlight close-up whatever the reference or the context.
  for (const pose of [seated, leaning, standing, walking]) {
    for (const context of [ctx(), sit, ctx({ showcaseShotType: "macro_detail" }), ctx({ showcaseFeatureRegion: "bottom_wear" })]) {
      assertStringIncludes(referenceAdoptionBlockReason("showcase", pose, context), "product-highlight close-up");
    }
  }
  assertStringIncludes(referenceAdoptionBlockReason("showcase", none, ctx()), "no person");
});

Deno.test("an adopted Pose 4 directive grounds a walk, carries the reference camera and keeps the garment exact", () => {
  // T94-Kitkat-Kattha: seated on a low bench, judged unsuitable by analysis v37.
  const t94 = normalizeReferencePose({
    posture: "seated",
    description: "seated on a low bench, legs crossed, one hand bracing on the bench, head turned sideways",
    seatOrSupport: "low reddish-brown wooden bench platform",
    distinctiveness: "generic",
    cameraAngle: "eye-level slightly low, mid-full framing",
    suitableForProduct: "no",
    suitabilityReason: "seated crossed legs folds hip hem and hides trouser silhouette and back lace-up",
  });
  const plan = localPosePlanningDecision(t94, normalizeExpressionPlan({}), ctx({ poseFamily: "short_kurti_top", bottomCutClass: "straight" }));
  assertEquals([plan.slots.creative.source, plan.slots.creative.posture, plan.slots.showcase.source], ["reference", "seated", "product"]);
  const directive = plan.slots.creative.directive;
  assertStringIncludes(directive, "Match the STYLE REFERENCE person's seated posture: seated on a low bench, legs crossed");
  assertStringIncludes(directive, "Rest on the low reddish-brown wooden bench platform, which must already belong to the locked set.");
  assertStringIncludes(directive, "Camera and framing as the STYLE REFERENCE is shot: eye-level slightly low, mid-full framing.");
  assertStringIncludes(directive, "Keep the uploaded garment's front design, print, colours and construction exactly as the product photos show; a folded posture may let the hem rest naturally but never hides the print or changes the garment.");

  const walking = localPosePlanningDecision(
    normalizeReferencePose({ posture: "walking", description: "walking toward the camera mid-stride", cameraAngle: "low angle, full length" }),
    normalizeExpressionPlan({}),
    ctx(),
  );
  assertEquals([walking.slots.creative.source, walking.slots.creative.posture], ["reference", "standing"]);
  assertStringIncludes(walking.slots.creative.rationale, "grounded weight shift");
  assertStringIncludes(walking.slots.creative.directive, "Match the STYLE REFERENCE person's direction of movement in a grounded standing pose.");
  assertStringIncludes(walking.slots.creative.directive, "both feet on the floor");
  assertStringIncludes(walking.slots.creative.directive, "Camera and framing as the STYLE REFERENCE is shot: low angle, full length.");
  assertEquals(/walk|stride|mid-step/i.test(walking.slots.creative.directive), false);
  // A lifted foot in another posture keeps the posture and grounds the foot.
  const lean = localPosePlanningDecision(
    normalizeReferencePose({ posture: "leaning", description: "leaning on the pillar, one foot lifted against it" }),
    normalizeExpressionPlan({}),
    ctx(),
  ).slots.creative;
  assertEquals([lean.source, lean.posture], ["reference", "leaning"]);
  assertStringIncludes(lean.directive, "Match the STYLE REFERENCE person's leaning posture: leaning.");
  assertEquals(/lifted/i.test(lean.directive), false);
  // A stored walking adoption reads back as the grounded standing frame.
  assertEquals(storedPosePlanning({ posePlanning: roundTrip(walking) })?.slots.creative.posture, "standing");
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
  assertEquals([first.slots.creative.source, first.slots.showcase.source], ["reference", "product"]);

  // A v37 plan that also adopted Pose 6 is re-checked: Pose 6 becomes the product highlight.
  const v37 = { ...first, slots: { ...first.slots, showcase: { source: "reference", directive: "Use a complementary variation." } } };
  const rechecked = roundTrip(normalizePosePlanning(v37, ctx()));
  assertEquals(rechecked.slots.showcase.source, "product");
  assertStringIncludes(rechecked.slots.showcase.rationale, "product-highlight close-up");
  assertEquals(rechecked.slots.creative, first.slots.creative);

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
  const first = roundTrip(normalizePosePlanning({ referencePose: { ...longest, cameraAngle: "eye-level, ".repeat(16) } }, ctx()));
  const slot = first.slots.creative;
  assertEquals(slot.source, "reference");
  assert(slot.directive.length <= MAX_REFERENCE_DIRECTIVE);
  assert(slot.directive.endsWith("never the reference clothing, face, hair or anything in the hands (jewellery follows the styling plan). Keep the uploaded garment's front design, print, colours and construction exactly as the product photos show; a folded posture may let the hem rest naturally but never hides the print or changes the garment."));
  assertStringIncludes(slot.directive, `Rest on the ${longest.seatOrSupport}, which must already belong to the locked set.`);
  // The camera sentence is fixed text: the free-text description and signature give way first.
  assertStringIncludes(slot.directive, "Camera and framing as the STYLE REFERENCE is shot: eye-level,");
  assertEquals(first.slots.showcase.source, "product");
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
  assertStringIncludes(prompt, "POSE 4 MATCHES THE REFERENCE POSTURE: whenever the STYLE REFERENCE shows a person");
  assertStringIncludes(prompt, "shot at the reference cameraAngle and framing, with the reference hand gesture, gaze and mood");
  assertStringIncludes(prompt, "A walking or mid-stride reference becomes a grounded weight shift with both feet on the floor");
  assertStringIncludes(prompt, "It does not stop Pose 4 from matching the reference");
  assertStringIncludes(prompt, "Pose 6 (showcase) never copies the reference posture: it is the PRODUCT HIGHLIGHT close-up");
  assertStringIncludes(prompt, "Poses 1, 2, 3, 5, and 6 never copy the reference posture");
  assertEquals(prompt.includes("POSE 4 AND POSE 6 MATCH THE REFERENCE POSTURE"), false);
  assertStringIncludes(prompt, "Record body position and look only: never the clothing, face identity, hair, jewellery, or anything in the hands.");
  // v37: the reference look (camera, expression, gaze, hands) is recorded; objects in the hands never are.
  assertStringIncludes(prompt, '"cameraAngle":"height, angle and distance of the shot","expression":"mouth and mood","gaze":"eye direction and head angle","hands":"hand gesture, never objects"');
  assertStringIncludes(prompt, "expressionPlan sets the shoot's mood (attitude, energy, smile level).");
  assertStringIncludes(prompt, "Each face-visible pose then gets its OWN expression: a different gaze target, head angle and mouth");
  assertStringIncludes(prompt, "Never write the same 'soft smile, eyes to camera' for every frame");
  // With a model face attached, modelIdentity.face records features only.
  assertStringIncludes(
    buildCombinedAnalysisPrompt({ ...promptArgs, hasModelReference: true }),
    "features only, never a gaze direction, smile, expression or head angle (those change per frame).",
  );
  // The anti-forced-smile floor stays.
  assertStringIncludes(prompt, "NEVER artificial, forced, stiff, wide, or frozen stock catalog smiles, and never a toothy grin.");
  assertEquals(prompt.includes("Every pose's expression follows expressionPlan"), false);
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

Deno.test("a seated reference is adopted for Pose 4; Pose 6 is the product-highlight close-up", () => {
  const normalized = normalizeAnalysis(sareeRaw(seated), "saree");
  assertEquals(normalized.posePlanning!.slots.creative.source, "reference");
  assertEquals(normalized.posePlanning!.slots.showcase.source, "product");
  const [front, , , creative, , showcase] = normalized.posePlan;
  assertStringIncludes(creative.bodyPosition, "seated posture");
  assertEquals(creative.title, "Signature Reference Pose");
  assertStringIncludes(creative.prompt, "Create a closer editorial portrait.");
  assertStringIncludes(creative.prompt, normalized.posePlanning!.slots.creative.directive);
  assertEquals(/never copy style-reference sitting|Sit only/i.test(JSON.stringify(creative)), false);
  assertEquals(creative.referencePosture, "seated");
  // No showcase plan and no saree truth recorded: the fabric itself is the highlight, cropped close.
  assertEquals(normalized.creativeDirection.showcasePlan?.productHighlight, true);
  assertEquals(normalized.creativeDirection.showcasePlan?.evidenceReference, "saree_body_detail");
  assertEquals(showcase.title, "Product Highlight: Bottle green silk fabric texture and weave");
  assertStringIncludes(showcase.framing, "detail close-up");
  assertEquals(showcase.referencePosture, undefined);
  assertEquals(normalized.posePlan.map((pose) => pose.title).slice(0, 3), ["Full Front View", "Turning Drape & Fall View", "Back View"]);
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
  assertEquals(normalized.posePlanning!.slots.showcase.source, "product");
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
  // The product-highlight brief replaces the model's Pose 6 posture and prompt.
  assertEquals([showcase.bodyPosition, showcase.prompt], [template[5].bodyPosition, template[5].prompt]);
  assertEquals(/kneel|seated/i.test(`${showcase.bodyPosition} ${showcase.prompt}`), false);
  const again = roundTrip(normalizeAnalysis(roundTrip(normalized) as unknown as JsonRecord, "kurti", options));
  assertEquals(again.posePlan, roundTrip(normalized.posePlan));

  // Legacy analyses (no posePlanning) keep the model's prose exactly.
  const { referencePose: _pose, expressionPlan: _plan, ...legacyRaw } = raw;
  const legacy = normalizeAnalysis(legacyRaw, "kurti");
  assertEquals(legacy.posePlanning, undefined);
  assertEquals(legacy.posePlan[3].bodyPosition, "Perched on the stool");
  assertEquals(legacy.posePlan[5].bodyPosition, "Kneeling beside the bench");
});

Deno.test("a v38 Pose 6 is a close-up of its chosen feature, never a reference posture or a full-body frame", () => {
  const raw: JsonRecord = {
    productIdentity: { garmentFamily: "kurta_or_kurti_set", length: "knee length", bottomWearDetails: "none - standalone garment" },
    referencePose: { ...seated, posture: "leaning", seatOrSupport: "" },
    creativeDirection: { closeupHeroDetail: "square neckline piping" },
    showcasePlan: {
      heroFeature: "mirror-work yoke running into the side panels",
      featureRegion: "embroidery",
      shotType: "full_body_feature",
      bodyPosition: "Standing mid-turn",
      framing: "Head-to-toe three-quarter frame",
    },
  };
  // Without a model-written Pose 6 prompt, and with a full-body one that the close-up brief replaces.
  const modelPoses = [
    ...["full_front", "angled", "back", "creative", "closeup"].map((id) => ({ id })),
    { id: "showcase", framing: "full length", prompt: "Create a full-length three-quarter frame that sells the yoke mirror work." },
  ];
  for (const variant of [raw, { ...raw, posePlan: modelPoses }]) {
    const normalized = normalizeAnalysis(variant, "kurti");
    assertEquals(normalized.posePlanning!.slots.showcase.source, "product");
    const plan = normalized.creativeDirection.showcasePlan!;
    assertEquals([plan.productHighlight, plan.featureRegion, plan.shotType, plan.evidenceReference], [true, "embroidery", "half_body_detail", "fabric_pattern"]);
    assertEquals([plan.framing, plan.bodyPosition], ["", ""]);
    const showcase = normalized.posePlan[5];
    assertEquals(showcase.title, "Product Highlight: mirror-work yoke running into the side panels");
    assertStringIncludes(showcase.framing, "Torso crop from just below the chin to the hip");
    assertEquals(showcase.primaryReference, "fabric_pattern");
    assertEquals(/full length|full-length|head-to-toe|leaning|mid-turn/i.test(`${showcase.framing} ${showcase.bodyPosition} ${showcase.prompt}`), false);
    assertStringIncludes(showcase.prompt, "Create a tight, accurate product-highlight close-up of mirror-work yoke running into the side panels");
    assertEquals(showcase.referencePosture, undefined);
    const again = roundTrip(normalizeAnalysis(roundTrip(normalized) as unknown as JsonRecord, "kurti"));
    assertEquals(again.posePlan, roundTrip(normalized.posePlan));
    assertEquals(again.creativeDirection.showcasePlan, roundTrip(plan));
  }
});

/** T94-Kitkat-Kattha as analysis v37 recorded it, run through the v38 normalization. */
const t94Raw = (overrides: JsonRecord = {}): JsonRecord => ({
  productIdentity: {
    garmentFamily: "short_kurti_top",
    category: "kurti",
    mainColor: "rust",
    fabric: "kattha cotton",
    pattern: "allover cream, black and teal medallion print",
    neckline: "square neckline",
    sleeveType: "flared bell sleeves with black lace trim at the cuffs",
    backConstruction: "criss-cross black lace-up tie down the centre back ending in a bow with hanging ends",
    bottomWearDetails: "black straight trousers",
  },
  creativeDirection: { closeupHeroDetail: "square neckline with the medallion print" },
  referencePose: {
    posture: "seated",
    description: "seated on a low bench, legs crossed, one hand bracing on the bench, head turned sideways",
    seatOrSupport: "low reddish-brown wooden bench platform",
    distinctiveness: "generic",
    cameraAngle: "eye-level slightly low, mid-full framing",
    gaze: "looking sideways",
    hands: "one hand bracing on the bench",
    suitableForProduct: "no",
    suitabilityReason: "seated crossed legs folds hip hem and hides trouser silhouette and back lace-up",
  },
  expressionPlan: { attitude: "Relaxed, quietly confident", energy: "calm", smile: "soft" },
  showcasePlan: {
    heroFeature: "Back lace-up showcase",
    featureRegion: "other",
    shotType: "full_body_feature",
    evidenceReference: "front",
    framing: "full-length back view",
    distinctFrom: "a second full back view",
  },
  ...overrides,
});

Deno.test("T94: Pose 4 adopts the seated reference with its camera and bench; Pose 6 is the back lace-up close-up", () => {
  const normalized = normalizeAnalysis(t94Raw(), "kurti", { productDetails: "Rust kattha cotton short kurti top with black trousers" });
  const { creative, showcase } = normalized.posePlanning!.slots;
  assertEquals([creative.source, creative.posture, showcase.source], ["reference", "seated", "product"]);
  const pose4 = normalized.posePlan[3];
  assertEquals(pose4.title, "Signature Reference Pose");
  assertEquals(pose4.cameraAngle, "eye-level slightly low, mid-full framing, as the STYLE REFERENCE is shot");
  assertStringIncludes(pose4.framing, "framed as the STYLE REFERENCE is shot (eye-level slightly low, mid-full framing)");
  assertStringIncludes(pose4.bodyPosition, "Rest on the low reddish-brown wooden bench platform");
  assertStringIncludes(pose4.bodyPosition, "a folded posture may let the hem rest naturally but never hides the print");

  const plan = normalized.creativeDirection.showcasePlan!;
  assertEquals([plan.productHighlight, plan.featureRegion, plan.shotType, plan.evidenceReference], [true, "back_detail", "half_body_detail", "back"]);
  const pose6 = normalized.posePlan[5];
  assertEquals(pose6.primaryReference, "back");
  assertStringIncludes(pose6.framing, "Back-detail crop: the model faces fully away");
  assertStringIncludes(pose6.framing, "shoulder blades to waist");
  assertStringIncludes(pose6.bodyPosition, "Model turned fully away from the camera");
  assert(pose6.productVisibilityRules.some((rule) => rule.includes("BACK product photo is the only authority")));
  assert(pose6.productVisibilityRules.includes(
    "recorded back construction to match: criss-cross black lace-up tie down the centre back ending in a bow with hanging ends",
  ));
  assertEquals(/full-length|second full back view/i.test(JSON.stringify(pose6)), false);
  assertEquals(normalized.posePlan.map((pose) => pose.title), [
    "Full Front View", "Turning 3/4 View", "Back View", "Signature Reference Pose", "Face + Details Close-Up", "Product Highlight: Back lace-up showcase",
  ]);
});

Deno.test("Pose 6 takes the next distinctive feature when its pick is what Pose 5 already shows", () => {
  const raw = t94Raw({
    showcasePlan: { heroFeature: "square neckline with contrast piping", featureRegion: "neckline", shotType: "macro_detail" },
  });
  const plan = normalizeAnalysis(raw, "kurti").creativeDirection.showcasePlan!;
  // The back lace-up is the first distinctive feature recorded away from the chest.
  assertEquals([plan.featureRegion, plan.heroFeature, plan.evidenceReference], [
    "back_detail", "criss-cross black lace-up tie down the centre back ending in a bow with hanging ends", "back",
  ]);
  assertStringIncludes(plan.distinctFrom, "not Pose 5's square neckline with the medallion print");
  // Without a back detail the sleeves and their cuff trim come next, led by the mannequin photo.
  const noBack = t94Raw({
    productIdentity: { ...(t94Raw().productIdentity as JsonRecord), backConstruction: "plain back panel" },
    showcasePlan: { heroFeature: "square neckline with contrast piping", featureRegion: "neckline", shotType: "macro_detail" },
  });
  const sleeve = normalizeAnalysis(noBack, "kurti").creativeDirection.showcasePlan!;
  assertEquals([sleeve.featureRegion, sleeve.shotType, sleeve.evidenceReference], ["sleeve", "macro_detail", "mannequin"]);
  assertStringIncludes(normalizeAnalysis(noBack, "kurti").posePlan[5].framing, "Forearm and cuff crop");
});

/** T94's uploads; the model face and the style reference are one photo. */
const T94_REFERENCES = ["front", "back", "fabric_pattern", "mannequin", "additional_product", "model_identity", "style_reference"]
  .map((role) => ({ role, hash: role === "model_identity" || role === "style_reference" ? "same-photo" : role }));

function t94Prompt(poseIndex: number) {
  const normalized = normalizeAnalysis(t94Raw(), "kurti");
  const pose = { ...normalized.posePlan[poseIndex], poseNumber: poseIndex + 1 };
  const garmentFamily = String(normalized.productIdentity.garmentFamily);
  const references = selectReferences(T94_REFERENCES, [], pose.id, garmentFamily, MAX_IMAGE_REFERENCES, pose.primaryReference);
  const session = {
    productIdentity: normalized.productIdentity,
    creativeDirection: normalized.creativeDirection,
    modelIdentity: normalized.modelIdentity,
    posePlanning: normalized.posePlanning,
  };
  const prompt = composeGenerationPrompt({
    skuName: "T94-Kitkat-Kattha", productDetails: "Rust kattha cotton short kurti top", pose, session, references,
    useStyleReferenceAsModelIdentity: true,
  });
  return { normalized, pose, references, prompt };
}

Deno.test("T94 prompts: Pose 3 names the back authority, Pose 4 the reference frame, Pose 6 the back close-up with the back photo first", () => {
  const back = t94Prompt(2).prompt;
  assertStringIncludes(back, "- Back panel: criss-cross black lace-up tie down the centre back ending in a bow with hanging ends.");
  assertStringIncludes(back, "- Match from the BACK PRODUCT image, the only authority for the back: the back neck shape and depth; every closure (lace-up crossings, ties, the bow and its hanging ends");

  const creative = t94Prompt(3).prompt;
  assertStringIncludes(creative, "REFERENCE POSE MATCH (POSE 4):\n- Match the STYLE REFERENCE person's seated posture: seated on a low bench");
  assertStringIncludes(creative, "Rest on the low reddish-brown wooden bench platform, which must already belong to the locked set.");
  assertStringIncludes(creative, "Camera and framing as the STYLE REFERENCE is shot: eye-level slightly low, mid-full framing.");
  assertStringIncludes(creative, "never hides the print or changes the garment");
  assertStringIncludes(creative, "- camera angle: eye-level slightly low, mid-full framing, as the STYLE REFERENCE is shot");
  assertStringIncludes(creative, "one hand bracing on the bench, as the STYLE REFERENCE person does");
  assertEquals(creative.includes("DO NOT COPY THE STYLE POSE"), false);

  const { pose, references, prompt } = t94Prompt(5);
  // The back photo leads the product photos in the Pose 6 manifest.
  const products = references.filter((reference) => !["model_identity", "style_reference"].includes(reference.role));
  assertEquals(products[0].role, "back");
  assertStringIncludes(prompt, "CURRENT FRAME (POSE 6 - PRODUCT HIGHLIGHT CLOSE-UP)");
  assertStringIncludes(prompt, "POSE 6 HARD RULE (PRODUCT HIGHLIGHT DETAIL CLOSE-UP):");
  assertStringIncludes(prompt, "- CLOSE-UP FRAMING: Back-detail crop: the model faces fully away");
  assertStringIncludes(prompt, "- BACK DETAIL AUTHORITY: the BACK PRODUCT image is the only authority for this detail.");
  assertStringIncludes(prompt, "never a repeat of Pose 1 or of Pose 3's full back view");
  assertStringIncludes(prompt, "- NOT POSE 5: Pose 5 already shows \"square neckline with the medallion print\"");
  assertStringIncludes(prompt, "- Pose 6 (showcase): PRODUCT HIGHLIGHT - a tight detail close-up");
  for (const marker of ["REFERENCE POSE MATCH (POSE 6)", "SHOWCASE FRAME DISTANCE", "THIS FRAME'S EXPRESSION"]) {
    assertEquals(prompt.includes(marker), false, marker);
  }

  const qa = buildPoseQaPrompt({
    poseNumber: 6, poseType: "showcase", poseTitle: pose.title, poseDirection: pose,
    productIdentity: t94Prompt(5).normalized.productIdentity, creativeDirection: t94Prompt(5).normalized.creativeDirection,
    modelIdentity: {}, garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: false, hasModelReference: false,
    referenceManifest: references.map((reference, index) => `IMAGE ${index + 1}: ${roleLabel(reference.role)}`),
  });
  assertStringIncludes(qa, "For pose 6 (product-highlight detail close-up: Back lace-up showcase [back_detail]), fail pose_requirement if it is a full-body or three-quarter frame");
  assertStringIncludes(qa, "(the BACK PRODUCT image decides this back detail)");
  assertStringIncludes(qa, "Do NOT fail pose_requirement, model_face, or face_realism merely because the face is cropped out");
});

Deno.test("past-tense walk wording is grounded too, never copied into the Pose 4 directive", () => {
  for (const description of ["Leaning as she walked past the counter", "Turned as she strode in"]) {
    const plan = localPosePlanningDecision(
      normalizeReferencePose({ posture: "leaning", description, cameraAngle: "eye level" }),
      normalizeExpressionPlan({}),
      ctx(),
    );
    assertEquals(plan.slots.creative.source, "reference");
    assertEquals(plan.slots.creative.directive.includes(description), false);
    assertStringIncludes(plan.slots.creative.directive, "both feet on the floor");
  }
});

Deno.test("a clause naming a held object never reaches the Pose 4 directive (T94 v38 cup)", () => {
  const plan = localPosePlanningDecision(
    normalizeReferencePose({
      posture: "seated",
      description: "seated on low wood bench/platform, torso three-quarter left, legs crossed with one knee over other, " +
        "right elbow bent holding cup up near mouth, left arm extended back resting on bench, head turned to side",
      seatOrSupport: "low dark wood bench/platform",
      cameraAngle: "eye-level slightly three-quarter, medium full seated framing",
      suitableForProduct: "yes",
    }),
    normalizeExpressionPlan({}),
    ctx(),
  );
  const { directive } = plan.slots.creative;
  assertEquals([plan.slots.creative.source, plan.slots.creative.posture], ["reference", "seated"]);
  assertEquals(/\bcup\b|near mouth/.test(directive), false);
  assertStringIncludes(directive, "legs crossed with one knee over other, left arm extended back resting on bench, head turned to side.");
  assertEquals(directive.includes("both feet on the floor"), false);
  assertEquals(withoutHeldObjects("Phone raised; hand on hip. Sunglasses up"), "hand on hip");
  assertEquals(withoutHeldObjects("leaning on a bottle green pillar"), "leaning on a bottle green pillar");
});

Deno.test("a negated back detail is not a Pose 6 feature, and nothing distinct from Pose 5 still gives a marked close-up", () => {
  const negated = t94Raw({
    productIdentity: { ...(t94Raw().productIdentity as JsonRecord), backConstruction: "plain back panel with no ties or closure" },
    showcasePlan: { heroFeature: "square neckline with contrast piping", featureRegion: "neckline", shotType: "macro_detail" },
  });
  // "no ties or closure" must not read as a back closure; the sleeves come next.
  assertEquals(normalizeAnalysis(negated, "kurti").creativeDirection.showcasePlan!.featureRegion, "sleeve");

  const bare = t94Raw({
    productIdentity: {
      ...(t94Raw().productIdentity as JsonRecord),
      backConstruction: "plain back panel", sleeveType: "plain straight sleeves", hemline: "", hem: "", embroidery: "none", pattern: "", print: "",
    },
    showcasePlan: { heroFeature: "square neckline with contrast piping", featureRegion: "neckline", shotType: "macro_detail" },
  });
  const plan = normalizeAnalysis(bare, "kurti").creativeDirection.showcasePlan!;
  // Never an unmarked plan that effectiveShowcaseShot could widen to a full-body frame.
  assertEquals(plan.productHighlight, true);
  assert(!["neckline", "silhouette", "complete_set"].includes(plan.featureRegion));
});

Deno.test("an adopted Pose 4 drops the analysis's own hand placement for the reference gesture", () => {
  const pose4 = normalizeAnalysis(t94Raw(), "kurti").posePlan[3];
  assertStringIncludes(pose4.handPlacement, "Hands follow the matched posture and the style-reference hand gesture");
  assertEquals(/pocket/i.test(pose4.handPlacement), false);
});
