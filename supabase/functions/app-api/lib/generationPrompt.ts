import {
  CONSISTENCY_RULES,
  normalizeStylingPlan,
  type JsonRecord,
  type StudioPose,
  sanitizeDetailPlacementMap,
} from "./profiles.ts";
import { isDirectBackProductRole, roleLabel } from "./referencePolicy.ts";

export type PromptReference = { role: string };

// OpenAI rejects image-edit prompts at 32,000 characters. Keep a meaningful
// UTF-16-safe margin because PostgreSQL character counts and the provider's
// request validation can differ for non-BMP characters.
export const IMAGE_PROMPT_SAFE_CHARS = 31_500;

export class GenerationPromptBudgetError extends Error {
  readonly code = "prompt_budget_exceeded";

  constructor(section: string, chars: number, limit: number) {
    super(`${section} is too large for a safe image-generation prompt (${chars} characters; limit ${limit}). Reanalyse the product references before generation.`);
    this.name = "GenerationPromptBudgetError";
  }
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function boundedText(value: unknown, maxChars: number) {
  const text = String(value ?? "").trim();
  if (text.length <= maxChars) return text;
  const suffix = " [truncated]";
  return `${text.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

function boundedStrings(value: unknown, maxItems = 16, maxChars = 360) {
  return (Array.isArray(value) ? value : []).slice(0, maxItems).map((entry) => boundedText(entry, maxChars));
}

function compactJson(value: unknown, options: { maxString?: number; maxItems?: number; maxKeys?: number; maxDepth?: number } = {}) {
  const maxString = options.maxString ?? 480;
  const maxItems = options.maxItems ?? 16;
  const maxKeys = options.maxKeys ?? 40;
  const maxDepth = options.maxDepth ?? 5;
  const compact = (input: unknown, depth = 0): unknown => {
    if (typeof input === "string") return boundedText(input, maxString);
    if (Array.isArray(input)) return input.slice(0, maxItems).map((entry) => compact(entry, depth + 1));
    if (input && typeof input === "object") {
      if (depth >= maxDepth) return "[nested detail omitted]";
      return Object.fromEntries(
        Object.entries(input as JsonRecord).slice(0, maxKeys).map(([key, entry]) => [key, compact(entry, depth + 1)]),
      );
    }
    return input;
  };
  return JSON.stringify(compact(value)) ?? "";
}

function knownFields(value: unknown, fields: string[]) {
  const source = objectValue(value);
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

function canonicalSareeTruth(value: unknown) {
  const truth = objectValue(value);
  const regionEvidence = Array.isArray(truth.regionEvidence) ? truth.regionEvidence : [];
  return {
    body: knownFields(truth.body, [
      "mainFabric", "weave", "weaveGeometry", "texture", "transparency", "shine", "baseColor", "secondaryColors", "pattern", "motifInventory", "motifScale", "motifOrientation", "motifRepeat", "motifDensity", "motifPlacement", "embellishment", "bodyOrientation",
    ]),
    borders: knownFields(truth.borders, [
      "upperBorder", "lowerBorder", "borderWidth", "upperBorderWidth", "lowerBorderWidth", "borderColors", "construction", "motifGeometry", "edgeTreatment", "continuityRules", "tasselColor", "tasselConstruction", "tasselSpacing",
    ]),
    pallu: knownFields(truth.pallu, [
      "hasDistinctPallu", "startingRegion", "baseColor", "motifInventory", "motifScale", "motifOrientation", "motifRepeat", "motifDensity", "borders", "artwork", "zari", "embroidery", "tassels", "edgeTreatment", "visualOrientation", "evidenceReferences", "uncertainty",
    ]),
    pleatZone: knownFields(truth.pleatZone, ["patternBehavior", "borderBehavior", "embellishmentBehavior", "hasSpecialPanel"]),
    blouse: knownFields(truth.blouse, [
      "hasBlouse", "color", "fabric", "frontConstruction", "backConstruction", "neckline", "sleeves", "ties", "closure", "embroidery", "border", "pattern", "fit", "isUnstitchedPiece",
    ]),
    physics: knownFields(truth.physics, ["weight", "stiffness", "fluidity", "transparency", "shine", "creaseBehavior", "expectedFall"]),
    regionEvidence: regionEvidence.map((entry) => {
      const record = objectValue(entry);
      return {
        ...knownFields(record, ["region", "state", "visibleConstruction", "visibleDecoration", "closures", "explicitlyAbsent", "uncertainty"]),
        sourceRole: record.sourceRole ?? record.source_role ?? "",
      };
    }),
  };
}

function canonicalSareeDrapePlan(value: unknown) {
  return knownFields(value, [
    "baseDrapeFamily", "shoulderSide", "waistTuck", "frontPleatTreatment", "palluShoulderPlacement", "openOrPleatedPallu", "palluSpread", "palluFallDirection", "palluVisibleLength", "handInteraction", "movementAmount", "pinningBehavior", "borderVisibility", "blouseVisibility", "coverageConstraints", "poseSpecificDrapeState",
  ]);
}

function productCore(value: JsonRecord) {
  // These fields have dedicated evidence/geometry/saree sections below. Keeping
  // them out of the generic snapshot prevents the same Product Truth from being
  // sent two or three times while preserving every authoritative fact once.
  return knownFields(value, [
    "garmentFamily", "category", "mainColor", "secondaryColors", "fabric", "pattern", "print", "texture", "neckline", "sleeveType", "length", "fit", "silhouette", "frontConstruction", "backConstruction", "buttons", "zippers", "pockets", "embroidery", "logos", "accessoriesIncluded", "bottomWearDetails", "footwearDetails", "invariantDetails", "uncertaintyNotes",
  ]);
}

function requiredJsonSection(section: string, value: unknown, maxChars: number) {
  const json = JSON.stringify(value) ?? "{}";
  if (json.length > maxChars) throw new GenerationPromptBudgetError(section, json.length, maxChars);
  return json;
}

export function assertGenerationPromptWithinLimit(prompt: string) {
  if (prompt.length > IMAGE_PROMPT_SAFE_CHARS) {
    throw new GenerationPromptBudgetError("Compiled generation prompt", prompt.length, IMAGE_PROMPT_SAFE_CHARS);
  }
  return prompt;
}

function isDirectRearEvidence(entry: JsonRecord) {
  return isDirectBackProductRole(String(entry.sourceRole ?? entry.source_role ?? "").trim().toLowerCase());
}

function rearEvidenceOnly(evidence: JsonRecord[]) {
  return evidence.filter((entry) => isDirectRearEvidence(objectValue(entry))).map((entry) => {
    const record = objectValue(entry);
    return {
      ...knownFields(record, ["region", "state", "visibleConstruction", "visibleDecoration", "closures", "explicitlyAbsent", "uncertainty"]),
      sourceRole: String(record.sourceRole ?? record.source_role ?? ""),
    };
  });
}

function rearOnlyProductCore(product: JsonRecord) {
  // Do not pass global profile fields into a true-back frame. Older analyses can
  // contain a legitimate front detail (for example lace at the front hem) that
  // lacks field-level rear provenance. The direct rear image must decide every
  // rear product detail, including the absence of decoration.
  return {
    garmentFamily: String(product.garmentFamily || ""),
    rearVisualAuthority: "Only the direct uploaded BACK / SAREE REAR-BACK DRAPE image in this request.",
    unprovenRearRule: "Render every rear construction, motif, border, tassel, closure, trim, and blouse-back detail as plain base fabric unless it is visible in that direct rear image.",
  };
}

function rearOnlySareeTruth(evidence: JsonRecord[]) {
  return {
    source: "Direct uploaded SAREE REAR / BACK DRAPE image only.",
    confirmedRearEvidence: rearEvidenceOnly(evidence),
    unprovenRearRule: "Do not copy body, pallu, border, tassel, or blouse details from a front, pallu, body-close-up, border, model, style, or generated image. If the rear image does not show a detail, render that rear region as plain base fabric.",
  };
}

function compactPromptBlock(prompt: string, startMarker: string, endMarkers: string[], maxChars: number) {
  const start = prompt.indexOf(startMarker);
  if (start < 0) return prompt;
  const contentStart = start + startMarker.length;
  const ends = endMarkers
    .map((marker) => prompt.indexOf(marker, contentStart))
    .filter((index) => index >= 0);
  const contentEnd = ends.length ? Math.min(...ends) : prompt.length;
  const content = prompt.slice(contentStart, contentEnd);
  return `${prompt.slice(0, contentStart)}${boundedText(content, maxChars)}${prompt.slice(contentEnd)}`;
}

/**
 * Provider prompts have a hard 32k limit. Keep all product-truth blocks
 * intact, then compact only advisory/user/styling prose in a fixed order. This
 * avoids a paid generation failing just above the former 30k local guard while
 * never silently trimming the canonical SKU evidence.
 */
function compactOptionalPromptContent(prompt: string) {
  let compacted = compactPromptBlock(
    prompt,
    "\nCONTINUOUS LEARNING ADVISORY (APPROVED, REFERENCE-SCOPED GUIDANCE):",
    ["\n\nPROMPT:"],
    800,
  );
  compacted = compactPromptBlock(compacted, "User notes: ", ["\nReference authority:"], 400);
  compacted = compactPromptBlock(
    compacted,
    "\nAPPROVED STYLING PLAN - the stylist's decisions for this shoot, identical in all five frames:\n",
    ["\n\nALLOWED DELTA - THE ONLY THINGS THAT MAY CHANGE:"],
    1_200,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nSTYLING ADDITION (optional, locked once chosen):\n",
    ["\n\nALLOWED DELTA - THE ONLY THINGS THAT MAY CHANGE:"],
    700,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nPOSE REQUIREMENT:\n",
    ["\nCORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:", "\n\nPROMPT:"],
    1_400,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nCORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:\n",
    ["\n\nPROMPT:"],
    600,
  );
  return compacted;
}

// Analyses cached before the geometry profiles existed still flow through here,
// so both readers fall back to the flat legacy fields instead of emitting null.
function patternGeometryOf(product: JsonRecord) {
  const geometry = product?.patternGeometry && typeof product.patternGeometry === "object" ? product.patternGeometry as JsonRecord : {};
  return Object.keys(geometry).length ? geometry : { type: String(product?.pattern || ""), print: String(product?.print || "") };
}

function embroideryGeometryOf(product: JsonRecord) {
  const geometry = product?.embroideryGeometry && typeof product.embroideryGeometry === "object" ? product.embroideryGeometry as JsonRecord : {};
  return Object.keys(geometry).length ? geometry : { placement: String(product?.embroidery || "") };
}

function detectPoseCategory(text: string) {
  const t = text.toLowerCase();
  if (/side|profile|lateral|three\.quarter|3\.4/.test(t)) return "side";
  if (/back|rear|behind|posterior/.test(t)) return "back";
  if (/front|hero|straight|facing/.test(t)) return "front";
  if (/walk|motion|step|stride|movement|dynamic/.test(t)) return "dynamic";
  if (/playful|detail|moment|showcase|highlight|close|cropped/.test(t)) return "playful";
  return "generic";
}

function poseCategoryRules(category: string) {
  return {
    side: `
- SIDE PROFILE POSE: The model's body must be turned exactly 90 degrees to camera.
- Show the garment's SIDE SEAM clearly - how fabric hangs along the side.
- Show sleeve opening from the side angle.
- Show garment LENGTH from the side - hemline silhouette.
- ONE arm should be slightly forward, one slightly back for natural depth.
- Face turned 3/4 toward camera (not full profile), eyes looking slightly toward lens.
- Feet positioned in a natural staggered stance.
- DO NOT show the front print centered - show it from the side angle.
- Background visible behind the model must show depth and space.`,
    back: `
- BACK VIEW POSE: The model's back faces the camera completely.
- Show the BACK NECKLINE, back construction, back hemline.
- Show how the garment falls and drapes from the back.
- If the garment has back print/embroidery/detail, showcase it.
- DUPATTA / SHAWL / ACCESSORY UNOBSTRUCTED VIEW: For any outfit with a dupatta, scarf, shawl, or stole (e.g., kurti set, salwar suit, lehenga):
  * The dupatta MUST NOT cover or drape across the back of the kurti/dress.
  * Drape the dupatta forward over both arms/elbows or held in front so the entire rear garment (neckline, back panel, embroidery, seams, darts, and hem) is 100% visible and unobstructed from neck to hem.
- Hair must be swept forward over shoulders or styled in an updo/bun so it does not cover the back neckline, ties, or rear embroidery.
- Model may look back over one shoulder (slight head turn) for engagement. If profile or partial face is visible, it MUST be the identical model from the identity anchor.
- Arms relaxed at sides or one hand slightly lifting hem.
- Feet visible, same footwear as front poses.
- DO NOT show front-facing garment features.`,
    front: `
- FRONT HERO POSE: Model squarely facing the camera.
- Ensure the front construction and neckline are perfectly symmetrical and visible.
- Stance should be grounded and confident.`,
    dynamic: `
- DYNAMIC POSE: Show active movement (walking, stepping, spinning).
- Fabric must show realistic motion lines, flare, and weight shift.
- Model's posture must lean naturally into the movement.
- Hair and accessories should react to the motion.`,
    playful: `
- PLAYFUL / DETAIL POSE: Focus on charm, product interaction, or detail showcase.
- Expression should be warm, joyful, or confident.
- Framing might be slightly cropped or closer to highlight a specific feature.`,
    generic: "",
  }[category] || "";
}

export function composeGenerationPrompt(args: {
  skuName: string; productDetails: string; pose: StudioPose & { poseNumber: number };
  session: JsonRecord; references: PromptReference[]; correction?: string; learnings?: string;
}) {
  const product = objectValue(args.session.productIdentity);
  const creative = objectValue(args.session.creativeDirection);
  const model = objectValue(args.session.modelIdentity);
  // Null for sessions analysed before v10. They keep the old accessory line
  // instead of being handed generated defaults dressed up as stylist decisions.
  const styling = args.session.stylingPlan ? normalizeStylingPlan(args.session.stylingPlan) : null;
  const evidence = Array.isArray(product?.garmentEvidence) ? product.garmentEvidence as JsonRecord[] : [];
  const rules = boundedStrings(Array.isArray(args.session.consistencyRules) ? args.session.consistencyRules : CONSISTENCY_RULES, 16, 420);
  const isTrueBack = args.pose.id === "back";
  // Existing sessions can bypass normalizeAnalysis, so reapply rear-evidence
  // validation immediately before prompt construction as a final safety gate.
  const promptEvidence = isTrueBack ? rearEvidenceOnly(evidence) : evidence;
  const placement = isTrueBack
    ? []
    : sanitizeDetailPlacementMap(product.detailPlacementMap, evidence).map((entry) => boundedText(entry, 420));
  const absent = isTrueBack ? [] : boundedStrings(product.absenceConstraints, 16, 420);
  
  const isSaree = product?.garmentFamily === "saree";
  if (isSaree && (!product.sareeTruth || typeof product.sareeTruth !== "object" || !product.sareeDrapePlan || typeof product.sareeDrapePlan !== "object")) {
    throw new Error("Stored saree analysis is incomplete or outdated. Reanalyse the product references before generation.");
  }
  const sareeTruth = isSaree
    ? (isTrueBack ? rearOnlySareeTruth(evidence) : canonicalSareeTruth(product.sareeTruth))
    : undefined;
  const sareeDrapePlan = isSaree && !isTrueBack ? canonicalSareeDrapePlan(product.sareeDrapePlan) : undefined;
  const productCoreJson = compactJson(isTrueBack ? rearOnlyProductCore(product) : productCore(product), { maxString: 360, maxItems: 16, maxKeys: 32 });
  const modelJson = compactJson(model, { maxString: 500, maxItems: 16, maxKeys: 32 });
  const creativeJson = compactJson(creative, { maxString: 500, maxItems: 16, maxKeys: 32 });
  const sareeTruthJson = isSaree ? requiredJsonSection(isTrueBack ? "Direct rear saree truth" : "Canonical saree truth", sareeTruth, 10_000) : "";
  const sareeDrapePlanJson = isSaree && !isTrueBack ? requiredJsonSection("Canonical saree drape plan", sareeDrapePlan, 4_000) : "";
  const patternGeometryJson = compactJson(patternGeometryOf(product), { maxString: 500, maxItems: 16, maxKeys: 24 });
  const embroideryGeometryJson = compactJson(embroideryGeometryOf(product), { maxString: 500, maxItems: 16, maxKeys: 24 });
  // Allow model face and approved pose anchor so the AI can recreate
  // the identical model and studio background for the back pose.
  // Defense in depth: strip out any stray front product references if mistakenly passed.
  const promptReferences = isTrueBack
    ? args.references.filter((ref) => isDirectBackProductRole(ref.role) || ref.role === "model_identity" || ref.role === "approved_pose")
    : args.references;
  if (isTrueBack && !promptReferences.some((ref) => isDirectBackProductRole(ref.role))) {
    throw new Error("The true back pose requires the current uploaded back product reference. Reanalyse or replace the back image before generation.");
  }
  const manifest = promptReferences.map((reference, index) => `IMAGE ${index + 1}: ${roleLabel(reference.role)}`).join("\n");
  const hasApprovedAnchor = promptReferences.some((reference) => reference.role === "approved_pose");
  const hasModelReference = promptReferences.some((reference) => reference.role === "model_identity");
  const faceVisible = !isTrueBack;
  const allowedDelta = [
    `pose/body position: ${boundedText(args.pose.bodyPosition, 360)}`,
    `camera angle: ${boundedText(args.pose.cameraAngle, 360)}`,
    `framing: ${boundedText(args.pose.framing, 360)}`,
    `expression: ${boundedText(args.pose.expression, 360)}`,
  ];
  const correction = boundedText(args.correction, 1_200);
  const learnings = boundedText(args.learnings, 900);
  const highlightedDetails = boundedStrings(args.pose.highlightedDetails, 12, 260).join(", ");
  const visibilityRules = boundedStrings(args.pose.productVisibilityRules, 12, 260).join("; ");
  const poseCategory = detectPoseCategory(args.pose.id + " " + (args.pose.prompt || "") + " " + (args.pose.description || ""));
  const categoryRules = poseCategoryRules(poseCategory);
  const evidenceLines = promptEvidence.slice(0, 16).map((entry) => {
    const row = objectValue(entry);
    return `- Region ${boundedText(row.region, 120).toUpperCase() || "UNKNOWN"}: [State: ${boundedText(row.state, 80)}]
  Source: ${boundedText(row.sourceRole ?? row.source_role, 80) || "UNRECORDED"}
  Construction: ${boundedText(row.visibleConstruction, 360) || "None explicitly proven"}
  Decoration/Trim: ${boundedText(row.visibleDecoration, 360) || "None explicitly proven"}
  Closures: ${boundedText(row.closures, 240) || "None"}
  Absent: ${boundedStrings(row.explicitlyAbsent, 12, 180).join(", ") || "None"}
  Uncertainty: ${boundedText(row.uncertainty, 260) || "None"}`;
  }).join("\n");
  const prompt = `Create ONE premium photorealistic fashion e-commerce photograph for ${boundedText(args.skuName, 160) || "this product"}.

REFERENCE MANIFEST IN UPLOAD ORDER:
${manifest}

EDIT GOAL:
Place the exact uploaded product on one consistent professional adult fashion model and create Pose ${args.pose.poseNumber}: ${boundedText(args.pose.title, 160)}. The finished image must look like the same real professional photoshoot as the other four images.

LOCKED SUBJECT - MUST NOT CHANGE:
${modelJson}
- Same recognizable face, skin tone, body proportions, hairstyle, hair length/color, makeup, accessories and footwear across the complete set.
- Pose 1 is only the subject/scene anchor for later poses. It never overrides original product references.

FACE & IDENTITY LOCK - HIGHEST PRIORITY:
${hasModelReference
    ? `The image labeled MODEL FACE REFERENCE in the reference manifest above is the exact, non-negotiable face and identity for this model in EVERY pose, including this one - it outranks every other face source, including the approved-pose anchor. Reproduce it as close to pixel-identical as photographically possible: identical facial bone structure, eyes (shape, color, spacing), eyebrows, nose, lips, jawline, skin tone and texture, and hairstyle. Do not idealize, beautify, average, restyle, or blend it with any other face - this must read as the same real person from that reference photo, not merely a similar-looking model.${hasApprovedAnchor ? " Use the APPROVED POSE 1 image only for scene, lighting, and styling continuity - never as a face source." : ""}`
    : hasApprovedAnchor
      ? "The image labeled APPROVED POSE 1 in the reference manifest above is the exact, non-negotiable ground truth for this model's identity. Reproduce the identical facial bone structure, eye shape and color, eyebrow shape, nose, lips, jawline, skin tone and texture, and hairstyle seen in that image - do not idealize, beautify, average, or drift toward a different face."
      : "This is the hero pose and establishes the model identity anchor for the whole shoot. Commit to one specific, photorealistic, naturally beautiful adult face exactly as described in modelIdentity above - every later pose in this set must reproduce this same face."}
${faceVisible
    ? "The face must read as a real photographed person: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry, anatomically correct and naturally shaped eyes with realistic catchlights and correctly aligned gaze, and naturally aligned teeth (not uniformly perfect, no extra or missing teeth). Never render a plastic, waxy, over-smoothed, mirror-symmetric, or otherwise synthetic \"AI face\". Never distort, warp, blur, or misalign eyes, eyebrows, nose, lips, ears, or teeth."
    : "The model is photographed from behind. Keep hair color/style, skin tone, ear jewelry, and body proportions strictly consistent with the identity anchor. If the model glances back over her shoulder showing her profile or any part of her face, that face and profile MUST be 100% identical to the MODEL FACE REFERENCE / APPROVED POSE 1 identity - same jawline, nose profile, skin texture with visible pores, eye shape, and makeup. Never substitute a different person or face."}

LOCKED PRODUCT - MUST NOT CHANGE:
${productCoreJson}
${isSaree ? (isTrueBack ? `SAREE REAR TRUTH - DIRECT EVIDENCE ONLY:
${sareeTruthJson}
SAREE REAR DRAPE AUTHORITY:
The direct uploaded rear image in the manifest is the only visual authority for this back pose. Do not use a global drape plan to add a pallu, border, tassel, motif, or blouse-back detail that the rear image does not visibly prove.` : `SAREE TRUTH - CRITICAL:
${sareeTruthJson}
SAREE DRAPE PLAN:
${sareeDrapePlanJson}`) : ""}
User notes: ${isTrueBack ? "Non-authoritative for rear construction. The direct uploaded back product image remains the sole product source." : boundedText(args.productDetails, 1_200)}
Reference authority: ${isTrueBack
    ? "The one direct uploaded BACK / SAREE REAR-BACK DRAPE image in the manifest is the sole visual product authority. Do not derive rear construction from a front, pallu, body detail, border, blouse, mannequin, model, style, or generated image."
    : `original product images always outrank generated anchors and style references. FRONT controls front construction; BACK solely controls rear construction; FABRIC/PATTERN resolves material and small construction; a MANNEQUIN/DRESS-FORM shot resolves worn shape, fit, proportion and drape, while a FLAT-LAY resolves outline, construction, panel layout and length only; ADDITIONAL supports product truth; STYLE controls art direction only.${isSaree ? " For sarees, FULL SAREE FRONT and REAR/BACK DRAPE control their complete worn regions; SAREE BODY/WEAVE controls body colour, weave and motif geometry; FULLY SPREAD PALLU alone controls the pallu boundary and artwork; BORDER/TASSELS controls edge geometry and tassel construction; BLOUSE FRONT/BACK controls only the matching blouse region. Never classify or treat the pallu spread as generic body fabric." : ""}`}
- Product references may be flat-lay, folded, pinned or shot on a mannequin or dress form. Rebuild the garment as it falls on a live human body, and never render a mannequin, dress form, hanger, clip, pin, prop stand, or the flat background surface in the output.
${isSaree ? (isTrueBack
    ? "- SAREE REAR RULE: read the visible pallu fall, border, tassels, weave and blouse-back only from the direct rear image. Never mirror or extend a front-only design into the back."
    : "- SAREE SPECIFIC RULES: Pallu artwork stays on the pallu, never bleed the border into the main body, do not duplicate the pallu into multiple loose cloth panels, border width stays identical, follow the drape plan explicitly.") : ""}

GARMENT TRUTH CONTRACT (EVIDENCE BY REGION):
${evidenceLines}
${placement.length ? `Detail placement hard locks:\n${placement.map((rule) => `- ${rule}`).join("\n")}` : "- Preserve every visible detail only in the exact region shown by the authoritative image."}
${absent.length ? `Negative-evidence hard locks:\n${absent.map((rule) => `- ${rule}`).join("\n")}` : "- Add no button, closure, tassel/latkan, trim, embroidery, pocket, logo, jewelry or hardware unless the authoritative product image proves it exists at that location."}

CRITICAL EVIDENCE RULES:
- If a region's state is "confirmed_absent", do not render the decoration, trim, closure, or specialized construction represented by that region.
- If a region's state is "unknown", it MUST be rendered in plain base fabric without any unproven decoration, trim, or specialized construction. UNKNOWN DOES NOT MEAN INFER.
- Do NOT extrapolate decoration. If trim is confirmed at the front hem but the side seam is unknown, do not extend the trim up the side.
${isTrueBack ? "- BACK-POSE EVIDENCE VETO: only a confirmed rear region whose Source is BACK PRODUCT or SAREE REAR / BACK DRAPE may place rear construction or decoration. A front-, fabric-, pallu-, border-, blouse-, mannequin-, model-, style-, generated-, or unrecorded source cannot prove a rear lace, trim, border, closure, or motif. If the direct rear evidence does not explicitly prove it, render plain base fabric in that rear region." : ""}

${isTrueBack ? `REAR PRODUCT GEOMETRY LOCK:
- The direct rear product image is the only visual geometry source for this frame. Reproduce only the rear-facing motif shape, scale, spacing, orientation, repeat, density, weave, border, tassel, blouse-back, and embroidery actually visible there.
- Do not use a fabric close-up, front frame, pallu spread, border image, blouse piece, or generated image to complete unseen rear geometry.
- If the rear image does not clearly resolve a region, render it as plain base fabric with no inferred decoration, trim, closure, motif, border, tassel, or embroidery.` : (isSaree ? `SAREE GEOMETRY AND PATTERN LOCK - the difference between photographing THIS saree and inventing a similar one:
- The SAREE BODY / WEAVE CLOSE-UP image is the pixel-level authority for the main body's motif shape, scale, spacing, orientation, and weave structure. Read the body geometry strictly from that image.
- The FULLY SPREAD PALLU image is the sole authority for pallu artwork, scale, orientation, repeat, density, and edge construction.
- The SAREE BORDER / TASSELS DETAIL image is the sole authority for upper/lower border widths, border motifs, and tassel construction.
- Reproduce all motifs at their stated physical scale relative to the body or pallu. Do not enlarge, simplify, stylize, redraw, or "clean up" a motif.
- Keep every accent colour inside the print and embroidery. Small secondary-colour details within a motif field are part of this product's identity, not noise to average away.
- If a region is not clearly resolved in any reference, render it plainly in the garment's base fabric, colour and texture only. Never copy a neighbouring panel's motif arrangement into it, never mirror or continue decoration across it, and never invent decoration to fill it.` : `PRINT AND EMBROIDERY GEOMETRY LOCK - the difference between photographing THIS garment and inventing a similar one:
Pattern geometry: ${patternGeometryJson}
Embroidery geometry: ${embroideryGeometryJson}
- The FABRIC / PATTERN DETAIL image is the pixel-level authority for motif shape, motif scale, spacing, orientation and embroidery construction. Read the geometry off that image rather than reproducing a generic version of the same craft or style.
- Reproduce motifs at the stated physical scale relative to the body. Do not enlarge, simplify, stylize, redraw or "clean up" a motif, and do not reduce a dense print to fewer, larger shapes.
- Keep the print's orientation, repeat interval and density identical, including where panels differ - body, sleeves, yoke, bottom wear and dupatta each keep their own stated treatment.
- Keep every accent colour inside the print. Small secondary-colour details within a motif field are part of this product's identity, not noise to average away.
- Reproduce embroidery as the same internal geometry: same lattice or motif structure, same count and rhythm of repeated units, same borders, same coverage area, and the same relationship to the neckline, tie, drawstring and tassel.
- If a region is not clearly resolved in any reference, render it plainly in the garment's base fabric, colour and texture only. Never copy a neighbouring panel's motif arrangement into it, never mirror or continue decoration across it, and never invent decoration to fill it - unresolved means undecorated, not "probably like the panel next to it".`)}

LOCKED ART DIRECTION & SET CONTINUITY - MUST NOT CHANGE BETWEEN POSES:
${creativeJson}
- Build the set described above, and where a STYLE REFERENCE or APPROVED POSE 1 image is supplied, rebuild the scene those images actually show: the same wall colour and finish, floor or ground surface, props and their placement, light direction and quality, camera height and distance, depth of field and colour grade. Do not substitute a neutral seamless studio backdrop, a white or grey sweep, or a different set that merely feels premium.
${hasApprovedAnchor
  ? `- SET & BACKDROP HARD LOCK TO APPROVED POSE 1:
  * Rebuild the EXACT SAME physical room and backdrop set from Pose 1: identical wall color, wall plaster/paint finish, texture, architectural elements, floor surface, and carpet/rug.
  * ZERO NEW PROPS: Absolutely do NOT introduce new props, urns, brass urlis, flower petals, random steps, pedestals, or vases not shown in Pose 1.
  * LIGHTING & SHADOW CONTINUITY: Keep the exact same light direction, shadow density, and warm/cool color temperature established in Pose 1.
  * The camera and model remain in the exact same photoshoot location - only the pose and framing change.`
  : "- Maintain a single, consistent studio set, wall finish, flooring, and lighting setup across all poses."}

${styling ? `APPROVED STYLING PLAN - the stylist's decisions for this shoot, identical in all five frames:
- Footwear: ${boundedText(styling.footwear, 360)}
- Jewellery: ${boundedText(styling.jewellery, 360)}
- Ornaments and accessories: ${boundedText(styling.ornaments, 360)}
- Makeup: ${boundedText(styling.makeup, 360)}
- Hair: ${boundedText(styling.hair, 360)}
${styling.stylingNotes ? `- Stylist notes: ${boundedText(styling.stylingNotes, 600)}` : ""}
${styling.themeInterpretation ? `- Theme being served: ${boundedText(styling.themeInterpretation, 600)}` : ""}
- Style the model with exactly these pieces - the same metal, the same count, the same placement in every frame. Do not add a necklace, bangle, ring, belt, bag, hair ornament or any other accessory this plan does not list, and do not drop one it does.
- This is styling only. It never becomes part of the garment, never hides or replaces a garment detail, bottom wear or footwear shown in the product references, and never contradicts the placement or absence locks above.
${creative?.suggestedAccessories ? `- Legacy stylist note (subordinate to the plan above): ${boundedText(creative.suggestedAccessories, 420)}` : ""}`
  : `STYLING ADDITION (optional, locked once chosen):
${creative?.suggestedAccessories ? `The stylist has proposed adding: ${boundedText(creative.suggestedAccessories, 420)}. Style the model with exactly this addition, identical across every pose. It is a styling choice only - it must never hide, replace, or contradict the garment, bottom wear, or footwear shown in the product references.` : "No additional styling accessory is needed for this product - use only what the product references show."}`}

ALLOWED DELTA - THE ONLY THINGS THAT MAY CHANGE:
${allowedDelta.map((value) => `- ${value}`).join("\n")}
- Hand placement: ${boundedText(args.pose.handPlacement, 360)}
- Everything not named here stays locked.

POSE REQUIREMENT:
Description: ${boundedText(args.pose.description, 600)}
Details to highlight: ${highlightedDetails}
Visibility rules: ${visibilityRules}
Purpose: ${boundedText(args.pose.purpose, 420)}
Consistency notes: ${boundedText(args.pose.consistencyNotes, 600)}
${categoryRules ? `POSE CATEGORY RULES (${poseCategory.toUpperCase()}):\n${categoryRules}` : ""}
${correction ? `
CORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:
${correction}
- Address this correction completely and literally. Do not change anything else that was working.` : ""}
${learnings ? `
CONTINUOUS LEARNING ADVISORY (APPROVED, REFERENCE-SCOPED GUIDANCE):
${learnings}
- These are explicitly approved guards only. Product-scoped guidance is valid only for this exact source-reference fingerprint.
- You MUST validate these guards against the current product's GARMENT TRUTH CONTRACT. If a guard contradicts the current authoritative product references or evidence, ignore it. The current product references ALWAYS override learning guidance.
` : ""}

PROMPT:
${boundedText(args.pose.prompt, 1_200)}

REALISTIC INTEGRATION:
- Treat this as frame ${args.pose.poseNumber} from one photographed contact sheet, not a new image concept. Reuse the same physical set coordinates, time of day, camera family, focal-length character, camera height, exposure, white balance, light direction, shadow density, and color grade established by Pose 1.
- Preserve natural fabric drape, folds, gravity, occlusion, thickness and construction for this exact material and fit.
- Match locked lighting direction, color temperature, shadows, contact shadows, perspective, lens feel, depth and scene geometry.
- Keep anatomy realistic and keep hands away from product details.
- Preserve believable pores, flyaway hairs, fabric microtexture, seam depth, edge transitions, optical depth of field, and grounded foot/contact shadows. Avoid waxy skin, over-smoothed fabric, duplicated motifs, over-sharpening, floating garments, plastic texture, and other synthetic AI tells.
${faceVisible ? `- Render the eyes with correct anatomy: two naturally shaped, correctly positioned eyes with realistic iris detail, natural catchlights, and a correctly aligned gaze - never crossed, misaligned, melted, or malformed.
- Render teeth naturally: a real, slightly imperfect smile with naturally aligned teeth in the correct count - never uniformly perfect, fused, extra, missing, or warped.
- Skin must show real photographic micro-detail (pores, faint texture variation) rather than an airbrushed, plastic, or over-smoothed "beauty filter" look.` : ""}

PROHIBITED UNRELATED CHANGES:
${rules.map((rule) => `- ${rule}`).join("\n")}
- Never complete, mirror, continue, relocate, add or remove decoration for symmetry.
- Never add random text, branding, people, layers, props that hide the product, or substitute bottom wear.
- Never change the backdrop wall color, texture, floor, or lighting from what was established in Pose 1.
- Never add random background props (brass urlis, urns, flower petals, pedestals) not present in Pose 1.
${args.pose.id === "back" ? "- DUPATTA REAR VISIBILITY LOCK: If wearing a dupatta or shawl, it must be draped forward over arms or in front. The back of the kurti/dress must be completely visible and never covered by the dupatta." : ""}
${args.pose.id === "back" ? "- TRUE BACK HARD RULE: shoulders and hips fully face away. Reproduce uploaded BACK exactly; never infer the rear from FRONT." : ""}
${args.pose.id === "closeup" ? "- POSE 5 HARD RULE: this is a genuine ZOOMED-IN face-to-chest or face-to-waist shot - visibly tighter in scale than the full-body hero pose, never a repeat of that wide framing. The face must be sharp, beautiful, and carry a natural Gen-Z expression, and one real product detail (embroidery, neckline, drape, print, or fabric texture) must also be sharp and clearly visible in the same frame." : ""}

Product accuracy is more important than style matching. Output only the finished photograph: no captions, labels, collage, borders or watermark.`;

  return assertGenerationPromptWithinLimit(
    prompt.length > IMAGE_PROMPT_SAFE_CHARS ? compactOptionalPromptContent(prompt) : prompt,
  );
}
