import {
  CONSISTENCY_RULES,
  normalizeStylingPlan,
  type JsonRecord,
  type StudioPose,
  sanitizeDetailPlacementMap,
} from "./profiles.ts";
import { roleLabel } from "./referencePolicy.ts";

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
  // Existing sessions can bypass normalizeAnalysis, so reapply rear-evidence
  // validation immediately before prompt construction as a final safety gate.
  const placement = sanitizeDetailPlacementMap(product.detailPlacementMap, evidence).map((entry) => boundedText(entry, 420));
  const absent = boundedStrings(product.absenceConstraints, 16, 420);
  
  const isSaree = product?.garmentFamily === "saree";
  if (isSaree && (!product.sareeTruth || typeof product.sareeTruth !== "object" || !product.sareeDrapePlan || typeof product.sareeDrapePlan !== "object")) {
    throw new Error("Stored saree analysis is incomplete or outdated. Reanalyse the product references before generation.");
  }
  const sareeTruth = isSaree ? canonicalSareeTruth(product.sareeTruth) : undefined;
  const sareeDrapePlan = isSaree ? canonicalSareeDrapePlan(product.sareeDrapePlan) : undefined;
  const productCoreJson = compactJson(productCore(product), { maxString: 360, maxItems: 16, maxKeys: 32 });
  const modelJson = compactJson(model, { maxString: 500, maxItems: 16, maxKeys: 32 });
  const creativeJson = compactJson(creative, { maxString: 500, maxItems: 16, maxKeys: 32 });
  const sareeTruthJson = isSaree ? requiredJsonSection("Canonical saree truth", sareeTruth, 10_000) : "";
  const sareeDrapePlanJson = isSaree ? requiredJsonSection("Canonical saree drape plan", sareeDrapePlan, 4_000) : "";
  const patternGeometryJson = compactJson(patternGeometryOf(product), { maxString: 500, maxItems: 16, maxKeys: 24 });
  const embroideryGeometryJson = compactJson(embroideryGeometryOf(product), { maxString: 500, maxItems: 16, maxKeys: 24 });
  // Defense in depth: processWorker selection already omits it, but callers of
  // this helper must never accidentally mention an approved front anchor in a
  // true-back prompt.
  const promptReferences = args.pose.id === "back"
    ? args.references.filter((reference) => reference.role !== "approved_pose")
    : args.references;
  const manifest = promptReferences.map((reference, index) => `IMAGE ${index + 1}: ${roleLabel(reference.role)}`).join("\n");
  const hasApprovedAnchor = promptReferences.some((reference) => reference.role === "approved_pose");
  const hasModelReference = promptReferences.some((reference) => reference.role === "model_identity");
  const faceVisible = args.pose.id !== "back";
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
  const evidenceLines = evidence.slice(0, 16).map((entry) => {
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
    : "The face is turned away and is not the subject of this pose - keep hair color/style, skin tone, and body proportions consistent with the identity anchor."}

LOCKED PRODUCT - MUST NOT CHANGE:
${productCoreJson}
${isSaree ? `SAREE TRUTH - CRITICAL:
${sareeTruthJson}
SAREE DRAPE PLAN:
${sareeDrapePlanJson}` : ""}
User notes: ${boundedText(args.productDetails, 1_200)}
Reference authority: original product images always outrank generated anchors and style references. FRONT controls front construction; BACK solely controls rear construction; FABRIC/PATTERN resolves material and small construction; a MANNEQUIN/DRESS-FORM shot resolves worn shape, fit, proportion and drape, while a FLAT-LAY resolves outline, construction, panel layout and length only; ADDITIONAL supports product truth; STYLE controls art direction only.${isSaree ? " For sarees, FULL SAREE FRONT and REAR/BACK DRAPE control their complete worn regions; SAREE BODY/WEAVE controls body colour, weave and motif geometry; FULLY SPREAD PALLU alone controls the pallu boundary and artwork; BORDER/TASSELS controls edge geometry and tassel construction; BLOUSE FRONT/BACK controls only the matching blouse region. Never classify or treat the pallu spread as generic body fabric." : ""}
- Product references may be flat-lay, folded, pinned or shot on a mannequin or dress form. Rebuild the garment as it falls on a live human body, and never render a mannequin, dress form, hanger, clip, pin, prop stand, or the flat background surface in the output.
${isSaree ? `- SAREE SPECIFIC RULES: Pallu artwork stays on the pallu, never bleed the border into the main body, do not duplicate the pallu into multiple loose cloth panels, border width stays identical, follow the drape plan explicitly.` : ""}

GARMENT TRUTH CONTRACT (EVIDENCE BY REGION):
${evidenceLines}
${placement.length ? `Detail placement hard locks:\n${placement.map((rule) => `- ${rule}`).join("\n")}` : "- Preserve every visible detail only in the exact region shown by the authoritative image."}
${absent.length ? `Negative-evidence hard locks:\n${absent.map((rule) => `- ${rule}`).join("\n")}` : "- Add no button, closure, tassel/latkan, trim, embroidery, pocket, logo, jewelry or hardware unless the authoritative product image proves it exists at that location."}

CRITICAL EVIDENCE RULES:
- If a region's state is "confirmed_absent", do not render the decoration, trim, closure, or specialized construction represented by that region.
- If a region's state is "unknown", it MUST be rendered in plain base fabric without any unproven decoration, trim, or specialized construction. UNKNOWN DOES NOT MEAN INFER.
- Do NOT extrapolate decoration. If trim is confirmed at the front hem but the side seam is unknown, do not extend the trim up the side.
${args.pose.id === "back" ? "- BACK-POSE EVIDENCE VETO: only a confirmed rear region whose Source is BACK PRODUCT, SAREE REAR / BACK DRAPE, or SAREE BLOUSE BACK may place rear construction or decoration. A front-, fabric-, mannequin-, style-, or unrecorded source cannot prove a rear lace, trim, border, closure, or motif. If the direct rear evidence does not explicitly prove it, render plain base fabric in that rear region." : ""}

PRINT AND EMBROIDERY GEOMETRY LOCK - the difference between photographing THIS garment and inventing a similar one:
Pattern geometry: ${patternGeometryJson}
Embroidery geometry: ${embroideryGeometryJson}
- The FABRIC / PATTERN DETAIL image is the pixel-level authority for motif shape, motif scale, spacing, orientation and embroidery construction. Read the geometry off that image rather than reproducing a generic version of the same craft or style.
- Reproduce motifs at the stated physical scale relative to the body. Do not enlarge, simplify, stylize, redraw or "clean up" a motif, and do not reduce a dense print to fewer, larger shapes.
- Keep the print's orientation, repeat interval and density identical, including where panels differ - body, sleeves, yoke, bottom wear and dupatta each keep their own stated treatment.
- Keep every accent colour inside the print. Small secondary-colour details within a motif field are part of this product's identity, not noise to average away.
- Reproduce embroidery as the same internal geometry: same lattice or motif structure, same count and rhythm of repeated units, same borders, same coverage area, and the same relationship to the neckline, tie, drawstring and tassel.
- If a region is not clearly resolved in any reference, render it plainly in the garment's base fabric, colour and texture only. Never copy a neighbouring panel's motif arrangement into it, never mirror or continue decoration across it, and never invent decoration to fill it - unresolved means undecorated, not "probably like the panel next to it".

LOCKED ART DIRECTION - MUST NOT CHANGE BETWEEN POSES:
${creativeJson}
- Build the set described above, and where a STYLE REFERENCE or APPROVED POSE 1 image is supplied, rebuild the scene those images actually show: the same wall colour and finish, floor or ground surface, props and their placement, light direction and quality, camera height and distance, depth of field and colour grade. Do not substitute a neutral seamless studio backdrop, a white or grey sweep, or a different set that merely feels premium.

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
${args.pose.id === "back" ? "- TRUE BACK HARD RULE: shoulders and hips fully face away. Reproduce uploaded BACK exactly; never infer the rear from FRONT." : ""}
${args.pose.id === "closeup" ? "- POSE 5 HARD RULE: this is a genuine ZOOMED-IN face-to-chest or face-to-waist shot - visibly tighter in scale than the full-body hero pose, never a repeat of that wide framing. The face must be sharp, beautiful, and carry a natural Gen-Z expression, and one real product detail (embroidery, neckline, drape, print, or fabric texture) must also be sharp and clearly visible in the same frame." : ""}

Product accuracy is more important than style matching. Output only the finished photograph: no captions, labels, collage, borders or watermark.`;

  return assertGenerationPromptWithinLimit(
    prompt.length > IMAGE_PROMPT_SAFE_CHARS ? compactOptionalPromptContent(prompt) : prompt,
  );
}
