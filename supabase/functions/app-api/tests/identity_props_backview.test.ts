import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { compactManifestBlock, composeGenerationPrompt, IMAGE_PROMPT_SAFE_CHARS } from "../lib/generationPrompt.ts";
import { buildPoseQaPrompt } from "../lib/qa.ts";
import { requestedHandheldProps, withRequestedPropsAllowed } from "../lib/profiles.ts";
import { collapseDuplicateUploads, selectReferences } from "../lib/referencePolicy.ts";

const POSE_IDS = ["full_front", "angled", "back", "creative", "closeup", "showcase"];
const PROP_NOTE = "she is hold in her hand coffee glass and hand bag as like reference image.";

function pose(id: string) {
  const poseNumber = POSE_IDS.indexOf(id) + 1;
  return {
    id, poseNumber, title: `Pose ${poseNumber} catalog`, description: "Planted catalog stance.",
    prompt: "Planted catalog stance that keeps the garment readable.", cameraAngle: "eye level", framing: "full length",
    bodyPosition: "weight on one leg", handPlacement: "relaxed", expression: "soft smile",
    highlightedDetails: ["butti"], productVisibilityRules: ["hem visible"], purpose: "sell the garment",
    consistencyNotes: "same model", enabled: true,
  } as any;
}

// A short pinstripe kurti with side slits over plain black bottoms, styled like the reported shoot.
const SESSION = {
  productIdentity: {
    garmentFamily: "kurta_or_kurti_set",
    category: "ethnic/fusion",
    mainColor: "beige",
    length: "short kurti, mid-thigh to just above knee, straight hem",
    backConstruction: "one-piece back panel with vertical pinstripes, plain round back neck, no butti, straight hem, side slits continuous from front",
    patternGeometry: { orientation: "vertical pinstripes on every panel" },
    detailPlacementMap: ["front neckline: round with center V notch", "left side slit and right side slit: high straight side slits, pinstripe on both edges"],
    bottomWearDetails: "plain black salwar with a joined hem panel",
  },
  creativeDirection: { backgroundStyle: "Stone facade with a black door and a flower planter" },
  modelIdentity: { face: "oval face, long dark wavy hair" },
  stylingPlan: { footwear: "tan juttis", jewellery: "thin gold chain", ornaments: "none - no tote, no coffee cup, no sunglasses", makeup: "natural", hair: "loose waves" },
};
// The collapsed upload as the worker now orders it: the shared photo first, in the identity slot.
const FRONT_REFS = [{ role: "style_reference" }, { role: "front" }, { role: "bottom" }, { role: "back" }, { role: "fabric_pattern" }];
const BACK_REFS = [{ role: "back" }, { role: "bottom" }, { role: "style_reference" }];

function compose(id: string, productDetails: string, references = FRONT_REFS) {
  return composeGenerationPrompt({
    skuName: "BEIGE-KURTI", productDetails, pose: pose(id), session: SESSION, references, useStyleReferenceAsModelIdentity: true,
  });
}

Deno.test("requested props come only from holding sentences in the notes", () => {
  assertEquals(requestedHandheldProps(`Beige pinstripe kurti with glass bead work. ${PROP_NOTE}`).groups, ["drink", "bag"]);
  assertEquals(requestedHandheldProps("Model carrying a woven tote bag").groups, ["bag"]);
  for (const note of ["hand embroidery with glass beads; cup sleeves", "No coffee cup or bag, please.", "Do not hold a bag.", ""]) {
    assertEquals(requestedHandheldProps(note).groups, [], note);
  }
});

Deno.test("withRequestedPropsAllowed narrows bans to unrequested props and drops 'no <prop>' clauses", () => {
  const props = requestedHandheldProps(PROP_NOTE);
  const text = "Never copy handheld props (coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones). ornaments: no tote, no coffee cup, no sunglasses";
  const out = withRequestedPropsAllowed(text, props);
  assertEquals(out, "Never copy unrequested handheld props (any prop the product notes did not request). ornaments: no sunglasses");
  assertEquals(withRequestedPropsAllowed(text, { groups: [] }), text);
});

Deno.test("a shared face/style photo keeps the identity slot and is sent once", () => {
  const references = [
    { role: "model_identity", hash: "shared" }, { role: "front", hash: "f" }, { role: "bottom", hash: "b" },
    { role: "back", hash: "r" }, { role: "style_reference", hash: "shared" },
  ];
  assertEquals(selectReferences(references, [], "full_front", "kurta_or_kurti_set").map((r) => r.role), ["style_reference", "front", "bottom", "back"]);
  assertEquals(selectReferences(references, [], "back", "kurta_or_kurti_set").map((r) => r.role), ["back", "bottom", "style_reference"]);
  assertEquals(collapseDuplicateUploads([{ role: "front", hash: "f" }, { role: "style_reference", hash: "s" }]).map((r) => r.role), ["front", "style_reference"]);
});

Deno.test("requested props carry over in every frame except the Pose 5 crop, and the generic bans narrow", () => {
  for (const id of ["full_front", "angled", "creative", "showcase"]) {
    const prompt = compose(id, `Beige kurti. ${PROP_NOTE}`);
    assertStringIncludes(prompt, "REQUESTED PROPS (FROM THE PRODUCT NOTES - CARRY THEM OVER)");
    assertStringIncludes(prompt, "one hand holds the drink");
    assertStringIncludes(prompt, "exactly two arms and two hands");
    assert(!prompt.includes("handheld coffee cups/totes/bags"), id);
    assert(!prompt.includes("no coffee cup"), id);
    assert(!prompt.includes("no tote"), id);
    assert(prompt.length <= IMAGE_PROMPT_SAFE_CHARS);
  }
  assertStringIncludes(compose("closeup", `Beige kurti. ${PROP_NOTE}`), "This Pose 5 craft crop keeps every prop out of frame");
  const back = compose("back", `Beige kurti. ${PROP_NOTE}`, BACK_REFS);
  assertStringIncludes(back, "the bag hangs from one shoulder or forearm at the side");
  assertStringIncludes(back, "must not cover the back neckline, the stripes or print, the side slits or the hem");
});

Deno.test("without a prop request the prompt keeps every no-props rule and gains no props block", () => {
  const prompt = compose("full_front", "Beige kurti with black salwar");
  assert(!prompt.includes("REQUESTED PROPS"));
  assertStringIncludes(prompt, "handheld coffee cups/totes/bags");
});

Deno.test("the identity check names the identity image and the face lock asks for face, skin tone and hair", () => {
  const front = compose("full_front", "Beige kurti");
  assertStringIncludes(front, "IDENTITY CHECK: the face, skin tone and hair must match IMAGE 1 (the photo uploaded as both MODEL FACE REFERENCE and STYLE REFERENCE) exactly");
  assertStringIncludes(front, "The STYLE REFERENCE image (IMAGE 1) is the face for every pose");
  assertStringIncludes(front, "IMAGE 1: MODEL FACE REFERENCE + STYLE REFERENCE (the same photo was uploaded as both)");
  assertStringIncludes(compose("back", "Beige kurti", BACK_REFS), "IDENTITY CHECK: the face is turned away, but the skin tone, hair colour, length and texture, and body proportions must match IMAGE 3");
});

Deno.test("the back view gets the recorded rear facts the evidence filter drops", () => {
  const back = compose("back", "Beige kurti", BACK_REFS);
  assertStringIncludes(back, "REAR VIEW CHECKLIST");
  assertStringIncludes(back, "- Length and hem: short kurti, mid-thigh to just above knee, straight hem; the back hem sits at the same height as the front hem.");
  assertStringIncludes(back, "side slits continuous from front");
  assertStringIncludes(back, "- Print or stripe direction: vertical pinstripes on every panel");
  assertStringIncludes(back, "high straight side slits");
  assertStringIncludes(back, "- Bottom wear from behind:");
  // The checklist never names front-only placement such as the neckline notch.
  assert(!back.slice(back.indexOf("REAR VIEW CHECKLIST")).includes("center V notch"));
  assert(!compose("full_front", "Beige kurti").includes("REAR VIEW CHECKLIST"));
});

Deno.test("QA expects the requested props and stops failing them as copied props", () => {
  const props = requestedHandheldProps(PROP_NOTE);
  const qa = (poseType: string, requestedProps = props) => buildPoseQaPrompt({
    poseNumber: POSE_IDS.indexOf(poseType) + 1, poseType, poseTitle: "Pose", poseDirection: pose(poseType),
    productIdentity: SESSION.productIdentity, creativeDirection: SESSION.creativeDirection, modelIdentity: SESSION.modelIdentity,
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: false, hasModelReference: false,
    referenceManifest: ["IMAGE 1: STYLE REFERENCE"], useStyleAsModelFace: true, requestedProps,
  });
  const front = qa("full_front");
  assertStringIncludes(front, "REQUESTED PROPS: the product notes ask for the drink (cup or glass) and the bag");
  assertStringIncludes(front, "Fail pose_requirement when a requested prop is missing");
  assert(!front.includes("(coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones)"));
  assertStringIncludes(qa("back"), "a prop the body hides from behind is acceptable");
  assertStringIncludes(qa("closeup"), "this Pose 5 craft crop keeps props out of frame");
  const none = qa("full_front", { groups: [], labels: [], note: "" });
  assert(!none.includes("REQUESTED PROPS"));
  assertStringIncludes(none, "(coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones)");
});

Deno.test("manifest compaction keeps a label for every attached image", () => {
  const lines = Array.from({ length: 7 }, (_, index) => `IMAGE ${index + 1}: ROLE ${index + 1} - ${"long authority text ".repeat(20)}`);
  const prompt = ["Intro", "REFERENCE MANIFEST IN UPLOAD ORDER:", ...lines, "", "EDIT GOAL:", "rest"].join("\n");
  const compacted = compactManifestBlock(prompt, 1_200);
  for (let index = 1; index <= 7; index++) assertStringIncludes(compacted, `IMAGE ${index}: ROLE ${index} - `);
  assert(compacted.length < prompt.length);
  assert(compacted.endsWith(["", "EDIT GOAL:", "rest"].join("\n")));
  const short = ["Intro", "REFERENCE MANIFEST IN UPLOAD ORDER:", "IMAGE 1: FRONT", "", "EDIT GOAL:"].join("\n");
  assertEquals(compactManifestBlock(short, 1_200), short);
});
