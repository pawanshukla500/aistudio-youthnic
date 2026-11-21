import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { compactManifestBlock, composeGenerationPrompt, IMAGE_PROMPT_SAFE_CHARS, rearViewChecklist, requestedPropsBlock } from "../lib/generationPrompt.ts";
import { buildPoseQaPrompt } from "../lib/qa.ts";
import { frameExpressionDirection, withoutExpressionWords, withoutGazeWords } from "../lib/expressionDirection.ts";
import { requestedHandheldProps, withoutNegatedRequestedProps, withRequestedPropsAllowed } from "../lib/profiles.ts";
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

Deno.test("withRequestedPropsAllowed narrows only the fixed ban phrases and never deletes product text", () => {
  const props = requestedHandheldProps(PROP_NOTE);
  const text = "Never copy handheld props (coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones). No flowers on the back panel; no padded cups. Never let the bag strap cross the yoke.";
  const out = withRequestedPropsAllowed(text, props);
  assertEquals(out, "Never copy unrequested handheld props (any prop the product notes did not request). No flowers on the back panel; no padded cups. Never let the bag strap cross the yoke.");
  assertEquals(withRequestedPropsAllowed(text, { groups: [] }), text);
  // Styling lists drop only the entries that exclude a requested prop, including a bare prop inside a negated list.
  assertEquals(withoutNegatedRequestedProps("none - no dupatta, stole, bag included with SKU; no tote, no coffee cup, no sunglasses", props), "none - no dupatta, stole included with SKU; no sunglasses");
  assertEquals(withoutNegatedRequestedProps("no tote, no coffee cup", { groups: [] }), "no tote, no coffee cup");
});

Deno.test("a shared face/style photo keeps the identity slot and is sent once", () => {
  const references = [
    { role: "model_identity", hash: "shared" }, { role: "front", hash: "f" }, { role: "bottom", hash: "b" },
    { role: "back", hash: "r" }, { role: "style_reference", hash: "shared" },
  ];
  assertEquals(selectReferences(references, [], "full_front", "kurta_or_kurti_set").map((r) => r.role), ["style_reference", "front", "bottom", "back"]);
  assertEquals(selectReferences(references, [], "back", "kurta_or_kurti_set").map((r) => r.role), ["back", "bottom", "style_reference"]);
  assertEquals(collapseDuplicateUploads([{ role: "front", hash: "f" }, { role: "style_reference", hash: "s" }]).map((r) => r.role), ["front", "style_reference"]);
  const shared = [{ role: "model_identity", hash: "x" }, { role: "front", hash: "f" }, { role: "style_reference", hash: "x" }];
  assertEquals(collapseDuplicateUploads(shared).map((r) => r.role), ["front", "style_reference"]);
  assertEquals(collapseDuplicateUploads(shared, { identitySlot: true }).map((r) => r.role), ["style_reference", "front"]);
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
  assertStringIncludes(compose("closeup", `Beige kurti. ${PROP_NOTE}`), "This tight detail crop keeps every prop out of frame");
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
  const back = compose("back", "Beige kurti", BACK_REFS);
  assertStringIncludes(back, "IDENTITY CHECK: the face is turned away, but the skin tone, hair colour and texture, and body proportions must match IMAGE 3");
  // The last line the model reads must not ask for the hair length, which kept the hair down the back.
  assertStringIncludes(back, "Bring all the hair forward over one shoulder (a loose side ponytail or braid resting on the front of that shoulder is fine), so the back neckline and the whole upper back are bare to the camera: no hair hangs down the centre of the back.");
  assert(!back.includes("hair colour, length and texture, and body proportions"));
  assert(!back.includes("Keep hair color/style"));
});

Deno.test("requested props match the props Pose 1 carries and never come from a product photo", () => {
  const props = requestedHandheldProps(PROP_NOTE);
  const anchored = requestedPropsBlock(props, "showcase", false, true, true);
  assertStringIncludes(anchored, "exactly as the STYLE REFERENCE shows them (same object, shape, colour, material and size) - where APPROVED POSE 1 already shows them, the very same objects it carries, identical in every frame");
  assertStringIncludes(anchored, "A bag, drink or other object a product photo shows is that photo's own styling, not part of this product");
  assert(!anchored.includes("a prop that is part of the product follows the product photos"));
  assert(!requestedPropsBlock(props, "full_front").includes("APPROVED POSE 1"));
  const qa = buildPoseQaPrompt({
    poseNumber: 6, poseType: "showcase", poseTitle: "Pose", poseDirection: pose("showcase"),
    productIdentity: SESSION.productIdentity, creativeDirection: SESSION.creativeDirection, modelIdentity: SESSION.modelIdentity,
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: true, hasModelReference: false,
    referenceManifest: ["IMAGE 1: STYLE REFERENCE", "IMAGE 2: FRONT PRODUCT", "IMAGE 3: APPROVED POSE 1"], requestedProps: props,
  });
  assertStringIncludes(qa, "does not match the STYLE REFERENCE object or differs from the one APPROVED POSE 1 carries (when it shows one) (a bag or drink taken from a product photo fails unless the product notes say it is sold with the product)");
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

Deno.test("prop requests ignore colour, sleeve and garment names, other verbs' objects and negated clauses", () => {
  for (const note of [
    "Umbrella kurta set with dupatta held in one hand.",
    "Kurta in two shades of blue, model holding the dupatta in one hand.",
    "Model holding the coffee brown dupatta",
    "Matcha green kurta set, dupatta held in one hand.",
    "Model holding dupatta, cup sleeves and pleated hem.",
    "Kurta with bag sleeves, model holding the dupatta",
    "Hand-embroidered flowers, model holding the dupatta",
    "coffee glass hold nahi karna, bag bhi nahi",
    "bag mat pakdo, sirf dupatta hold karo",
  ]) assertEquals(requestedHandheldProps(note).groups, [], note);
  // The negation belongs to its own clause only.
  assertEquals(requestedHandheldProps("She holds a coffee cup, no sunglasses.").groups, ["drink"]);
  assertEquals(requestedHandheldProps("Hold the bag but don't cover the embroidery.").groups, ["bag"]);
  assertEquals(requestedHandheldProps("Holding a coffee glass and a handbag as in the reference image, not covering the print.").groups, ["drink", "bag"]);
  assertEquals(requestedHandheldProps("coffee in hand").groups, ["drink"]);
  assertEquals(requestedHandheldProps("sling bag on her shoulder").groups, ["bag"]);
  assertEquals(requestedHandheldProps("haath mein coffee pakde hue").groups, ["drink"]);
});

Deno.test("the props prompt keeps its compaction markers and drops the contradicting hand and ornament lines", () => {
  // Notes with a trailing negated clause and no full stop once merged the notes into the next marker.
  const notes = `${"Beige pinstripe kurti, red butti, notch neckline. ".repeat(30)}Holding a tote bag like the reference image. No bag strap over the yoke`;
  const prompt = compose("full_front", notes);
  assert(prompt.length <= IMAGE_PROMPT_SAFE_CHARS);
  assert(prompt.length > 20_000, `prompt collapsed to ${prompt.length} characters`);
  assertStringIncludes(prompt, "Output only the finished photograph");
  assertStringIncludes(prompt, "REQUESTED PROPS (FROM THE PRODUCT NOTES - CARRY THEM OVER)");
  assertStringIncludes(prompt, "IDENTITY CHECK");
  assert(!prompt.includes("holding nothing copied from the style or model photo"));
  const props = compose("full_front", `Beige kurti. ${PROP_NOTE}`);
  assertStringIncludes(props, "- Ornaments and accessories: none");
  assert(!/- Ornaments and accessories: \n/.test(props));
});

Deno.test("without a style reference the props come from the notes, in the prompt and in QA", () => {
  const props = requestedHandheldProps(PROP_NOTE);
  const block = requestedPropsBlock(props, "full_front", false, false);
  assertStringIncludes(block, "as the notes describe them (no style reference is attached");
  assert(!block.includes("STYLE REFERENCE"));
  const qa = buildPoseQaPrompt({
    poseNumber: 1, poseType: "full_front", poseTitle: "Pose", poseDirection: pose("full_front"),
    productIdentity: SESSION.productIdentity, creativeDirection: SESSION.creativeDirection, modelIdentity: SESSION.modelIdentity,
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: false, hasModelReference: false,
    referenceManifest: ["IMAGE 1: FRONT PRODUCT"], requestedProps: props,
  });
  assertStringIncludes(qa, "does not match what the notes describe");
  assert(!qa.includes("does not match the STYLE REFERENCE object"));
  // CodeAnt's examples: a negated clause keeps the affirmative one; embroidery is not a prop.
  assertEquals(requestedHandheldProps("She holds a coffee cup, not a bag").groups, ["drink"]);
  assertEquals(requestedHandheldProps("She holds the kurti with flower embroidery").groups, []);
});

Deno.test("prop requests skip shape, pocket and table uses and read right/left hands and Hinglish holds", () => {
  for (const note of [
    "Model holding dupatta in hand and the kurta has an umbrella shape",
    "Model holding the dupatta, the kurta has a bag-style pocket",
    "Model holding the pallu, the coffee table stays out of frame",
    "She holds the dupatta over her shoulder with flowers printed on the border",
    "She is carrying the dupatta and the kurta has bell sleeves with phone pocket",
    "Model holding the dupatta in maroon shades",
  ]) assertEquals(requestedHandheldProps(note).groups, [], note);
  assertEquals(requestedHandheldProps("Holding a handbag that does not cover the print").groups, ["bag"]);
  assertEquals(requestedHandheldProps("She carries a tote bag which should not hide the embroidery").groups, ["bag"]);
  assertEquals(requestedHandheldProps("Model holding coffee glass and hand bag like reference no sunglasses").groups, ["drink", "bag"]);
  assertEquals(requestedHandheldProps("she has a coffee glass in her right hand and a handbag on her left shoulder").groups, ["drink", "bag"]);
  assertEquals(requestedHandheldProps("Coffee glass in right hand and bag on shoulder").groups, ["drink", "bag"]);
  assertEquals(requestedHandheldProps("model ke haath mein coffee aur bag ho").groups, ["drink", "bag"]);
  assertEquals(requestedHandheldProps("coffee glass hold kare aur hand bag liye").groups, ["drink", "bag"]);
  assertEquals(requestedHandheldProps("holding a coffee cup on a mat finish tray").groups, ["drink"]);
});

Deno.test("'ke liye' is not a hold, and a negation before the verb's own clause does not cancel a later prop", () => {
  for (const note of [
    "Office ke liye flowers wali kurti",
    "Shaadi ke liye umbrella frock",
    "Party ke liye phone cover jaisa print",
    "Umbrella frock with dupatta in one hand",
    "haath mein dupatta aur kurta pe flowers ka print",
  ]) assertEquals(requestedHandheldProps(note).groups, [], note);
  assertEquals(requestedHandheldProps("coffee glass hath me aur bag kandhe pe").groups, ["drink", "bag"]);
  assertEquals(requestedHandheldProps("bag liye hue model").groups, ["bag"]);
  assertEquals(requestedHandheldProps("Without dupatta she holds a coffee glass and a bag").groups, ["drink", "bag"]);
  assertEquals(requestedHandheldProps("she does not wear a dupatta and holds a coffee glass").groups, ["drink"]);
  assertEquals(requestedHandheldProps("Do not hold a bag").groups, []);
});

Deno.test("the ornaments line keeps requested props but still drops unrequested props and stride text", () => {
  const session = {
    ...SESSION,
    stylingPlan: { ...SESSION.stylingPlan, ornaments: "beige woven tote and iced coffee from the style reference; black sunglasses held in the left hand; walking stride with the bag swinging; no coffee cup" },
  };
  const prompt = composeGenerationPrompt({
    skuName: "BEIGE-KURTI", productDetails: `Beige kurti. ${PROP_NOTE}`, pose: pose("full_front"), session, references: FRONT_REFS, useStyleReferenceAsModelIdentity: true,
  });
  const line = prompt.slice(prompt.indexOf("- Ornaments and accessories:"), prompt.indexOf("\n", prompt.indexOf("- Ornaments and accessories:")));
  assertStringIncludes(line, "beige woven tote and iced coffee from the style reference");
  assert(!line.includes("sunglasses"), line);
  assert(!line.includes("walking stride"), line);
  assert(!line.includes("no coffee cup"), line);
});

Deno.test("a tight crop keeps the no-props rules and lists no props; an emptied list falls back", () => {
  const closeup = compose("closeup", `Beige kurti. ${PROP_NOTE}`);
  assertStringIncludes(closeup, "This tight detail crop keeps every prop out of frame");
  assert(!closeup.includes("holding only the requested props"));
  assertEquals(withoutNegatedRequestedProps("none - no tote, no coffee cup", requestedHandheldProps(PROP_NOTE)), "");
  const emptied = composeGenerationPrompt({
    skuName: "BEIGE-KURTI", productDetails: `Beige kurti. ${PROP_NOTE}`, pose: pose("full_front"),
    session: { ...SESSION, stylingPlan: { ...SESSION.stylingPlan, ornaments: "none - no tote, no coffee cup" } },
    references: FRONT_REFS, useStyleReferenceAsModelIdentity: true,
  });
  assertStringIncludes(emptied, "- Ornaments and accessories: none besides the requested props");
});

Deno.test("tight crops keep props out of frame and extra props never need a third hand", () => {
  const props = requestedHandheldProps("She is holding a coffee cup, a tote bag and a phone as in the reference image.");
  assertEquals(props.groups, ["drink", "bag", "phone"]);
  assertStringIncludes(requestedPropsBlock(props, "showcase", true), "This tight detail crop keeps every prop out of frame");
  assertStringIncludes(requestedPropsBlock(props, "full_front"), "never a third hand");
  assertEquals(requestedPropsBlock({ groups: [], labels: [], note: "" }, "full_front"), "");
});

Deno.test("the identity check skips faceless crops", () => {
  const productDetail = composeGenerationPrompt({
    skuName: "BEIGE-KURTI", productDetails: "Beige kurti", pose: pose("closeup"),
    session: { ...SESSION, creativeDirection: { ...SESSION.creativeDirection, closeupMode: "product_detail" } },
    references: FRONT_REFS, useStyleReferenceAsModelIdentity: true,
  });
  assert(!productDetail.includes("IDENTITY CHECK"));
  assertStringIncludes(compose("closeup", "Beige kurti"), "IDENTITY CHECK");
});

Deno.test("the rear checklist keeps high-low hems uneven and takes only real side slits", () => {
  const checklist = rearViewChecklist({
    length: "high-low hem: front hem at mid-thigh, back hem longer at the knee",
    detailPlacementMap: ["front placket: center front slit with three button loops", "hem: straight, no side slits"],
  }, false);
  assertStringIncludes(checklist, "back hem longer at the knee.");
  assert(!checklist.includes("same height as the front hem"));
  assert(!checklist.includes("Side slits"));
  assertEquals(rearViewChecklist({}, false), "");
});

Deno.test("requested props never push the prompt into the emergency cut that drops ALLOWED DELTA", () => {
  // The props rewrite changes the SET ONLY line, which compaction must still find.
  const session = {
    ...SESSION,
    creativeDirection: { ...SESSION.creativeDirection, mood: "relaxed cafe date ".repeat(120), composition: "centered full model ".repeat(120) },
  };
  const notes = `${"Beige pinstripe kurti, red butti, notch neckline, high side slits. ".repeat(60)}${PROP_NOTE}`;
  for (const id of ["full_front", "angled", "back", "showcase"]) {
    const prompt = composeGenerationPrompt({
      skuName: "BEIGE-KURTI", productDetails: notes, pose: pose(id), session, references: id === "back" ? BACK_REFS : FRONT_REFS, useStyleReferenceAsModelIdentity: true,
    });
    assert(prompt.length <= IMAGE_PROMPT_SAFE_CHARS, id);
    assert(!prompt.includes("[Background and auxiliary sections compacted]"), `${id} hit the emergency cut`);
    assertStringIncludes(prompt, "ALLOWED DELTA - THE ONLY THINGS THAT MAY CHANGE:");
    assertStringIncludes(prompt, "PROHIBITED UNRELATED CHANGES:");
    assertStringIncludes(prompt, "or unrequested handheld props.\n");
  }
});

Deno.test("a bare prop in a negated styling list is dropped, keeping the list's trailing words", () => {
  const props = requestedHandheldProps(PROP_NOTE);
  assertEquals(
    withoutNegatedRequestedProps("none - no dupatta, stole, scarf, belt, bag included with SKU; no tote, no coffee cup, no sunglasses", props),
    "none - no dupatta, stole, scarf, belt included with SKU; no sunglasses",
  );
  assertEquals(withoutNegatedRequestedProps("no dupatta, bag, belt", props), "no dupatta, belt");
  assertEquals(withoutNegatedRequestedProps("no dupatta, bag-style pocket", props), "no dupatta, bag-style pocket");
  assertEquals(withoutNegatedRequestedProps("silver bangles, tote bag on shoulder", props), "silver bangles, tote bag on shoulder");
  assertEquals(withoutNegatedRequestedProps("no dupatta, stole; bag on shoulder", props), "no dupatta, stole; bag on shoulder");
  assertEquals(withoutNegatedRequestedProps("no dupatta, belt, bag included with SKU", { groups: [] }), "no dupatta, belt, bag included with SKU");
  // A prop with a placement, or after an explicit negation, is a positive entry and stays verbatim.
  for (const text of [
    "no dupatta, tote bag on shoulder",
    "no dupatta, bag and coffee cup in hand",
    "no dupatta, silver bangles, bag on shoulder",
    "no dupatta, glass of iced coffee in right hand",
    "no dupatta, silver bangles on wrist, bag",
  ]) assertEquals(withoutNegatedRequestedProps(text, props), text);
  assertEquals(withoutNegatedRequestedProps("no dupatta, no bag, tote included; no sunglasses", props), "no dupatta, tote included; no sunglasses");
  // A negated garment detail named after a prop is a garment constraint and stays.
  assertEquals(withoutNegatedRequestedProps("no bag-style pocket; no coffee brown tones", props), "no bag-style pocket; no coffee brown tones");
  assertEquals(withoutNegatedRequestedProps("no bag of any kind; silver studs", props), "silver studs");
});

Deno.test("the hand placement line hands the requested props to the props block, except in a tight crop", () => {
  const hands = (id: string, notes: string) => {
    const prompt = compose(id, notes);
    const at = prompt.indexOf("- Hand placement:");
    return prompt.slice(at, prompt.indexOf("\n", at));
  };
  assertStringIncludes(hands("angled", `Beige kurti. ${PROP_NOTE}`), "the hands carry the requested props exactly as the REQUESTED PROPS line directs");
  assert(!hands("angled", "Beige kurti.").includes("requested props"));
  assert(!hands("closeup", `Beige kurti. ${PROP_NOTE}`).includes("requested props"));
});

Deno.test("QA reads only the pose plan, never earlier verdicts stored on the pose row", () => {
  const stored = {
    ...pose("showcase"),
    poseNumber: 6,
    correction: "EARLIER VERDICT: the black trousers read as a harem salwar",
    corrections: ["EARLIER VERDICT: the black trousers read as a harem salwar"],
    rejectedAttempts: [{ attempt: 1, reason: "EARLIER VERDICT: Critical attributes far below the product references" }],
    referenceManifests: [{ manifest: ["EARLIER MANIFEST LINE"] }],
    lastDnaFailed: { failed: ["shape"] },
  };
  const qa = buildPoseQaPrompt({
    poseNumber: 6, poseType: "showcase", poseTitle: "Pose", poseDirection: stored,
    productIdentity: SESSION.productIdentity, creativeDirection: SESSION.creativeDirection, modelIdentity: SESSION.modelIdentity,
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: true, hasModelReference: false,
    referenceManifest: ["IMAGE 1: STYLE REFERENCE", "IMAGE 2: FRONT PRODUCT"],
  });
  assert(!qa.includes("EARLIER VERDICT"));
  assert(!qa.includes("EARLIER MANIFEST LINE"));
  assert(!qa.includes("lastDnaFailed"));
  assertStringIncludes(qa, `"poseNumber":6`);
  assertStringIncludes(qa, JSON.stringify(pose("showcase").title));
});

Deno.test("the identity cleaner drops only expression phrases and keeps every facial feature", () => {
  assertEquals(withoutExpressionWords("almond-shaped dark brown eyes with a soft gaze, straight nose"), "almond-shaped dark brown eyes, straight nose");
  assertEquals(withoutExpressionWords("oval face, almond dark brown eyes and a gentle smile, straight nose"), "oval face, almond dark brown eyes, straight nose");
  assertEquals(withoutExpressionWords("full slightly pouty lips"), "full slightly pouty lips");
  assertEquals(withoutExpressionWords("Oval face with almond eyes and full lips that curve into a soft smile"), "Oval face with almond eyes and full lips");
  // Nothing left would be worse than the original.
  assertEquals(withoutExpressionWords("calm composed gaze"), "calm composed gaze");
});

Deno.test("a planner mood loses its gaze clause but keeps its mouth", () => {
  assertEquals(withoutGazeWords("calm soft smile with relaxed eyes"), "calm soft smile");
  assertEquals(withoutGazeWords("warm open smile and bright eyes"), "warm open smile");
  assertEquals(withoutGazeWords("soft smile, facing the camera directly"), "soft smile");
  assertEquals(withoutGazeWords("soft smile toward the lens"), "soft smile");
  assertEquals(withoutGazeWords("quiet, warm half-smile"), "quiet, warm half-smile");
});

Deno.test("the frame direction respects seated and adopted bodies, the real face source and the frame's framing", () => {
  const seated = frameExpressionDirection({ poseId: "creative", bodyOwner: "seated", faceSource: "APPROVED POSE 1", hasApprovedAnchor: true })!;
  assert(!seated.block.includes("weight on the back leg"));
  assertStringIncludes(seated.block, "an easy seated gesture");
  const adopted = frameExpressionDirection({ poseId: "showcase", bodyOwner: "reference", faceSource: "APPROVED POSE 1", hasApprovedAnchor: true })!;
  assertStringIncludes(adopted.block, "the body exactly as the REFERENCE POSE MATCH block sets it");
  assert(!adopted.block.includes("weight rests on one leg"));
  const look = { expression: "dreamy half-smile", gaze: "eyes lowered to the left", hands: "", cameraAngle: "eye-level three-quarter, knees-up" };
  const camera = frameExpressionDirection({ poseId: "creative", bodyOwner: "reference", reference: look, faceSource: "APPROVED POSE 1", hasApprovedAnchor: true, styleFaceForbidden: true })!;
  assertStringIncludes(camera.block, "Camera: eye-level three-quarter, as the STYLE REFERENCE is shot, within this frame's ALLOWED DELTA framing.");
  assert(!camera.block.includes("knees-up"));
  assertStringIncludes(camera.block, "Copy only the face itself from APPROVED POSE 1, never APPROVED POSE 1's expression, gaze or head tilt. Take only the look from the STYLE REFERENCE person, never their face.");
  // A fresh-cast Pose 1 names the description it actually has, not images that are not attached.
  const fresh = frameExpressionDirection({ poseId: "full_front", faceSource: "the modelIdentity description" })!;
  assertStringIncludes(fresh.block, "Copy only the face itself from the modelIdentity description, never their expression, gaze or head tilt.");
  assert(!fresh.block.includes("APPROVED POSE 1"));
  const face = frameExpressionDirection({ poseId: "angled", faceSource: "the MODEL FACE REFERENCE", hasApprovedAnchor: true })!;
  assertStringIncludes(face.block, "Copy only the face itself from the MODEL FACE REFERENCE and APPROVED POSE 1, never their expression, gaze or head tilt.");
});

Deno.test("QA reads the face lock without expression words and no stale per-pose expression", () => {
  const qa = buildPoseQaPrompt({
    poseNumber: 2, poseType: "angled", poseTitle: "Pose", poseDirection: { ...pose("angled"), expression: "STALE soft smile, eyes to camera" },
    productIdentity: SESSION.productIdentity, creativeDirection: SESSION.creativeDirection,
    modelIdentity: { face: "almond dark brown eyes glancing sideways, full natural lips in soft closed-mouth smile" },
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: true, hasModelReference: false,
    referenceManifest: ["IMAGE 1: STYLE REFERENCE", "IMAGE 2: FRONT PRODUCT"],
  });
  assert(!qa.includes("STALE soft smile"));
  assert(!qa.includes("glancing sideways"));
  assertStringIncludes(qa, "almond dark brown eyes, full natural lips");
});

Deno.test("back-view QA judges hair by a visible garment back, not by one hairstyle", () => {
  const qa = (poseType: string) => buildPoseQaPrompt({
    poseNumber: poseType === "back" ? 3 : 2, poseType, poseTitle: "Pose", poseDirection: pose(poseType),
    productIdentity: SESSION.productIdentity, creativeDirection: SESSION.creativeDirection, modelIdentity: SESSION.modelIdentity,
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: true, hasModelReference: false,
    referenceManifest: ["IMAGE 1: BACK PRODUCT", "IMAGE 2: STYLE REFERENCE"],
  });
  assertStringIncludes(qa("back"), "pass it when the back neckline and the upper back panel are clearly visible, whether the hair is swept forward over a shoulder, up in a bun or ponytail, or ends above the neckline.");
  // The plan's literal hairstyle ("swept forward over one shoulder") must not fail a back that shows.
  assertStringIncludes(qa("back"), "This overrides any hairstyle wording in the pose or styling plan");
  // The hairstyle the prompt allows (forward, side ponytail, braid) never fails the face check either.
  assertStringIncludes(qa("back"), "never fail model_face because the hair was moved forward, tied or put up to clear the garment back: judge the hair there by colour and texture only.");
  assert(!qa("angled").includes("judge hair placement by its purpose"));
});

Deno.test("back-view QA never reads the plan's literal hair clauses; other poses keep them", () => {
  const plan = {
    ...pose("back"),
    bodyPosition: "standing with back fully to camera, shoulders square away, hair swept forward over front to keep back neckline clear, feet close",
    productVisibilityRules: ["full rear neckline visible", "hair forward to clear back"],
  };
  const qa = (poseType: string) => buildPoseQaPrompt({
    poseNumber: poseType === "back" ? 3 : 2, poseType, poseTitle: "Pose", poseDirection: { ...plan, id: poseType },
    productIdentity: SESSION.productIdentity, creativeDirection: SESSION.creativeDirection, modelIdentity: SESSION.modelIdentity,
    garmentFamily: "kurta_or_kurti_set", consistencyRules: [], hasApprovedAnchor: true, hasModelReference: false,
    referenceManifest: ["IMAGE 1: BACK PRODUCT", "IMAGE 2: STYLE REFERENCE"],
  });
  const back = qa("back");
  assert(!back.includes("hair forward to clear back"));
  assert(!back.includes("hair swept forward over front"));
  assertStringIncludes(back, "full rear neckline visible");
  assertStringIncludes(back, "standing with back fully to camera, shoulders square away, feet close");
  assertStringIncludes(qa("angled"), "hair forward to clear back");
});
