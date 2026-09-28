import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { IMAGE_PROMPT_SAFE_CHARS, composeGenerationPrompt } from "../lib/generationPrompt.ts";
import { buildCombinedAnalysisPrompt } from "../lib/profiles.ts";
import {
  AUTO_BACKGROUND_STYLE,
  applyRequestedBackground,
  isAutoBackgroundStyle,
  sceneLockBlock,
} from "../lib/sceneLock.ts";

const PALACE_SET = {
  backgroundStyle: "Blue-and-white tiled palace courtyard with carved marble arches and three shallow white marble steps",
  studioEnvironment: "Sunlit heritage palace veranda, tiled pillars left and right",
  propUsage: "No props beyond the architecture",
  lighting: "Soft late-morning daylight from camera left",
  colorTreatment: "Natural, true-to-life colour",
  setContinuity: "One real shoot day on the same steps",
};

function pose(id: string, poseNumber: number, prompt = "Pose text.") {
  return {
    id, poseNumber, title: id, description: id, cameraAngle: "eye level", framing: "full body",
    bodyPosition: "standing", handPlacement: "relaxed", expression: "warm",
    highlightedDetails: [], productVisibilityRules: [], purpose: id, consistencyNotes: "", prompt,
  } as any;
}

function lockOf(prompt: string) {
  const start = prompt.indexOf("SCENE LOCK - ");
  const end = prompt.indexOf("\n\nPHOTOGRAPHIC REALISM");
  assert(start >= 0 && end > start, "the scene lock block is present");
  return prompt.slice(start, end);
}

Deno.test("Studio's Auto choice keeps the analysed set; an explicit background replaces it", () => {
  assertEquals(isAutoBackgroundStyle(AUTO_BACKGROUND_STYLE), true);
  assertEquals(isAutoBackgroundStyle(""), true);
  assertEquals(isAutoBackgroundStyle("Clean seamless white e-commerce studio with soft shadows"), false);

  assertEquals(applyRequestedBackground(PALACE_SET, AUTO_BACKGROUND_STYLE), PALACE_SET);
  assertEquals(applyRequestedBackground(PALACE_SET, ""), PALACE_SET);

  const white = applyRequestedBackground(PALACE_SET, "Clean seamless white e-commerce studio with soft shadows");
  assertEquals(white.backgroundStyle, "Clean seamless white e-commerce studio with soft shadows");
  assertEquals(white.studioEnvironment, "Clean seamless white e-commerce studio with soft shadows");
  assertEquals(white.lighting, PALACE_SET.lighting);
});

Deno.test("every frame of a shoot gets the same set lines", () => {
  const references = [{ role: "model_identity" }, { role: "front" }, { role: "approved_pose" }];
  const session = { productIdentity: { garmentFamily: "kurta_or_kurti_set" }, creativeDirection: PALACE_SET };
  const locks = [pose("angled", 2), pose("creative", 4), pose("closeup", 5), pose("showcase", 6)].map((entry) =>
    lockOf(composeGenerationPrompt({ skuName: "TOTAPURI", productDetails: "", pose: entry, session, references })),
  );
  assertEquals(new Set(locks).size, 1);
  assertStringIncludes(locks[0], PALACE_SET.backgroundStyle);
  assertStringIncludes(locks[0], "APPROVED POSE 1 in the manifest is this set as photographed");
});

Deno.test("the back view is pointed at Pose 1's set, not at a clean studio", () => {
  const prompt = composeGenerationPrompt({
    skuName: "TOTAPURI",
    productDetails: "",
    pose: pose("back", 3, "Full back view on a plain sand-coloured plaster wall."),
    session: { productIdentity: { garmentFamily: "kurta_or_kurti_set" }, creativeDirection: PALACE_SET },
    // The back pose never receives the style reference; Pose 1 carries the set.
    references: [{ role: "back" }, { role: "model_identity" }, { role: "approved_pose" }],
  });
  assertStringIncludes(prompt, "as already photographed in APPROVED POSE 1 - rebuild exactly the set Pose 1 shows, including in a back view");
  assertEquals(prompt.includes("or the clean commercial studio direction"), false);
  assertStringIncludes(prompt, PALACE_SET.backgroundStyle);
  // The Gemini pose text still reaches the model, but under the lock.
  const lockAt = prompt.indexOf("SCENE LOCK - ");
  const poseTextAt = prompt.indexOf("plain sand-coloured plaster wall");
  assert(lockAt >= 0 && poseTextAt > lockAt);
  assertStringIncludes(prompt, "(Pose, camera and framing only. The SCENE LOCK above decides the set.)");
});

Deno.test("the hero frame establishes the set; Studio's Auto sentence is never the set", () => {
  const block = sceneLockBlock({
    creativeDirection: { ...PALACE_SET, scene: AUTO_BACKGROUND_STYLE },
    poseNumber: 1,
    hasApprovedAnchor: false,
    hasStyleReference: true,
  });
  assertStringIncludes(block, "This frame establishes the set for all six frames");
  assertStringIncludes(block, "as the STYLE REFERENCE shows it");
  assertEquals(block.includes(AUTO_BACKGROUND_STYLE), false);
});

Deno.test("repeated scene values are stated once and long ones stay bounded", () => {
  const block = sceneLockBlock({
    creativeDirection: { backgroundStyle: "Warm grey studio", studioEnvironment: "warm grey studio", lighting: "x".repeat(2_000) },
    poseNumber: 2,
    hasApprovedAnchor: false,
    hasStyleReference: false,
  });
  assertEquals(block.match(/warm grey studio/gi)?.length, 1);
  assert(block.length < 1_500);
});

Deno.test("the scene lock survives prompt compaction", () => {
  const prompt = composeGenerationPrompt({
    skuName: "LONG-SESSION",
    productDetails: `notes ${"note ".repeat(12_000)}`,
    pose: pose("back", 3),
    session: {
      productIdentity: { garmentFamily: "dress", legacyVerboseCopy: "x".repeat(12_000) },
      creativeDirection: { ...PALACE_SET, mood: "m".repeat(5_000) },
      consistencyRules: Array.from({ length: 20 }, (_, index) => `rule-${index} ${"r".repeat(700)}`),
    },
    references: [{ role: "back" }, { role: "model_identity" }, { role: "approved_pose" }],
    correction: `retry ${"retry ".repeat(12_000)}`,
    learnings: `learning ${"history ".repeat(12_000)}`,
  });
  assert(prompt.length <= IMAGE_PROMPT_SAFE_CHARS);
  assertStringIncludes(prompt, "SCENE LOCK - THE SAME SET IN ALL SIX FRAMES");
  assertStringIncludes(prompt, PALACE_SET.backgroundStyle);
});

Deno.test("the analysis describes the set once instead of inside every pose prompt", () => {
  const prompt = buildCombinedAnalysisPrompt({
    skuName: "TOTAPURI", productDetails: "", category: "kurta set", modelDirection: "", sceneDirection: "",
    referenceManifest: [{ number: 1, role: "front" }, { number: 2, role: "style_reference" }],
  });
  assertStringIncludes(prompt, "SCENE IS SHARED, NOT PER POSE");
  assertEquals(prompt.includes("the exact studio/scene background and lighting inside EVERY SINGLE 'prompt' string"), false);
});
