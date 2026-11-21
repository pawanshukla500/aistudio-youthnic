import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { composeGenerationPrompt, IMAGE_PROMPT_SAFE_CHARS, isFarshiGeneration, promptReferenceSlots } from "../lib/generationPrompt.ts";
import { buildPoseQaPrompt } from "../lib/qa.ts";
import { roleLabel } from "../lib/referencePolicy.ts";
import { buildGenerationMemory, formatGenerationMemoryBrief } from "../lib/generationMemory.ts";
import { withoutExpressionWords } from "../lib/expressionDirection.ts";
import {
  localPosePlanningDecision,
  normalizeExpressionPlan,
  normalizeReferencePose,
  type PosePlanning,
} from "../lib/posePlanning.ts";

const POSE_IDS = ["full_front", "angled", "back", "creative", "closeup", "showcase"];
const REFERENCES = [{ role: "front" }, { role: "back" }, { role: "style_reference" }];

function pose(id: string, extra: Record<string, unknown> = {}) {
  const poseNumber = POSE_IDS.indexOf(id) + 1;
  return {
    id,
    poseNumber,
    title: `Pose ${poseNumber} catalog`,
    description: "Planted catalog stance.",
    prompt: "Planted catalog stance that keeps the garment readable.",
    cameraAngle: "eye level",
    framing: "full length",
    bodyPosition: "weight on one leg",
    handPlacement: "relaxed",
    expression: "soft smile",
    highlightedDetails: ["yoke embroidery"],
    productVisibilityRules: ["hem visible"],
    purpose: "sell the garment",
    consistencyNotes: "same model",
    enabled: true,
    ...extra,
  } as any;
}

function baseSession(extra: Record<string, unknown> = {}) {
  return {
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      category: "ethnic/fusion",
      mainColor: "teal",
      bottomWearDetails: "wide palazzo",
    },
    creativeDirection: { backgroundStyle: "Lime-washed courtyard with a low wooden stool" },
    modelIdentity: { face: "oval face, long braid" },
    ...extra,
  };
}

function plan(referencePose: Record<string, unknown>, ctx: Record<string, string> = {}, extra: Partial<PosePlanning> = {}): PosePlanning {
  return {
    ...localPosePlanningDecision(
      normalizeReferencePose({ suitableForProduct: "yes", ...referencePose }),
      normalizeExpressionPlan({ attitude: "Serene, regal poise", energy: "serene", gaze: "soft gaze past the lens", smile: "soft" }),
      { poseFamily: "long_kurti", bottomCutClass: "palazzo", ...ctx },
    ),
    ...extra,
  };
}

const SEATED = { posture: "seated", description: "seated upright on a low stool, knees together, hands resting on the knees", seatOrSupport: "low wooden stool" };
const LEANING = {
  posture: "leaning",
  description: "shoulder leaning on the courtyard pillar, one knee softly bent",
  distinctiveness: "signature",
  signatureDescription: "chin lifted over the shoulder toward the lens",
};

function compose(id: string, session: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return composeGenerationPrompt({
    skuName: "TEAL-KURTI",
    productDetails: "Teal kurti with palazzo",
    pose: pose(id, extra.pose as Record<string, unknown> | undefined),
    session,
    references: (extra.references as Array<{ role: string }>) ?? REFERENCES,
    correction: extra.correction as string | undefined,
    generationMemory: extra.generationMemory as string | undefined,
  });
}

// Face-visible frames point every expression line at their own closing-tail direction block.
const FRAME_POINTER = "as the THIS FRAME'S EXPRESSION line states";
const frameBlock = (prompt: string) => prompt.match(/\nTHIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: [^\n]*/)?.[0] ?? "";
// A plan's serene energy caps Pose 4's smile at soft; a legacy (calm) shoot lets it warm one level.
const SERENE_CREATIVE_MOUTH = "head tilted a few degrees; a soft closed-lip smile that reaches the eyes.";
const CALM_CREATIVE_MOUTH = "head tilted a few degrees; a warm, genuine smile with a natural softening around the eyes.";
/** A planned prompt with the plan's mood (shoot-wide attitude line, Pose 4 smile cap) put back to the legacy defaults. */
const withLegacyMood = (prompt: string) => prompt.replace(/\nEXPRESSION & ATTITUDE [^\n]*/, "").replace(SERENE_CREATIVE_MOUTH, CALM_CREATIVE_MOUTH);

Deno.test("adopted seated creative frame sits, leads with REFERENCE POSE MATCH and drops the no-copy block", () => {
  const session = baseSession({ posePlanning: plan(SEATED) });
  const prompt = compose("creative", session, {
    pose: { title: "Seated on the stool", prompt: "Seated on the low wooden stool. Holding a coffee cup." },
  });
  assertStringIncludes(prompt, "POSE REQUIREMENT:\nREFERENCE POSE MATCH (POSE 4):\n- Match the STYLE REFERENCE person's seated posture");
  assertStringIncludes(prompt, "Rest on the low wooden stool, which must already belong to the locked set.");
  assertStringIncludes(prompt, "POSE CATEGORY RULES (SITTING):");
  assertStringIncludes(prompt, "- Pose 4 (creative): Matches the STYLE REFERENCE person's seated posture");
  assertStringIncludes(prompt, "EDIT GOAL:\nPlace the exact uploaded product on one consistent professional adult fashion model and create Pose 4: Seated on the stool.");
  assertStringIncludes(prompt, "copy the person's posture only in Pose 4 and Pose 6, which the pose plan matched to this reference.");
  assertEquals(prompt.includes("DO NOT COPY THE STYLE POSE"), false);
  assertEquals(prompt.includes("SEATED EDITORIAL POSE REQUIREMENT (POSE 4)"), false);
  assertEquals(prompt.includes("CURRENT FRAME (POSE 4"), false);
  assertEquals(prompt.includes("Never copy the style photo's pose"), false);
  // Handheld objects stay quarantined even in a reference frame.
  assertEquals(/coffee cup/i.test(prompt.split("PROMPT:\n")[1].split("\n\nREALISTIC INTEGRATION:")[0]), false);
  // Outfit, face and anatomy locks stay in every frame.
  assertStringIncludes(prompt, "ABSOLUTE PROHIBITION ON COPYING THE STYLE REFERENCE GARMENT");
  assertStringIncludes(prompt, "STRICT PRODUCT ISOLATION RULE: Never copy, transfer, or borrow the clothing");
  assertStringIncludes(prompt, "EXACTLY TWO ARMS AND TWO HANDS");
  assert(prompt.length <= IMAGE_PROMPT_SAFE_CHARS);
});

Deno.test("adopted leaning signature creative frame uses the reference category", () => {
  const prompt = compose("creative", baseSession({ posePlanning: plan(LEANING) }), {
    pose: { description: "Leaning on the pillar, walking out of it with feet apart." },
  });
  assertStringIncludes(prompt, "POSE CATEGORY RULES (REFERENCE):");
  assertStringIncludes(prompt, "follow the REFERENCE POSE MATCH block for body position, support and signature styling");
  assertStringIncludes(prompt, "Reproduce the signature pose: chin lifted over the shoulder toward the lens.");
  // Walking is never adoptable: stride wording is scrubbed in a reference frame too.
  assertStringIncludes(prompt, "Description: Body position as the REFERENCE POSE MATCH block states.");
  assertEquals(prompt.includes("walking out of it"), false);
  assertStringIncludes(prompt, "and never freeze a walking stride, spin, or wide leg split. This frame's body position follows the REFERENCE POSE MATCH block.");
  assertEquals(prompt.includes("POSE CATEGORY RULES (DYNAMIC):"), false);
  assertEquals(prompt.includes("FARSHI: keep the feet close"), false);
});

Deno.test("a planner directive never carries a handheld object into the REFERENCE POSE MATCH block", () => {
  const adopted = plan(LEANING);
  adopted.slots.creative = { ...adopted.slots.creative, directive: "Lean on the pillar with one knee bent. Hold a coffee cup at the chest." };
  const prompt = compose("creative", baseSession({ posePlanning: adopted }));
  assertStringIncludes(prompt, "REFERENCE POSE MATCH (POSE 4):\n- Lean on the pillar with one knee bent.\n");
  assertEquals(prompt.includes("Hold a coffee cup"), false);
});

Deno.test("an adopted frame never carries a frozen stride from the planned expression, the directive or a walking slot", () => {
  const seated = plan(SEATED, {}, { expressions: { creative: "Playful half-smile, mid-stride" } });
  seated.slots.creative = { ...seated.slots.creative, directive: "Sit on the stool as if walking past it. Rest on the low wooden stool, which must already belong to the locked set." };
  const prompt = compose("creative", baseSession({ posePlanning: seated }));
  assertStringIncludes(prompt, "REFERENCE POSE MATCH (POSE 4):\n- Match the STYLE REFERENCE person's seated posture. Rest on the low wooden stool");
  assertStringIncludes(prompt, `\n- expression: ${FRAME_POINTER}\n`);
  assertStringIncludes(frameBlock(prompt), "THIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: gaze drifts away from the camera into the set");

  // A stored walking adoption (never written by the planner) is ignored like a missing one.
  const walking = plan(SEATED);
  walking.referencePose = { ...walking.referencePose, posture: "walking" };
  const legacy = compose("creative", baseSession());
  assertEquals(withLegacyMood(compose("creative", baseSession({ posePlanning: walking }))), legacy);

  // The planned mood ("Playful half-smile, mid-stride") reaches the frame direction block, so it is checked last.
  assertEquals(/mid-stride|walking past/i.test(prompt), false);
});

Deno.test("Farshi reference frame keeps planted-stance scrubbing and adds the joined-hem guard", () => {
  const session = baseSession({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "teal", bottomWearDetails: "farshi pajama" },
    posePlanning: plan(LEANING, { bottomCutClass: "farshi" }),
  });
  const prompt = compose("creative", session, { pose: { description: "Walking stride off the pillar." } });
  assertStringIncludes(prompt, "REFERENCE POSE MATCH (POSE 4):");
  assertStringIncludes(prompt, "- FARSHI: keep the feet close and the 6-inch joined hem closed and tapered");
  assertEquals(prompt.includes("Description: Walking stride off the pillar."), false);
  assertStringIncludes(prompt, "never freeze a walking stride, spin, or wide leg split.");
});

Deno.test("a stale stored plan never seats a Farshi frame, in the prompt or in QA", () => {
  const farshiProduct = { garmentFamily: "kurta_or_kurti_set", mainColor: "teal", bottomWearDetails: "farshi pajama" };
  // Planned before the Farshi guard applied (palazzo context), then replayed on a Farshi shoot.
  const stalePlan = plan(SEATED);
  assertEquals([stalePlan.slots.creative.source, stalePlan.slots.showcase.source], ["reference", "reference"]);
  const stale = baseSession({ productIdentity: farshiProduct, posePlanning: stalePlan });
  const legacy = baseSession({ productIdentity: farshiProduct });
  // The shoot memory is built from the same stored plan, so it names Pose 4 and Pose 6 as posture frames.
  const memoryFor = (posePlanning?: PosePlanning) => formatGenerationMemoryBrief({
    references: REFERENCES,
    posePlanning,
    memory: buildGenerationMemory({ references: REFERENCES, productIdentity: farshiProduct, posePlanning }),
  });
  assertStringIncludes(memoryFor(stalePlan), "and posture in Pose 4 and Pose 6 only");
  assertStringIncludes(memoryFor(stalePlan), "plus its posture in Pose 4 and Pose 6 only");
  for (const id of ["creative", "showcase", "full_front"]) {
    const extra = { pose: { prompt: "Seated on the low wooden stool, knees together." } };
    const prompt = compose(id, stale, { ...extra, generationMemory: memoryFor(stalePlan) });
    // Identical to the unplanned Farshi frame apart from the plan's mood (attitude line, Pose 4 smile cap), memory included.
    assertEquals(withLegacyMood(prompt), compose(id, legacy, { ...extra, generationMemory: memoryFor() }), id);
    for (const marker of ["REFERENCE POSE MATCH", "POSE CATEGORY RULES (SITTING)", "as the pose plan adopted", "pose plan matched", "Seated on the low wooden stool", "posture in Pose"]) {
      assertEquals(prompt.includes(marker), false, `${id}: ${marker}`);
    }
  }

  const qaArgs = {
    poseNumber: 4, poseType: "creative", poseTitle: "Creative", poseDirection: {},
    productIdentity: farshiProduct, creativeDirection: {}, modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: true, hasModelReference: false,
    referenceManifest: ["IMAGE 1: FRONT PRODUCT", "IMAGE 2: STYLE REFERENCE - room"],
  };
  const seatedMatch = { posture: "seated", directive: "Match the STYLE REFERENCE person's seated posture: seated upright on a low stool." };
  assertEquals(buildPoseQaPrompt({ ...qaArgs, referencePoseMatch: seatedMatch }), buildPoseQaPrompt(qaArgs));

  // An honoured adoption keeps its memory line.
  assertStringIncludes(compose("creative", baseSession({ posePlanning: stalePlan }), { generationMemory: memoryFor(stalePlan) }), "and posture in Pose 4 and Pose 6 only");
});

Deno.test("QA takes the generation prompt's Farshi verdict when Farshi is named only in the SKU", () => {
  const stalePlan = plan(SEATED);
  const session = baseSession({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "teal", bottomWearDetails: "flared pajama" },
    posePlanning: stalePlan,
  });
  const job = { session, skuName: "FARSHI-SET-12", productDetails: "Teal kurti set", references: REFERENCES };
  assertEquals(isFarshiGeneration(job), true);
  assertEquals(isFarshiGeneration({ ...job, skuName: "TEAL-SET-12" }), false);
  assertEquals(composeGenerationPrompt({ ...job, pose: pose("creative") }).includes("REFERENCE POSE MATCH"), false);
  assertEquals(promptReferenceSlots(session, isFarshiGeneration(job)), { creative: null, showcase: null });

  const qaArgs = {
    poseNumber: 4, poseType: "creative", poseTitle: "Creative", poseDirection: {},
    productIdentity: session.productIdentity, creativeDirection: {}, modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: true, hasModelReference: false,
    referenceManifest: ["IMAGE 1: FRONT PRODUCT", "IMAGE 2: STYLE REFERENCE - room"],
  };
  const seatedMatch = { posture: "seated", directive: "Match the STYLE REFERENCE person's seated posture: seated upright on a low stool." };
  // The stored profile alone does not say Farshi, so without the flag QA would honour the seat.
  assertStringIncludes(buildPoseQaPrompt({ ...qaArgs, referencePoseMatch: seatedMatch }), "\nREFERENCE POSE MATCH:");
  const farshiQa = { ...qaArgs, farshi: isFarshiGeneration(job) };
  assertEquals(buildPoseQaPrompt({ ...farshiQa, referencePoseMatch: seatedMatch }), buildPoseQaPrompt(farshiQa));
  assertStringIncludes(buildPoseQaPrompt(farshiQa), "When the bottom is Farshi/Farsi/Fasi");
  // The flag also wins the other way.
  const farshiProfile = { ...qaArgs, productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "farshi pajama" } };
  assertStringIncludes(buildPoseQaPrompt({ ...farshiProfile, farshi: false, referencePoseMatch: seatedMatch }), "\nREFERENCE POSE MATCH:");

  // Without the flag, a fabric close-up ("not bottom-wear print") is not a bottom photo that makes a top shoot Farshi.
  const topQa = {
    ...qaArgs,
    productIdentity: { garmentFamily: "western_or_casual", category: "western top", mainColor: "white" },
    referenceManifest: [`IMAGE 1: ${roleLabel("front")}`, `IMAGE 2: ${roleLabel("fabric_pattern")}`, "IMAGE 3: STYLE REFERENCE - room"],
  };
  const topMatched = buildPoseQaPrompt({ ...topQa, referencePoseMatch: seatedMatch });
  assertStringIncludes(topMatched, "\nREFERENCE POSE MATCH:");
  assertEquals(topMatched.includes("When the bottom is Farshi/Farsi/Fasi"), false);
});

Deno.test("adopted showcase frame matches the reference posture and keeps its showcase rule", () => {
  const session = baseSession({
    creativeDirection: {
      backgroundStyle: "Lime-washed courtyard",
      showcasePlan: { heroFeature: "mirror-work yoke", featureRegion: "embroidery", shotType: "full_body_feature" },
    },
    posePlanning: plan(LEANING, { showcaseFeatureRegion: "embroidery", showcaseShotType: "full_body_feature" }),
  });
  const prompt = compose("showcase", session);
  assertStringIncludes(prompt, "REFERENCE POSE MATCH (POSE 6):");
  assertStringIncludes(prompt, "different camera angle and framing from Pose 4");
  assertStringIncludes(prompt, "SHOWCASE FRAME SUBJECT: mirror-work yoke");
  assertStringIncludes(prompt, "the adopted STYLE REFERENCE leaning posture from the REFERENCE POSE MATCH block (never a Pose 1 repeat)");
  assertStringIncludes(prompt, "copy the person's posture only in Pose 4 and Pose 6");
  assertEquals(prompt.includes("CURRENT FRAME (POSE 6"), false);
});

Deno.test("an adopted showcase posture replaces only the showcase stance clauses it contradicts", () => {
  const legacyPleats = "Front pleats stay flat, evenly stacked and vertical; upper and lower borders stay continuous and identical in width; the hem border stays level.";
  const saree = baseSession({
    productIdentity: {
      garmentFamily: "saree",
      mainColor: "red",
      sareeTruth: { body: { baseColor: "red" } },
      sareeDrapePlan: { baseDrapeFamily: "open pallu" },
    },
  });
  assertStringIncludes(compose("showcase", saree), legacyPleats);
  const seatedSaree = compose("showcase", {
    ...saree,
    posePlanning: plan(SEATED, { poseFamily: "saree_ethnic", bottomCutClass: "none", showcaseFeatureRegion: "pallu", showcaseShotType: "drape_feature" }),
  });
  assertStringIncludes(seatedSaree, "REFERENCE POSE MATCH (POSE 6):");
  assertStringIncludes(seatedSaree, "SHOWCASE FRAME HARD RULE (DRAPE-LED)");
  assertStringIncludes(seatedSaree, "Pose per the REFERENCE POSE MATCH block; keep the pleat stack neat and evenly stacked");
  assertStringIncludes(seatedSaree, "No hand, arm, hair or prop crosses the pallu artwork.");
  assertEquals(seatedSaree.includes(legacyPleats), false);

  const top = composeGenerationPrompt({
    skuName: "WHITE-TOP",
    productDetails: "White western top",
    pose: pose("showcase"),
    session: {
      ...baseSession({ productIdentity: { garmentFamily: "western_or_casual", category: "western top", mainColor: "white" } }),
      bottomWearMode: "top_only",
      posePlanning: plan(LEANING, { poseFamily: "short_kurti_top", bottomCutClass: "none", showcaseFeatureRegion: "upper_garment", showcaseShotType: "movement_feature" }),
    },
    references: REFERENCES,
  });
  assertStringIncludes(top, "SHOWCASE FRAME HARD RULE (PLAYFUL, SET-MATCHED): pose per the REFERENCE POSE MATCH block, interacting only with the backdrop and props ALREADY established in this shoot.");
  assertStringIncludes(top, "The neckline, sleeve shape, hem line, fit and print stay unobstructed");
  assertEquals(top.includes("a shoulder tilt, or a relaxed lean on an element already present"), false);

  const seatedFeature = compose("showcase", baseSession({
    creativeDirection: {
      backgroundStyle: "Lime-washed courtyard",
      showcasePlan: { heroFeature: "mirror-work yoke", featureRegion: "embroidery", shotType: "full_body_feature" },
    },
    posePlanning: plan(SEATED, { showcaseFeatureRegion: "embroidery", showcaseShotType: "full_body_feature" }),
  }));
  assertStringIncludes(seatedFeature, "SHOWCASE FRAME DISTANCE: Frame around the REFERENCE POSE MATCH posture");
  assertStringIncludes(seatedFeature, "the REFERENCE POSE MATCH posture at a soft camera angle so the embroidery reads clearly");
  assertEquals(seatedFeature.includes("a natural stance with both feet planted and close"), false);
  assert(seatedFeature.length <= IMAGE_PROMPT_SAFE_CHARS);
});

Deno.test("frames 1, 2, 3 and 5 of an adopted shoot keep the no-pose-copy wording", () => {
  const session = baseSession({ posePlanning: plan(SEATED) });
  for (const id of ["full_front", "angled", "back", "closeup"]) {
    const prompt = compose(id, session);
    assertEquals(prompt.includes("REFERENCE POSE MATCH (POSE"), false, id);
    assertStringIncludes(prompt, "Discard the STYLE REFERENCE person's face, clothing, pose, pillar-leaning posture, and handheld props.");
    assertStringIncludes(prompt, "copy the style-reference person's lean/sitting posture or handheld coffee cups/totes/bags");
    assertStringIncludes(prompt, "or foreground pillar-leaning postures.");
    assertStringIncludes(prompt, "- Pose 4 (creative): Matches the STYLE REFERENCE person's seated posture");
    assertStringIncludes(prompt, "- Pose 6 (showcase): A distinct variation of the STYLE REFERENCE person's seated posture");
  }
});

Deno.test("legacy sessions without a stored plan keep today's prompt text apart from the per-frame expression direction", () => {
  const legacy = baseSession();
  for (const id of POSE_IDS) {
    const prompt = compose(id, legacy);
    // A stale or malformed plan is ignored exactly like a missing one.
    assertEquals(compose(id, { ...legacy, posePlanning: { version: 0, slots: { creative: { source: "reference" } } } }), prompt, id);
    assertEquals(compose(id, { ...legacy, posePlanning: { version: 1, slots: {} } }), prompt, id);
    for (const marker of ["REFERENCE POSE MATCH", "EXPRESSION & ATTITUDE", "as the pose plan adopted", "pose plan matched", "(REFERENCE)"]) {
      assertEquals(prompt.includes(marker), false, `${id}: ${marker}`);
    }
    assertStringIncludes(prompt, "Copy the room only: do not copy the pose or objects in the hands (ignore the person's face, leaning/sitting posture, cups, totes, and sunglasses).");
    // Face-visible frames point at their own direction block; the back view keeps today's line.
    assertStringIncludes(
      prompt,
      id === "back"
        ? "- Model expressions: authentic, relaxed warmth and natural composure; never a stiff, forced, or frozen smile."
        : `- Model expression in this frame: ${FRAME_POINTER}; never a stiff, forced, or frozen smile.`,
      id,
    );
    assertEquals(prompt.includes("Model expression in this frame"), id !== "back", id);
    assertStringIncludes(prompt, "Never render artificial, forced, stiff, or frozen stock catalog smiles", id);
    assertStringIncludes(prompt, "Never copy the style photo's pose.");
  }
  assertStringIncludes(compose("full_front", legacy), `and the full outfit reads from head to hem. Expression: ${FRAME_POINTER}. Never a rigid mannequin stance`);
  assertStringIncludes(compose("closeup", legacy), `- Expression: ${FRAME_POINTER}.`);
  assertStringIncludes(compose("closeup", legacy), `Any visible face is the locked identity with the planned expression (${FRAME_POINTER}), AND`);
  assertStringIncludes(compose("creative", legacy), "DO NOT COPY THE STYLE POSE (POSE 4):");
  assertStringIncludes(compose("back", legacy), "\n- expression: soft smile\n");
});

Deno.test("each face-visible frame of a legacy shoot gets its own gaze, and the back view none", () => {
  const legacy = baseSession();
  const gazes: Record<string, string> = {};
  for (const id of POSE_IDS) {
    const prompt = compose(id, legacy);
    const block = frameBlock(prompt);
    if (id === "back") {
      assertEquals(prompt.includes("THIS FRAME'S EXPRESSION"), false);
      continue;
    }
    gazes[id] = block.split("THIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: ")[1].split(";")[0];
    // The identity image and APPROVED POSE 1 give the face only, never their look; the floor against frozen frames stays.
    assertStringIncludes(block, "Copy only the face itself from the identity image and APPROVED POSE 1, never their expression, gaze or head tilt.", id);
    assertStringIncludes(block, "A candid moment, never a frozen stare, a fixed stock smile or both arms hanging straight.", id);
    assertStringIncludes(block, "Hands never cover the neckline, embroidery, print, slits or hem.", id);
  }
  assertEquals(gazes, {
    full_front: "eyes meet the lens directly, with warmth",
    angled: "eyes look just past the lens, toward the side the body turns to",
    creative: "gaze drifts away from the camera into the set, toward the light or a point beyond the frame, as if caught between moments",
    closeup: "eyes come back to the lens over a quarter head turn, quieter and closer than Pose 1",
    showcase: "eyes glance down toward the featured garment area or over the shoulder, never straight into the lens",
  });
  assertEquals(new Set(Object.values(gazes)).size, 5);
});

Deno.test("a stored plan with no adopted slot changes only the expression mood", () => {
  const legacy = baseSession();
  const productLed = baseSession({ posePlanning: plan({ posture: "standing" }) });
  for (const id of POSE_IDS) {
    const prompt = compose(id, productLed);
    assertEquals(withLegacyMood(prompt), compose(id, legacy), id);
  }
  // The plan's serene energy keeps Pose 4 at a soft smile where a calm legacy shoot warms it.
  assertStringIncludes(frameBlock(compose("creative", productLed)), SERENE_CREATIVE_MOUTH);
  assertStringIncludes(frameBlock(compose("creative", legacy)), CALM_CREATIVE_MOUTH);
});

Deno.test("planned expressions drive the expression lines and keep the calm fallback", () => {
  const session = baseSession({
    posePlanning: plan(SEATED, {}, {
      expressions: {
        full_front: "Serene, closed-lip smile with a soft gaze.",
        closeup: "quiet, warm half-smile",
        angled: "laughing while holding a coffee cup",
      },
    }),
  });
  const hero = compose("full_front", session);
  assertStringIncludes(hero, "EXPRESSION & ATTITUDE (THE SHOOT'S MOOD WHENEVER THE FACE IS VISIBLE; EACH FRAME KEEPS ITS OWN GAZE): Attitude: Serene, regal poise. Energy: serene. Mouth: soft closed-lip smile at most, never a forced or toothy grin.");
  assertStringIncludes(hero, `head to hem. Expression: ${FRAME_POINTER}. Never a rigid mannequin stance`);
  assertStringIncludes(hero, `\n- expression: ${FRAME_POINTER}\n`);
  assertStringIncludes(hero, `- Model expression in this frame: ${FRAME_POINTER}; never a stiff, forced, or frozen smile.`);
  // The planned mood replaces the default mouth; the slot keeps its own gaze.
  assertStringIncludes(frameBlock(hero), "THIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: eyes meet the lens directly, with warmth; head straight, chin level, the smallest natural tilt; Serene, closed-lip smile.");
  // The anti-forced-smile floor stays.
  assertStringIncludes(hero, "Never render artificial, forced, stiff, or frozen stock catalog smiles");
  assertStringIncludes(frameBlock(hero), "never a frozen stare, a fixed stock smile or both arms hanging straight.");

  const closeup = compose("closeup", session);
  assertStringIncludes(closeup, "POSE CATEGORY RULES (PLAYFUL):");
  assertStringIncludes(closeup, `- Expression: ${FRAME_POINTER}.`);
  assertStringIncludes(closeup, `Any visible face is the locked identity with the planned expression (${FRAME_POINTER}), AND`);
  assertStringIncludes(frameBlock(closeup), "head turned a quarter away from the camera, chin slightly down; quiet, warm half-smile.");
  assertEquals(closeup.includes("Expression should be warm, joyful, or confident."), false);

  const angled = compose("angled", session);
  assertStringIncludes(angled, `- Model expression in this frame: ${FRAME_POINTER}; never a stiff, forced, or frozen smile.`);
  assertEquals(/coffee/i.test(angled.split("LOCKED SUBJECT - MUST NOT CHANGE:")[1].split("FACE & IDENTITY LOCK")[0]), false);
  // A planned mood that holds an object never reaches the frame's own direction either.
  assertEquals(/coffee/i.test(frameBlock(angled)), false);
});

Deno.test("a planner mood keeps its mouth and mood but leaves the gaze to the slot", () => {
  const session = baseSession({
    posePlanning: plan({ posture: "standing" }, {}, {
      expressions: { full_front: "Serene, closed-lip smile with a soft gaze.", showcase: "Quiet pride, eyes to camera" },
    }),
  });
  const hero = frameBlock(compose("full_front", session));
  assertStringIncludes(hero, "eyes meet the lens directly, with warmth; head straight, chin level, the smallest natural tilt; Serene, closed-lip smile.");
  assertEquals(hero.includes("soft gaze"), false);
  // Pose 6 never looks into the lens, whatever the mood says.
  const showcase = frameBlock(compose("showcase", session));
  assertStringIncludes(showcase, "eyes glance down toward the featured garment area or over the shoulder, never straight into the lens; head inclined toward the featured area; Quiet pride.");
  assertEquals(showcase.includes("eyes to camera"), false);
});

const attitudeLine = (prompt: string) => prompt.match(/\nEXPRESSION & ATTITUDE [^\n]*/)?.[0] ?? "";

Deno.test("the shoot-wide attitude line drops posture words in every frame that does not copy that posture", () => {
  const expressionPlan = normalizeExpressionPlan({
    attitude: "Seated ease",
    energy: "calm",
    gaze: "Walking confidence toward the lens",
    smile: "soft",
  });
  const seated = baseSession({ posePlanning: plan(SEATED, {}, { expressionPlan }) });
  for (const id of ["full_front", "angled", "back", "closeup"]) {
    const line = attitudeLine(compose(id, seated));
    assertStringIncludes(line, "Energy: calm. Mouth: soft closed-lip smile at most, never a forced or toothy grin.", id);
    assertEquals(/seated|walking/i.test(line), false, id);
    // One shoot-wide gaze is never printed: each frame keeps its own.
    assertEquals(line.includes("Gaze:"), false, id);
  }
  // The adopted seated Pose 4 keeps the seated attitude it copies.
  assertStringIncludes(attitudeLine(compose("creative", seated)), "Attitude: Seated ease.");

  const leaningAttitude = normalizeExpressionPlan({ attitude: "Leaning, languid poise", energy: "warm", smile: "warm" });
  const productLed = baseSession({ posePlanning: plan({ posture: "standing" }, {}, { expressionPlan: leaningAttitude }) });
  for (const id of ["creative", "showcase"]) {
    const line = attitudeLine(compose(id, productLed));
    assertStringIncludes(line, "Energy: warm. Mouth: warm natural smile at most, never a forced or toothy grin.", id);
    assertEquals(line.includes("Gaze:"), false, id);
    assertEquals(/lean|languid/i.test(line), false, id);
  }
  // Nothing left but posture words falls back to the calm line.
  const postureOnly = normalizeExpressionPlan({ attitude: "Seated", gaze: "kneeling glance" });
  const onlyPosture = baseSession({ posePlanning: plan({ posture: "standing" }, {}, { expressionPlan: postureOnly }) });
  assertEquals(/seated|kneeling/i.test(attitudeLine(compose("full_front", onlyPosture))), false);
});

Deno.test("a planner plan with six expressions and no adoption drops every planned text that names a posture or stride", () => {
  const expressions: Record<string, string> = {
    full_front: "Serene closed-lip smile",
    angled: "Seated calm with a soft smile",
    back: "Walking confidence over the shoulder",
    creative: "Playful half-smile, mid-stride",
    closeup: "Quiet, warm half-smile",
    showcase: "Relaxed smile, sitting tall",
  };
  const planned = baseSession({ posePlanning: plan({ posture: "standing" }, {}, { planner: "langgraph", expressions }) });
  const deltaExpression = (prompt: string) => prompt.match(/\n- expression: [^\n]*/)?.[0];
  for (const id of POSE_IDS) {
    const prompt = compose(id, planned);
    if (id === "back") {
      // No frame direction on the back view: the same text as a legacy pose.expression gets the same scrub.
      assertEquals(deltaExpression(prompt), deltaExpression(compose(id, baseSession(), { pose: { expression: expressions[id] } })), id);
    } else {
      // Face-visible frames point at their own direction block, which carries the planned mood.
      assertEquals(deltaExpression(prompt), `\n- expression: ${FRAME_POINTER}`, id);
    }
    for (const marker of ["REFERENCE POSE MATCH", "as the pose plan adopted", "pose plan matched"]) {
      assertEquals(prompt.includes(marker), false, `${id}: ${marker}`);
    }
  }
  assertStringIncludes(frameBlock(compose("full_front", planned)), "the smallest natural tilt; Serene closed-lip smile.");
  assertStringIncludes(frameBlock(compose("closeup", planned)), "chin slightly down; Quiet, warm half-smile.");
  assertStringIncludes(compose("closeup", planned), `the planned expression (${FRAME_POINTER})`);
  assertStringIncludes(compose("back", planned), "- Model expression in this frame: Calm natural expression;");
  for (const id of ["full_front", "angled", "creative", "showcase"]) {
    assertStringIncludes(compose(id, planned), `- Model expression in this frame: ${FRAME_POINTER};`, id);
  }
  // A posture or stride word drops the whole planned text, never just the word (frame direction block included).
  for (const id of POSE_IDS) {
    assertEquals(compose(id, planned).includes(expressions[id]), !/seated|sitting|walking|stride/i.test(expressions[id]), id);
  }
});

Deno.test("REFERENCE POSE MATCH and the attitude line survive compaction down to Tier 5", () => {
  const fill = (marker: string, length: number) => `${marker} ${"x".repeat(length)}`;
  const session = baseSession({
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "teal",
      bottomWearDetails: "wide palazzo",
      garmentEvidence: Array.from({ length: 16 }, (_, index) => ({
        region: `front region ${index}`,
        sourceRole: "front",
        state: "confirmed",
        visibleConstruction: fill("construction", 360),
        visibleDecoration: fill("decoration", 360),
      })),
      detailPlacementMap: Array.from({ length: 16 }, (_, index) => fill(`placement-${index}`, 400)),
      absenceConstraints: Array.from({ length: 16 }, (_, index) => fill(`absent-${index}`, 400)),
    },
    consistencyRules: Array.from({ length: 16 }, (_, index) => fill(`rule-${index}`, 400)),
    posePlanning: plan(SEATED),
  });
  const prompt = composeGenerationPrompt({
    skuName: "TEAL-KURTI",
    productDetails: `notes ${"note ".repeat(4_000)}`,
    pose: pose("creative", { prompt: `Seated on the stool. ${"detail ".repeat(400)}`, description: "seat ".repeat(300) }),
    session,
    references: REFERENCES,
    correction: `fix ${"retry ".repeat(4_000)}`,
    learnings: "learn ".repeat(2_000),
    generationMemory: "memory ".repeat(2_000),
  });
  assert(prompt.length <= IMAGE_PROMPT_SAFE_CHARS);
  // Tier 1 compaction ran: the correction block was cut before its closing line.
  assertEquals(prompt.includes("- Address this correction completely and literally."), false);
  // Tier 5 ran: the prefix before POSE REQUIREMENT was sliced.
  assertStringIncludes(prompt, "[Background and auxiliary sections compacted]");
  assertStringIncludes(prompt, "REFERENCE POSE MATCH (POSE 4):\n- Match the STYLE REFERENCE person's seated posture");
  // The attitude line and this frame's direction ride in the never-compacted closing tail.
  const tail = prompt.slice(prompt.lastIndexOf("\nProduct accuracy is more important than style matching."));
  assertStringIncludes(tail, "\nEXPRESSION & ATTITUDE (THE SHOOT'S MOOD WHENEVER THE FACE IS VISIBLE; EACH FRAME KEEPS ITS OWN GAZE): Attitude: Serene, regal poise.");
  assertStringIncludes(tail, "\nTHIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: gaze drifts away from the camera into the set");
  // Tier 5 keeps ALLOWED DELTA with POSE REQUIREMENT, and its expression line still points at a block that survived.
  assertStringIncludes(prompt, "ALLOWED DELTA - THE ONLY THINGS THAT MAY CHANGE:");
  assertStringIncludes(prompt, `\n- expression: ${FRAME_POINTER}\n`);
  assert(prompt.indexOf("ALLOWED DELTA - THE ONLY THINGS THAT MAY CHANGE:") > prompt.indexOf("[Background and auxiliary sections compacted]"));
});

Deno.test("pose QA exempts a reference-matched frame from the pose-copy fail but not from props or clothing", () => {
  const qaArgs = {
    poseNumber: 4, poseType: "creative", poseTitle: "Seated on the stool", poseDirection: {},
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "wide palazzo" }, creativeDirection: {}, modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: true, hasModelReference: false,
    referenceManifest: ["IMAGE 1: FRONT PRODUCT", "IMAGE 2: STYLE REFERENCE - room"],
  };
  const legacy = buildPoseQaPrompt(qaArgs);
  assertStringIncludes(legacy, "The clothing, posture, and handheld props in the STYLE REFERENCE must be ignored.");
  assertStringIncludes(legacy, "Fail pose_requirement when the body is frozen in a walking stride");
  assertStringIncludes(legacy, "Fail pose_requirement when the stance, foreground pillar-leaning placement, or handheld objects");
  assertEquals(legacy.includes("REFERENCE POSE MATCH"), false);

  const referenceMatch = { posture: "seated", directive: "Match the STYLE REFERENCE person's seated posture: seated upright on a low stool." };
  const matched = buildPoseQaPrompt({ ...qaArgs, referencePoseMatch: referenceMatch });
  assertStringIncludes(matched, "this frame intentionally matches its posture (see REFERENCE POSE MATCH below)");
  assertStringIncludes(matched, "REFERENCE POSE MATCH: this frame intentionally matches the STYLE REFERENCE person's seated posture (Match the STYLE REFERENCE person's seated posture: seated upright on a low stool.). Do not fail pose_requirement for matching that posture");
  assertStringIncludes(matched, "Still fail garment_identity when the reference clothing is copied, model_face when the reference face is copied, and pose_requirement when handheld objects");
  assertEquals(matched.includes("Fail pose_requirement when the stance, foreground pillar-leaning placement"), false);
  // A frozen stride still fails a reference-matched frame.
  assertStringIncludes(matched, "Fail pose_requirement when the body is frozen in a walking stride");
  assertStringIncludes(matched, "THREE HANDS, EXTRA HANDS");

  // Walking is never honoured, and a stride sentence never reaches the directive QA quotes.
  assertEquals(buildPoseQaPrompt({ ...qaArgs, referencePoseMatch: { posture: "walking", directive: "Walk past the pillar." } }), legacy);
  const strideDirective = buildPoseQaPrompt({
    ...qaArgs,
    referencePoseMatch: { posture: "leaning", directive: "Lean on the pillar mid-stride. Keep the chin lifted." },
  });
  assertStringIncludes(strideDirective, "leaning posture (Match the STYLE REFERENCE person's leaning posture. Keep the chin lifted.).");
  assertEquals(strideDirective.includes("mid-stride"), false);

  const farshi = buildPoseQaPrompt({
    ...qaArgs,
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "farshi pajama" },
    referencePoseMatch: { posture: "leaning", directive: "Lean on the pillar." },
  });
  assertStringIncludes(farshi, "Fail pose_requirement when the body is frozen in a walking stride");
  assertStringIncludes(farshi, "REFERENCE POSE MATCH: this frame intentionally matches the STYLE REFERENCE person's leaning posture");
});

Deno.test("pose QA sanitizes the caller's directive and exempts low-posture folds without excusing the bottom-wear cut", () => {
  const qaArgs = {
    poseNumber: 6, poseType: "showcase", poseTitle: "Showcase", poseDirection: {},
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "printed palazzo" }, creativeDirection: {}, modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: true, hasModelReference: false,
    referenceManifest: ["IMAGE 1: FRONT PRODUCT", "IMAGE 2: STYLE REFERENCE - room"],
  };
  const matchLine = (prompt: string) => prompt.match(/\nREFERENCE POSE MATCH: [^\n]*/)?.[0] ?? "";

  const held = matchLine(buildPoseQaPrompt({
    ...qaArgs,
    referencePoseMatch: { posture: "kneeling", directive: "Kneel on the step. Hold a coffee cup at the chest." },
  }));
  assertStringIncludes(held, "kneeling posture (Kneel on the step.).");
  assertEquals(/coffee/i.test(held.split("Still fail")[0]), false);
  assertStringIncludes(held, "LOW-POSTURE EXEMPTION: folds and compression of the garment and bottom wear caused by the kneeling posture are expected. Judge the bottom wear's cut, print and colour, not its drape length");
  // Bottom-wear fidelity itself stays a gate.
  assertStringIncludes(buildPoseQaPrompt({ ...qaArgs, referencePoseMatch: { posture: "kneeling", directive: "Kneel." } }), "A high face/kurta score cannot rescue a wrong bottom.");

  const onlyProp = matchLine(buildPoseQaPrompt({ ...qaArgs, referencePoseMatch: { posture: "Sitting on a bench", directive: "Hold a tote bag." } }));
  assertStringIncludes(onlyProp, "seated posture (Match the STYLE REFERENCE person's seated posture.).");
  const empty = matchLine(buildPoseQaPrompt({ ...qaArgs, referencePoseMatch: { posture: "leaning", directive: "  " } }));
  assertStringIncludes(empty, "leaning posture (Match the STYLE REFERENCE person's leaning posture.).");
  assertEquals(empty.includes("LOW-POSTURE EXEMPTION"), false);

  const long = matchLine(buildPoseQaPrompt({ ...qaArgs, referencePoseMatch: { posture: "leaning", directive: `Lean ${"softly ".repeat(400)}` } }));
  const directive = long.split("leaning posture (")[1].split("). Do not fail")[0];
  assertEquals(directive.length, 900);

  // No person to match means no match at all.
  assertEquals(buildPoseQaPrompt({ ...qaArgs, referencePoseMatch: { posture: "none", directive: "Stand." } }), buildPoseQaPrompt(qaArgs));
});

Deno.test("style-reference label and shoot memory name the reference-matched frames only when a plan adopts them", () => {
  const legacyLabel = roleLabel("style_reference");
  assertEquals(roleLabel("style_reference", { referencePoseNumbers: [] }), legacyLabel);
  assertStringIncludes(legacyLabel, "Copy the room only: do not copy the pose or objects in the hands");
  const planned = roleLabel("style_reference", { referencePoseNumbers: [4, 6] });
  assertStringIncludes(planned, "Never copy the person's face, outfit or objects in the hands (cups, totes, sunglasses); copy the person's posture only in Pose 4 and Pose 6");
  assertStringIncludes(planned, "The clothing in this image must be 100% DISCARDED");
  assertStringIncludes(roleLabel("style_reference", { useStyleAsModelFace: true, referencePoseNumbers: [6] }), "Never copy the outfit or objects in the hands (cups, totes, sunglasses); copy the person's posture only in Pose 6");

  const legacyMemory = buildGenerationMemory({ productIdentity: { garmentFamily: "kurta_or_kurti_set" } });
  assertEquals(legacyMemory.preservedDetails.at(-1), "Product images are garment/SKU truth. Style reference is set/backdrop/jewellery taste only.");
  const plannedMemory = buildGenerationMemory({ productIdentity: { garmentFamily: "kurta_or_kurti_set" }, posePlanning: plan(SEATED) });
  const line = plannedMemory.preservedDetails.at(-1) ?? "";
  assertStringIncludes(line, "plus its posture in Pose 4 and Pose 6 only; never its outfit or handheld objects.");
  assert(line.length <= 180);

  const references = [{ role: "front" }, { role: "style_reference" }];
  assertStringIncludes(formatGenerationMemoryBrief({ references }), "Style reference (photoshoot set, backdrop, lighting, jewellery taste only): style_reference.");
  const creativeOnly = plan(SEATED, { showcaseShotType: "macro_detail" });
  assertEquals(creativeOnly.slots.showcase.source, "product");
  assertStringIncludes(
    formatGenerationMemoryBrief({ references, posePlanning: creativeOnly }),
    "Style reference (photoshoot set, backdrop, lighting, jewellery taste, and posture in Pose 4 only): style_reference.",
  );
});

Deno.test("adopted Pose 4/6 keep face, clothing and handheld quarantine for every identity source; only their own sentences drop the pose clause", () => {
  const FRESH = {
    adopted: [
      "never copy the STYLE REFERENCE person's face or props; its posture is used only as the REFERENCE POSE MATCH block directs",
      "completely discarding the person's face and props in the STYLE REFERENCE (its posture is used only",
      "Discard the STYLE REFERENCE person's face, clothing, and handheld props; its posture is used only",
    ],
    legacy: [
      "never copy the STYLE REFERENCE person's face, body stance, or props",
      "completely discarding the person's face, pose, and props in the STYLE REFERENCE",
      "Discard the STYLE REFERENCE person's face, clothing, pose, pillar-leaning posture, and handheld props.",
    ],
  };
  const COLLAPSED = {
    adopted: [
      "Discard that image's clothing and handheld objects; its posture is used only",
      "Still discard that image's clothing and handheld objects; its posture is used only",
    ],
    legacy: [
      "Discard that image's clothing, pose, pillar-leaning stance, and handheld objects.",
      "Still discard that image's clothing, posture, and handheld objects.",
    ],
  };
  const MODEL = {
    adopted: [
      "Ignore the style-reference person's face and body proportions, and every face in the product photos.",
      "Discard the face, hair, and body in the STYLE REFERENCE and in every product photo.",
    ],
    legacy: ["Ignore the style-reference person and every face in the product photos."],
  };
  const ANCHOR = {
    adopted: [
      "Ignore the person's face and body proportions in the STYLE REFERENCE; its posture is used only",
      "Discard the STYLE REFERENCE person's face, clothing, and handheld props; its posture is used only",
      "Ignore any person visible in the STYLE REFERENCE.",
    ],
    legacy: [
      "Ignore the person's face, pose, and body in the STYLE REFERENCE.",
      "Discard the STYLE REFERENCE person's face, clothing, pose, pillar-leaning posture, and handheld props.",
    ],
  };
  const rows: Array<{ name: string; roles: string[]; useStyle: boolean; face: { adopted: string[]; legacy: string[] }; styleFace: boolean }> = [
    { name: "fresh model", roles: ["front", "back", "style_reference"], useStyle: false, face: FRESH, styleFace: false },
    { name: "style photo as face", roles: ["front", "back", "style_reference"], useStyle: true, face: COLLAPSED, styleFace: true },
    { name: "model face", roles: ["front", "back", "model_identity", "style_reference"], useStyle: false, face: MODEL, styleFace: false },
    { name: "model face wins over the flag", roles: ["front", "back", "model_identity", "style_reference", "approved_pose"], useStyle: true, face: MODEL, styleFace: false },
    { name: "approved Pose 1", roles: ["front", "back", "style_reference", "approved_pose"], useStyle: false, face: ANCHOR, styleFace: false },
    { name: "approved Pose 1 + style photo as face", roles: ["front", "back", "style_reference", "approved_pose"], useStyle: true, face: COLLAPSED, styleFace: true },
  ];
  const QUARANTINE = [
    "ABSOLUTE PROHIBITION ON COPYING THE STYLE REFERENCE GARMENT",
    "STRICT PRODUCT ISOLATION RULE: Never copy, transfer, or borrow the clothing, saree, dress, colors, prints, or embroidery from the STYLE REFERENCE image.",
    "Also never copy handheld props (coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones)",
    "copy handheld coffee cups/totes/bags; the style-reference posture is used only as the REFERENCE POSE MATCH block directs.",
    "NEVER copying a coffee cup, tote bag, or sunglass case from the style photo",
    "Do not copy the Pose 1 stance or handheld props",
  ];
  const head = (prompt: string) => prompt.split("\nPOSE REQUIREMENT:")[0];
  const sentences = (prompt: string) => new Set(head(prompt).split(/(?<=[.!?;])\s+|\n/).map((part) => part.trim()).filter(Boolean));
  for (const row of rows) {
    const run = (id: string, posePlanning: PosePlanning) => composeGenerationPrompt({
      skuName: "TEAL-KURTI",
      productDetails: "Teal kurti with palazzo",
      pose: pose(id),
      session: baseSession({ posePlanning }),
      references: row.roles.map((role) => ({ role })),
      useStyleReferenceAsModelIdentity: row.useStyle,
    });
    const hero = run("full_front", plan(LEANING));
    for (const id of ["creative", "showcase"]) {
      const label = `${row.name} / ${id}`;
      const adopted = run(id, plan(LEANING));
      const productLed = run(id, plan({ posture: "standing" }));
      assertStringIncludes(adopted, `REFERENCE POSE MATCH (POSE ${id === "creative" ? 4 : 6}):`, label);
      for (const text of [...QUARANTINE, ...row.face.adopted]) assertStringIncludes(adopted, text, label);
      assertStringIncludes(adopted, row.styleFace ? "Never copy the outfit or objects in the hands" : "Never copy the person's face, outfit or objects in the hands", label);
      // When the style photo is the identity, its face and hair follow the face lock instead.
      assertStringIncludes(
        adopted,
        row.styleFace
          ? "never the reference outfit or anything in the hands (face and hair follow the FACE & IDENTITY LOCK; jewellery follows the styling plan)"
          : "never the reference outfit, face, hair or anything in the hands",
        label,
      );
      for (const text of row.face.legacy) {
        assertEquals(adopted.includes(text), false, `${label}: ${text}`);
        assertStringIncludes(productLed, text, label);
        // Frames that do not copy the posture keep the legacy sentence in the same shoot.
        assertStringIncludes(hero, text, `${row.name} / full_front`);
      }
      // Every sentence the adoption removed was a pose-copy clause or a listed legacy sentence, nothing else.
      const kept = sentences(adopted);
      for (const sentence of sentences(productLed)) {
        if (kept.has(sentence) || row.face.legacy.includes(sentence)) continue;
        assert(/\b(?:pose|posture|stance)\b/i.test(sentence), `${label} dropped: ${sentence}`);
      }
    }
  }
});

Deno.test("a style photo that is the model identity is never forbidden as the face of an adopted Pose 4/6, in the prompt or in QA", () => {
  const references = [{ role: "front" }, { role: "back" }, { role: "style_reference" }];
  const run = (id: string, useStyle: boolean) => composeGenerationPrompt({
    skuName: "TEAL-KURTI",
    productDetails: "Teal kurti with palazzo",
    pose: pose(id),
    session: baseSession({ posePlanning: plan(LEANING) }),
    references,
    useStyleReferenceAsModelIdentity: useStyle,
  });
  for (const id of ["creative", "showcase"]) {
    const collapsed = run(id, true);
    for (const text of ["reference clothing, face, hair", "reference outfit, face, hair", "reference outfit, face or handheld"]) {
      assertEquals(collapsed.includes(text), false, `${id}: ${text}`);
    }
    // The stored directive, the match block and the variation line all point at the face lock.
    assertStringIncludes(collapsed, "Copy only the body position and attitude, never the reference clothing or anything in the hands (face and hair follow the FACE & IDENTITY LOCK; jewellery follows the styling plan).", id);
    assertStringIncludes(collapsed, "- This frame only, with no new furniture: never the reference outfit or anything in the hands (face and hair follow the FACE & IDENTITY LOCK; jewellery follows the styling plan).", id);
    assertStringIncludes(collapsed, "never the reference outfit or handheld objects (face and hair follow the FACE & IDENTITY LOCK)", id);
    // A fresh model keeps the full face and hair quarantine.
    const fresh = run(id, false);
    assertStringIncludes(fresh, "never the reference clothing, face, hair or anything in the hands", id);
    assertStringIncludes(fresh, "never the reference outfit, face or handheld objects", id);
  }

  const leaning = plan(LEANING);
  const qaArgs = {
    poseNumber: 4, poseType: "creative", poseTitle: "Leaning", poseDirection: {},
    productIdentity: { garmentFamily: "kurta_or_kurti_set", bottomWearDetails: "wide palazzo" }, creativeDirection: {}, modelIdentity: {},
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: false, hasModelReference: false,
    referenceManifest: ["IMAGE 1: FRONT PRODUCT", "IMAGE 2: STYLE REFERENCE - room and model identity"],
    referencePoseMatch: { posture: "leaning", directive: leaning.slots.creative.directive },
  };
  const collapsedQa = buildPoseQaPrompt({ ...qaArgs, useStyleAsModelFace: true });
  assertEquals(collapsedQa.includes("model_face when the reference face is copied"), false);
  assertEquals(collapsedQa.includes("reference clothing, face, hair"), false);
  assertStringIncludes(collapsedQa, "Still fail garment_identity when the reference clothing is copied, and pose_requirement when handheld objects");
  assertStringIncludes(collapsedQa, "the STYLE REFERENCE face is the model identity");
  const freshQa = buildPoseQaPrompt(qaArgs);
  assertStringIncludes(freshQa, "Still fail garment_identity when the reference clothing is copied, model_face when the reference face is copied, and pose_requirement");
  assertStringIncludes(freshQa, "never the reference clothing, face, hair or anything in the hands");
});

Deno.test("a planned expression never carries a reference posture word into a frame that does not copy that posture", () => {
  const expressions = {
    back: "Face turned away from the lens, chin softly lowered; Leaning, languid poise carried through the posture.",
    creative: "Leaning, languid poise with a soft gaze.",
  };
  const deltaExpression = (prompt: string) => prompt.match(/\n- expression: [^\n]*/)?.[0] ?? "";
  const frameExpression = (prompt: string) => prompt.match(/\n- Model expression in this frame: [^\n]*/)?.[0] ?? "";

  const back = compose("back", baseSession({ posePlanning: plan({ posture: "standing" }, {}, { expressions }) }));
  assertEquals(deltaExpression(back), "\n- expression: Face turned away from the lens, chin softly lowered.");
  assertEquals(frameExpression(back), "\n- Model expression in this frame: Face turned away from the lens, chin softly lowered; never a stiff, forced, or frozen smile.");
  assertEquals(/leaning|languid/i.test(deltaExpression(back) + frameExpression(back)), false);

  // Face-visible Pose 4 points at its own direction block.
  const productLed = compose("creative", baseSession({ posePlanning: plan({ posture: "standing" }, {}, { expressions }) }));
  assertEquals(deltaExpression(productLed), `\n- expression: ${FRAME_POINTER}`);
  assertEquals(frameExpression(productLed), `\n- Model expression in this frame: ${FRAME_POINTER}; never a stiff, forced, or frozen smile.`);
  assertStringIncludes(frameBlock(productLed), "THIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: gaze drifts away from the camera into the set");
  // The adopted leaning Pose 4 keeps the posture it copies (its gaze clause goes to the slot).
  const adopted = compose("creative", baseSession({ posePlanning: plan(LEANING, {}, { expressions }) }));
  assertEquals(deltaExpression(adopted), `\n- expression: ${FRAME_POINTER}`);
  assertStringIncludes(frameBlock(adopted), "chin lifted slightly, head tilted a few degrees; Leaning, languid poise.");
  assertEquals(frameBlock(adopted).includes("soft gaze"), false);
  // Nothing left but a posture sentence: the product-led Pose 4 direction carries no posture word.
  assertEquals(/leaning|languid/i.test(frameBlock(productLed)), false);
});

const REFERENCE_LOOK = {
  expression: "dreamy half-smile",
  gaze: "eyes lowered to the left",
  hands: "hands loosely clasped at the waist",
  cameraAngle: "eye-level, knees-up",
};

Deno.test("Pose 4 takes the STYLE REFERENCE person's v37 look, Pose 6 only with the posture, the camera only with the posture", () => {
  const standing = baseSession({ posePlanning: plan({ posture: "standing", distinctiveness: "generic", ...REFERENCE_LOOK }) });
  const creative = compose("creative", standing);
  assertEquals(creative.includes("REFERENCE POSE MATCH"), false);
  const block = frameBlock(creative);
  assertStringIncludes(block, "THIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: eyes lowered to the left, as the STYLE REFERENCE person looks; the head angle the STYLE REFERENCE person holds; dreamy half-smile, as on the STYLE REFERENCE person.");
  assertStringIncludes(block, "Body: hands loosely clasped at the waist, as the STYLE REFERENCE person does");
  assertStringIncludes(block, "Copy only the face itself from the identity image, never APPROVED POSE 1's expression, gaze or head tilt.");
  // The posture is not adopted, so the reference camera is not either.
  assertEquals(block.includes("Camera:"), false);
  // The look is copied, never the reference face, stance or props.
  assertStringIncludes(creative, "never copy the STYLE REFERENCE person's face, body stance, or props");
  assertStringIncludes(creative, "DO NOT COPY THE STYLE POSE (POSE 4):");

  // A product-led Pose 6 keeps its slot default.
  const showcase = frameBlock(compose("showcase", standing));
  assertStringIncludes(showcase, "THIS FRAME'S EXPRESSION, GAZE & BODY LANGUAGE: eyes glance down toward the featured garment area or over the shoulder, never straight into the lens; head inclined toward the featured area;");
  assertEquals(/STYLE REFERENCE|dreamy|lowered to the left|clasped|Camera:/.test(showcase), false);

  // An adopted seated reference also gives Pose 4 the reference camera.
  const seated = compose("creative", baseSession({ posePlanning: plan({ ...SEATED, ...REFERENCE_LOOK }) }));
  assertStringIncludes(seated, "REFERENCE POSE MATCH (POSE 4):");
  assertStringIncludes(frameBlock(seated), "eyes lowered to the left, as the STYLE REFERENCE person looks");
  assertStringIncludes(frameBlock(seated), "Camera: eye-level, knees-up, as the STYLE REFERENCE is shot.");
});

Deno.test("a reference look never carries a posture, stride or held object into a Pose 4 that does not adopt the posture", () => {
  // Farshi blocks the seated adoption, but Pose 4 still takes the reference look.
  const farshi = baseSession({
    productIdentity: { garmentFamily: "kurta_or_kurti_set", mainColor: "teal", bottomWearDetails: "farshi pajama" },
    posePlanning: plan({
      ...SEATED,
      expression: "relaxed seated smile",
      gaze: "looking back while walking",
      hands: "hands resting on the knees, holding a coffee cup",
    }),
  });
  const prompt = compose("creative", farshi);
  assertEquals(prompt.includes("REFERENCE POSE MATCH"), false);
  assertEquals(/\b(?:seated|sitting|walking|coffee)\b/i.test(frameBlock(prompt)), false);
});

Deno.test("withoutExpressionWords keeps face features and drops gaze, smile and angle phrases", () => {
  assertEquals(
    withoutExpressionWords("oval face with warm medium-olive skin tone, full arched dark eyebrows, almond dark brown eyes glancing sideways, straight nose with soft tip, full natural lips in soft closed-mouth smile, gently defined jawline"),
    "oval face with warm medium-olive skin tone, full arched dark eyebrows, almond dark brown eyes, straight nose with soft tip, full natural lips, gently defined jawline",
  );
  assertEquals(
    withoutExpressionWords("oval face with smooth warm medium skin, full natural lips, straight nose, dark arched eyebrows, almond eyes with soft eyeliner, calm composed gaze; exact identity from model face reference to be preserved"),
    "oval face with smooth warm medium skin, full natural lips, straight nose, dark arched eyebrows, almond eyes with soft eyeliner, exact identity from model face reference to be preserved",
  );
  const angled = withoutExpressionWords("Soft oval face, gently arched dark eyebrows. Her face is shown at a slight angle in the reference; preserve the reference rather than inventing finer details.");
  assertStringIncludes(angled, "Soft oval face, gently arched dark eyebrows.");
  assertStringIncludes(angled, "preserve the reference rather than inventing finer details.");
  assertEquals(/shown at a slight angle|Her face is/.test(angled), false);

  // The face lock in the prompt carries the features without the gaze or smile.
  const prompt = compose("full_front", baseSession({ modelIdentity: { face: "almond dark brown eyes glancing sideways, full natural lips in soft closed-mouth smile" } }));
  assertStringIncludes(prompt, "almond dark brown eyes, full natural lips");
  assertEquals(/glancing sideways|closed-mouth smile/.test(prompt), false);
});
