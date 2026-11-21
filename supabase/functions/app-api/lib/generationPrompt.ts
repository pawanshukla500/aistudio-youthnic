import {
  CLOSEUP_PRODUCT_DETAIL,
  CONSISTENCY_RULES,
  FORBIDDEN_HELD_OBJECT_PATTERN,
  FORBIDDEN_NON_EYEWEAR_HELD_OBJECT_PATTERN,
  effectiveShowcaseIntent,
  isAboveAnkleCropFraming,
  isSeatedEditorialPoseDemanded,
  normalizeStylingPlan,
  resolveAspectRatioLabel,
  resolveAspectRatioOrientation,
  resolveCloseupMode,
  requestedHandheldProps,
  type RequestedHandheldProps,
  type JsonRecord,
  type ShowcaseIntent,
  type StudioPose,
  sanitizeDetailPlacementMap,
  sanitizeHeldObjectText,
  sanitizePoseDirectionForAspectRatio,
  stripGroundedFeetForCroppedFrame,
  withRequestedPropsAllowed,
} from "./profiles.ts";
import {
  effectiveShowcaseShot,
  showcaseAestheticDirection,
  type ShowcaseFeatureRegion,
  type ShowcasePlan,
  showcaseShotDirection,
  type ShowcaseShotType,
} from "./showcaseFeature.ts";
import {
  type BottomCutClass,
  type BottomWearPresentation,
  detectGarmentPoseFamily,
  effectiveBottomCutClass,
  FARSHI_SILHOUETTE_STRUCTURE,
  type GarmentPoseFamily,
  garmentPoseDirection,
  isSareePoseFamily,
  reconcileFarshiVisibilityRules,
  resolveBottomWearPresentation,
  withoutFarshiStructureContradictions,
} from "./garmentPoses.ts";
import { isDirectBackProductRole, isNonProductEvidenceRole, roleLabel } from "./referencePolicy.ts";
import { sceneLockBlock } from "./sceneLock.ts";
import {
  type AdoptableSlot,
  expressionAttitudeLine,
  isLowPosture,
  MAX_REFERENCE_DIRECTIVE,
  plannedPoseExpression,
  type ReferencePosture,
  type SlotPlan,
  slotReferencePlan,
  storedPosePlanning,
} from "./posePlanning.ts";

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

function cleanObject(input: unknown, depth = 0): unknown {
  if (depth > 6) return input;
  if (input === null || input === undefined) return undefined;
  if (typeof input === "string") {
    return input.trim() === "" ? undefined : input;
  }
  if (Array.isArray(input)) {
    const cleaned = input
      .map((item) => cleanObject(item, depth + 1))
      .filter((item) => item !== undefined && (typeof item !== "string" || item.trim() !== ""));
    return cleaned.length === 0 ? undefined : cleaned;
  }
  if (typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => [key, cleanObject(value, depth + 1)])
      .filter(([, value]) => value !== undefined);
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
  }
  return input;
}

function compactJson(value: unknown, options: { maxString?: number; maxItems?: number; maxKeys?: number; maxDepth?: number } = {}) {
  const maxString = options.maxString ?? 480;
  const maxItems = options.maxItems ?? 16;
  const maxKeys = options.maxKeys ?? 40;
  const maxDepth = options.maxDepth ?? 5;
  const compact = (input: unknown, depth = 0): unknown => {
    if (typeof input === "string") return boundedText(input, maxString);
    if (Array.isArray(input)) {
      return input
        .slice(0, maxItems)
        .map((entry) => compact(entry, depth + 1))
        .filter((entry) => entry !== undefined && entry !== "" && (typeof entry !== "object" || Object.keys(entry as object).length > 0));
    }
    if (input && typeof input === "object") {
      if (depth >= maxDepth) return "[nested detail omitted]";
      const entries = Object.entries(input as JsonRecord)
        .map(([key, entry]) => [key, compact(entry, depth + 1)])
        .filter(([, val]) => val !== undefined && val !== "" && (typeof val !== "object" || Object.keys(val as object).length > 0))
        .slice(0, maxKeys);
      return Object.fromEntries(entries);
    }
    return input;
  };
  return JSON.stringify(compact(cleanObject(value))) ?? "{}";
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
    regionEvidence: regionEvidence.slice(0, 16).map((entry) => {
      const record = objectValue(entry);
      return {
        ...knownFields(record, ["region", "state", "visibleConstruction", "visibleDecoration", "closures", "explicitlyAbsent", "uncertainty"]),
        sourceRole: record.sourceRole ?? record.source_role ?? "",
      };
    }).filter((entry) => !isNonProductEvidenceRole(entry.sourceRole)),
  };
}

function canonicalSareeDrapePlan(value: unknown) {
  return knownFields(value, [
    "baseDrapeFamily", "shoulderSide", "waistTuck", "frontPleatTreatment", "palluShoulderPlacement", "openOrPleatedPallu", "palluSpread", "palluFallDirection", "palluVisibleLength", "handInteraction", "movementAmount", "pinningBehavior", "borderVisibility", "blouseVisibility", "coverageConstraints", "poseSpecificDrapeState",
  ]);
}

function productCore(value: JsonRecord, includesBottomWear = true) {
  // These fields have dedicated evidence/geometry/saree sections below. Keeping
  // them out of the generic snapshot prevents the same Product Truth from being
  // sent two or three times while preserving every authoritative fact once.
  const core = knownFields(value, [
    "garmentFamily", "category", "mainColor", "secondaryColors", "fabric", "pattern", "print", "texture", "neckline", "sleeveType", "length", "fit", "silhouette", "frontConstruction", "backConstruction", "buttons", "zippers", "pockets", "embroidery", "logos", "accessoriesIncluded", "bottomWearDetails", "footwearDetails", "invariantDetails", "uncertaintyNotes",
  ]);
  // A top-only shoot must not carry a recorded bottom-wear specification into the
  // locked-product snapshot: that would contradict the top-only instruction and
  // invite exactly the coordinated bottom the setting exists to prevent.
  if (!includesBottomWear) delete core.bottomWearDetails;
  return core;
}

function requiredJsonSection(section: string, value: unknown, maxChars: number) {
  const json = JSON.stringify(cleanObject(value)) ?? "{}";
  if (json.length > maxChars) throw new GenerationPromptBudgetError(section, json.length, maxChars);
  return json;
}

export function assertGenerationPromptWithinLimit(prompt: string) {
  if (prompt.length > IMAGE_PROMPT_SAFE_CHARS) {
    throw new GenerationPromptBudgetError("Compiled generation prompt", prompt.length, IMAGE_PROMPT_SAFE_CHARS);
  }
  return prompt;
}

function isDirectRearOrBottomEvidence(entry: JsonRecord, includesBottomWear: boolean) {
  const role = String(entry.sourceRole ?? entry.source_role ?? "").trim().toLowerCase();
  const region = String(entry.region ?? "").trim().toLowerCase();
  if (isDirectBackProductRole(role)) return true;
  if (includesBottomWear && (role === "bottom" || region.startsWith("bottom wear") || region.startsWith("bottom_wear"))) return true;
  return false;
}

function rearEvidenceOnly(evidence: JsonRecord[], includesBottomWear = false) {
  return evidence.filter((entry) => isDirectRearOrBottomEvidence(objectValue(entry), includesBottomWear)).map((entry) => {
    const record = objectValue(entry);
    return {
      ...knownFields(record, ["region", "state", "visibleConstruction", "visibleDecoration", "closures", "explicitlyAbsent", "uncertainty"]),
      sourceRole: String(record.sourceRole ?? record.source_role ?? ""),
    };
  });
}

function rearOnlyProductCore(product: JsonRecord, includesBottomWear = true) {
  // Do not pass global profile fields into a true-back frame. Older analyses can
  // contain a legitimate front detail (for example lace at the front hem) that
  // lacks field-level rear provenance. The direct rear image must decide every
  // rear product detail, including the absence of decoration.
  const bottomWear = includesBottomWear ? String(product.bottomWearDetails || "").trim() : "";
  return {
    garmentFamily: String(product.garmentFamily || ""),
    ...(bottomWear ? { bottomWearDetails: bottomWear } : {}),
    rearVisualAuthority: includesBottomWear
      ? "Upper garment: only the direct uploaded BACK / SAREE REAR-BACK DRAPE image in this request. Bottom wear: authoritative bottom wear references and recorded bottom-wear details."
      : "Only the direct uploaded BACK / SAREE REAR-BACK DRAPE image in this request.",
    unprovenRearRule: includesBottomWear
      ? "For the upper garment, render every rear construction, motif, border, tassel, closure, trim, and blouse-back detail as plain base fabric unless it is visible in that direct rear image. Bottom wear must faithfully preserve its authentic cut, volume, pleating, hem, and print DNA."
      : "Render every rear construction, motif, border, tassel, closure, trim, and blouse-back detail as plain base fabric unless it is visible in that direct rear image.",
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
 * The manifest names every attached image. Cutting it from the end left later images
 * (the Pose 1 anchor, fabric detail) unlabelled, so each line keeps an equal share instead;
 * every label leads with its role, so the share always keeps what the image is.
 */
export function compactManifestBlock(prompt: string, maxChars: number) {
  const startMarker = "\nREFERENCE MANIFEST IN UPLOAD ORDER:\n";
  const start = prompt.indexOf(startMarker);
  if (start < 0) return prompt;
  const contentStart = start + startMarker.length;
  const ends = ["\nGENERATION MEMORY", "\n\nEDIT GOAL:"]
    .map((marker) => prompt.indexOf(marker, contentStart))
    .filter((index) => index >= 0);
  const contentEnd = ends.length ? Math.min(...ends) : prompt.length;
  const lines = prompt.slice(contentStart, contentEnd).split("\n");
  if (lines.join("\n").length <= maxChars) return prompt;
  const share = Math.max(120, Math.floor(maxChars / Math.max(1, lines.length)) - 1);
  return `${prompt.slice(0, contentStart)}${lines.map((line) => boundedText(line, share)).join("\n")}${prompt.slice(contentEnd)}`;
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
    "\nAPPROVED STYLING PLAN - the stylist's decisions for this shoot, identical in every frame:\n",
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
    [
      "\nGARMENT POSE GRAMMAR (",
      "\nDO NOT COPY THE STYLE POSE",
      "\nFASHION KNOWLEDGE (",
      "\nCONTINUOUS LEARNING ADVISORY",
      "\nCORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:",
      "\n\nPROMPT:",
    ],
    2_400,
  );
  compacted = compactPromptBlock(
    compacted,
    "GARMENT POSE GRAMMAR (",
    [
      "\nDO NOT COPY THE STYLE POSE",
      "\nSEATED EDITORIAL POSE REQUIREMENT",
      "\nFASHION KNOWLEDGE (",
      "\nCONTINUOUS LEARNING ADVISORY",
      "\nCORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:",
      "\n\nPROMPT:",
    ],
    1_100,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nCORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:\n",
    ["\n\nPROMPT:"],
    600,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nFASHION KNOWLEDGE (SEEDED CUT/PRINT GUIDANCE, SUBORDINATE TO PRODUCT REFERENCES):\n",
    ["\nCONTINUOUS LEARNING ADVISORY (APPROVED, REFERENCE-SCOPED GUIDANCE):", "\nGENERATION MEMORY (DO NOT FORGET):", "\n\nPROMPT:"],
    700,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nGENERATION MEMORY (DO NOT FORGET):\n",
    ["\n\nEDIT GOAL:", "\nCONTINUOUS LEARNING ADVISORY (APPROVED, REFERENCE-SCOPED GUIDANCE):", "\n\nPROMPT:"],
    700,
  );
  return compacted;
}

export function compactFullPromptSafely(prompt: string): string {
  if (prompt.length <= IMAGE_PROMPT_SAFE_CHARS) return prompt;

  // Tier 1: Trim optional advisory, learning, user notes, styling, and fashion knowledge
  let compacted = compactOptionalPromptContent(prompt);
  if (compacted.length <= IMAGE_PROMPT_SAFE_CHARS) return compacted;

  // Tier 2: Compact evidence lines if garment evidence block is excessively long
  compacted = compactPromptBlock(
    compacted,
    "\nGARMENT TRUTH CONTRACT (EVIDENCE BY REGION):\n",
    ["\nDetail placement hard locks:\n", "\nNegative-evidence hard locks:\n", "\nCRITICAL EVIDENCE RULES:"],
    2_400,
  );
  if (compacted.length <= IMAGE_PROMPT_SAFE_CHARS) return compacted;

  // Tier 3: Compact verbose repeated prose (manifest, photographic realism, geometry, reference authority, set continuity, prohibited boilerplate)
  compacted = compactPromptBlock(
    compacted,
    "Reference authority: ",
    ["\n- Product references may be flat-lay", "\nGARMENT TRUTH CONTRACT"],
    500,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nPHOTOGRAPHIC REALISM - MUST READ AS CAPTURED BY A REAL CAMERA, NEVER AS AI-GENERATED:\n",
    ["\nLOCKED SUBJECT - MUST NOT CHANGE:"],
    900,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nPRINT AND EMBROIDERY GEOMETRY LOCK",
    ["\nLOCKED BOTTOM WEAR ARCHITECTURE", "\nTOP-ONLY PRODUCT", "\nLOCKED ART DIRECTION"],
    1_200,
  );
  compacted = compactPromptBlock(
    compacted,
    "\n- SET ONLY: the direction below is backdrop, light, and camera. It does not set the pose, the garment, or handheld props.\n",
    ["\nAPPROVED STYLING PLAN", "\nSTYLING ADDITION", "\nALLOWED DELTA"],
    450,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nREALISTIC INTEGRATION:\n",
    ["\nPROHIBITED UNRELATED CHANGES:"],
    700,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nSTRICT HUMAN ANATOMY & NATURAL LIMB INTEGRITY (ZERO TOLERANCE FOR EXTRA LIMBS):\n",
    ["\nPHOTOGRAPHIC REALISM", "\nLOCKED SUBJECT - MUST NOT CHANGE:"],
    750,
  );
  compacted = compactPromptBlock(
    compacted,
    "GARMENT POSE GRAMMAR (",
    [
      "\nDO NOT COPY THE STYLE POSE",
      "\nSEATED EDITORIAL POSE REQUIREMENT",
      "\nFASHION KNOWLEDGE (",
      "\nCONTINUOUS LEARNING ADVISORY",
      "\nCORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:",
      "\n\nPROMPT:",
    ],
    800,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nPROHIBITED UNRELATED CHANGES:\n",
    ["\nProduct accuracy is more important than style matching."],
    1_300,
  );
  if (compacted.length <= IMAGE_PROMPT_SAFE_CHARS) return compacted;

  // Tier 4: Further trim evidence, manifest, product JSON, and geometry blocks before touching any pose/bottom-wear locks
  compacted = compactManifestBlock(compacted, 1_200);
  compacted = compactPromptBlock(
    compacted,
    "\nLOCKED PRODUCT - MUST NOT CHANGE:\n",
    ["\nSAREE TRUTH", "\nSAREE REAR TRUTH", "\nGARMENT TRUTH CONTRACT"],
    2_200,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nGARMENT TRUTH CONTRACT (EVIDENCE BY REGION):\n",
    ["\nDetail placement hard locks:\n", "\nNegative-evidence hard locks:\n", "\nCRITICAL EVIDENCE RULES:"],
    1_400,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nPHOTOGRAPHIC REALISM - MUST READ AS CAPTURED BY A REAL CAMERA, NEVER AS AI-GENERATED:\n",
    ["\nLOCKED SUBJECT - MUST NOT CHANGE:"],
    500,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nPRINT AND EMBROIDERY GEOMETRY LOCK",
    ["\nLOCKED BOTTOM WEAR ARCHITECTURE", "\nTOP-ONLY PRODUCT", "\nLOCKED ART DIRECTION"],
    700,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nLOCKED BOTTOM WEAR ARCHITECTURE, SILHOUETTE & PRINT - HIGHEST FIDELITY:\n",
    ["\nLOCKED ART DIRECTION & SET CONTINUITY"],
    3_200,
  );
  compacted = compactPromptBlock(
    compacted,
    "\nPOSE REQUIREMENT:\n",
    [
      "\nGARMENT POSE GRAMMAR (",
      "\nDO NOT COPY THE STYLE POSE",
      "\nFASHION KNOWLEDGE (",
      "\nCONTINUOUS LEARNING ADVISORY",
      "\nCORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:",
      "\n\nPROMPT:",
    ],
    1_800,
  );
  if (compacted.length <= IMAGE_PROMPT_SAFE_CHARS) return compacted;

  // Tier 5: Emergency failsafe — NEVER slice off POSE REQUIREMENT, PROMPT:, or closing HARD RULEs.
  const closingMarker = "\nProduct accuracy is more important than style matching.";
  const closingIndex = compacted.lastIndexOf(closingMarker);
  const poseMarker = "\nPOSE REQUIREMENT:";
  const realMarker = "\nREALISTIC INTEGRATION:";
  const poseIndex = compacted.indexOf(poseMarker);
  const realIndex = poseIndex >= 0 ? compacted.indexOf(realMarker, poseIndex) : -1;

  if (closingIndex > 0) {
    const closingText = compacted.slice(closingIndex);
    if (poseIndex > 0 && realIndex > poseIndex && realIndex <= closingIndex) {
      const preservedTail = `${compacted.slice(poseIndex, realIndex).trimEnd()}\n${closingText}`;
      const prefixAnchor = "Create ONE real-camera fashion e-commerce photograph";
      const anchorPos = compacted.indexOf(prefixAnchor);
      const rawPrefix = anchorPos > 200 ? compacted.slice(anchorPos, poseIndex) : compacted.slice(0, poseIndex);
      const budgetForPrefix = IMAGE_PROMPT_SAFE_CHARS - preservedTail.length - 80;
      if (budgetForPrefix > 1_500) {
        const slicedPrefix = rawPrefix.length > budgetForPrefix
          ? `${rawPrefix.slice(0, budgetForPrefix).trimEnd()}\n\n[Background and auxiliary sections compacted]`
          : rawPrefix.trimEnd();
        compacted = `${slicedPrefix}\n${preservedTail}`;
      }
    } else {
      const budgetForPrefix = IMAGE_PROMPT_SAFE_CHARS - closingText.length - 80;
      if (budgetForPrefix > 5_000) {
        compacted = `${compacted.slice(0, budgetForPrefix).trimEnd()}\n\n[Prompt sections safely compacted within provider limits]\n${closingText}`;
      }
    }
  }

  return compacted.length > IMAGE_PROMPT_SAFE_CHARS
    ? compacted.slice(0, IMAGE_PROMPT_SAFE_CHARS)
    : compacted;
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
  if (/\b(back|rear|behind|posterior)\b/.test(t) || t.includes("back view") || t.includes("true back") || t.includes("rear full")) return "back";
  // A three-quarter catalog turn is not a 90-degree profile. Matching
  // "three-quarter" here was selecting a staggered stance.
  if (/\b(side|profile|lateral)\b/.test(t) || t.includes("side view") || t.includes("side profile")) return "side";
  if (/\b(sit|sitting|seated)\b/.test(t)) return "sitting";
  if (/back|rear|behind|posterior/.test(t)) return "back";
  if (/front|hero|straight|facing/.test(t)) return "front";
  if (/walk|motion|step|stride|movement|dynamic/.test(t)) return "dynamic";
  if (/playful|detail|moment|showcase|highlight|close|cropped/.test(t)) return "playful";
  return "generic";
}

function poseCategoryRules(category: string, options: { croppedAboveAnkles?: boolean; expression?: string } = {}) {
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
- FRONT HERO POSE: Model facing the camera with a natural catalog stance.
- Shoulders relaxed, weight settled slightly on one leg, arms hanging with a small natural bend. The garment front stays fully readable and untwisted.
- Do not lock the body into a rigid, perfectly symmetrical mannequin pose.`,
    sitting: `
- SEATED / SITTING EDITORIAL POSE:
- The model is gracefully and elegantly seated on seating that already belongs to the established set (e.g. its bench, plinth/cube, chair or step). Never bring new furniture into the set for this frame.
- MANDATORY GARMENT & BOTTOM-WEAR READABILITY:
  * Both legs, trousers/farshi/skirt/pleats, hemline, and footwear must remain clearly visible and beautifully arranged - never tucked away, crumpled, obscured, or hidden behind props.
  * The upper garment silhouette, neckline, embroidery, and sleeve details must remain fully displayed and untangled.
  * Posture should be poised, relaxed, and editorial (e.g. slight angle to camera, back straight or gentle lean, legs gracefully placed to showcase garment volume and footwear).
- Ensure the seating furniture/plinth strictly matches the studio aesthetic and does NOT introduce cluttered pre-shoot props.`,
    angled: `
- THREE-QUARTER TURN: Rotate the torso and hips 35 to 45 degrees. This is not a flat front and not a 90-degree profile.
- Both feet stay planted and close. Never a staggered stride, a lifted foot, or a stance that opens a joined hem.
- Show the side seam and sleeve from that angle. Keep the same face and the same backdrop.`,
    dynamic: options.croppedAboveAnkles
      ? `
- NATURAL EDITORIAL POSE (CROPPED FRAME): A relaxed editorial knees-up or upper-body stance that is clearly not the hero pose.
- Use a soft torso angle, gentle contrapposto shoulder shift, or soft lean that belongs to the set while honoring the planned framing crop.
- Do not freeze a walking stride, a spin, or a wide leg split. Fabric hangs naturally with gravity.`
      : `
- NATURAL EDITORIAL POSE: A relaxed catalog stance that is clearly not the hero pose.
- Use a small weight shift, a gentle shoulder angle, or a soft lean that already belongs to the set. Both feet stay grounded and close enough that trouser hems, pleats, and a joined Farshi hem remain closed.
- Do not freeze a walking stride, a spin, or a wide leg split. Fabric hangs with gravity, not with motion blur.`,
    playful: `
- PLAYFUL / DETAIL POSE: Focus on charm, product interaction, or detail showcase.
${options.expression ? `- Expression: ${options.expression}.` : "- Expression should be warm, joyful, or confident."}
- Framing might be slightly cropped or closer to highlight a specific feature.`,
    reference: `
- REFERENCE POSTURE: follow the REFERENCE POSE MATCH block for body position, support and signature styling; copy the posture only.
- Exactly two arms and two hands. The neckline, front design, hem and bottom wear stay readable, uncrumpled and unobstructed.`,
    showcase: "",
    generic: "",
  }[category] || "";
}

function pose5HardRule(args: { closeupMode: string; heroDetail: string; expression?: string }) {
  const detail = args.heroDetail || "the garment's most important real selling detail (embroidery, butti work, neckline craft, print scale, drape, or fabric texture)";
  const primaryGarmentNote =
    "- POSE 5 PRIMARY PRODUCT FOCUS: Pose 5 MUST highlight the PRIMARY UPLOADED PRODUCT GARMENT's key signature details (such as kurti butti work, yoke/chest embroidery, neckline craft, handwork, or weave). It is STRICTLY FORBIDDEN to focus on or fill the frame with a secondary accessory like a dupatta, stole, or scarf when the primary garment has butti work, embroidery, or craftsmanship to showcase. Highlight the core product!";
  if (args.closeupMode === CLOSEUP_PRODUCT_DETAIL) {
    return `- POSE 5 HARD RULE (PRODUCT DETAIL PRIMARY): this frame sells craftsmanship, not a beauty headshot. Fill the frame with ${detail} so construction, embroidery, butti work, print scale, or texture is catalog-readable. Never a full-body or wide hero repeat. Never a face-only crop that shrinks the selling detail. The face may be partial at the edge or omitted entirely when a full face would make that detail too small. If any face is visible it must match the identity lock.\n${primaryGarmentNote}`;
  }
  return `- POSE 5 HARD RULE (FACE + PRODUCT DETAIL): genuine ZOOMED-IN face-to-chest or face-to-waist shot - tighter than the hero pose, never a full-body repeat. Any visible face is the locked identity with ${args.expression ? `the planned expression (${args.expression})` : "a calm, natural expression"}, AND ${detail} must occupy a LARGE, sharp, catalog-readable portion of the same frame - not a tiny hint of embroidery under a beauty close-up.\n${primaryGarmentNote}`;
}

/**
 * Only the guard that matches the recorded cut is sent. Emitting every family's
 * prohibition on every prompt cost ~1.2k characters of the 31.5k budget and
 * diluted the one rule that actually applies to this SKU.
 */
function bottomWearSubstitutionGuard(cutClass: BottomCutClass) {
  const guards: Record<BottomCutClass, string> = {
    farshi:
      `- FARSHI / FARSI HARD LOCK: ${FARSHI_SILHOUETTE_STRUCTURE} Length follows the references (ankle-length clearing the floor to display footwear/juttis, or floor-length). You are STRICTLY FORBIDDEN from rendering palazzo, plain wide-leg pants, a lehenga/skirt (one circular flare with no leg split), dhoti pants, tulip pants, harem pants, Afghani salwars, sharara, gharara, or a gathered ankle cuff. Never drop the three waist pleats on each side, the one large pleat at each side joint, or the 6-inch joined hem and its 4-inch taper. Never flatten the volume into tubular straight trousers, and keep the exact recorded print/motif field (chevron/zigzag, geometric, or floral) at its recorded physical scale, alignment, and density. A wide-open hem or a missing joined hem panel is a failed generation even if the top and the model face are perfect. Keep the feet close: a wide stride, a frozen mid-step, or legs spread apart opens this joined hem into a palazzo and is a failed frame. A small weight shift is allowed only while the 6-inch joined hem stays closed and tapered. This structure outranks any note that says the Farshi is not tapered, must not have a hem band, or names a different hem width. Lace, print, or a plain finish on that panel still follows the references.`,
    palazzo:
      "- PALAZZO HARD LOCK: the legs fall wide and straight or softly flared, with two distinct legs and no skirt merge. Do NOT substitute lehenga/skirt, dhoti, tulip, harem, churidar, or an ankle-cuffed salwar.",
    sharara_gharara:
      "- SHARARA / GHARARA HARD LOCK: the flare begins at or below the knee exactly as recorded (a gharara additionally keeps its ruched/gote knee joint). Do NOT substitute straight trousers, palazzo, farshi, lehenga/skirt, or a salwar.",
    salwar_churidar:
      "- SALWAR / CHURIDAR / PATIALA HARD LOCK: keep the recorded pleat volume and the narrow ankle finish (poncha cuff, or the gathered churi rings at the calf and ankle). Do NOT substitute palazzo, farshi, straight trousers, or a skirt.",
    straight_trouser:
      "- STRAIGHT / CIGARETTE TROUSER HARD LOCK: the legs fall straight and tailored to the recorded hem. Do NOT flare them into palazzos, gather them into a salwar, or taper them into a churidar.",
    skirt_lehenga:
      "- SKIRT / LEHENGA HARD LOCK: one continuous flare with NO separate trouser legs, keeping the recorded panel structure, volume and hem weight. Do NOT substitute trousers, palazzo, farshi, or sharara.",
    other:
      "- BOTTOM-WEAR FAMILY LOCK: reproduce the exact recorded cut and silhouette. Never swap it for a different bottom-wear family (palazzo, farshi, lehenga/skirt, dhoti, tulip, harem, churidar or salwar) and never simplify its volume.",
    none: "",
  };
  return guards[cutClass] || guards.other;
}

function bottomWearSection(args: {
  bottomWear: BottomWearPresentation;
  isSaree: boolean;
  hasBottomReference: boolean;
  skuName?: string;
  productDetails?: string;
  promptReferences?: PromptReference[];
  isTrueBack?: boolean;
}) {
  // `isSaree` is the caller's exact garmentFamily match widened by the pose
  // family, so a session analysed under "ethnic/fusion" that the taxonomy
  // recognises as a saree is never handed bottom-wear instructions.
  if (args.isSaree) return "";
  if (!args.bottomWear.includesBottomWear) {
    const reason = args.bottomWear.mode === "top_only"
      ? "The shoot was configured as TOP ONLY."
      : "The product references prove no bottom garment ships with this SKU.";
    return `TOP-ONLY PRODUCT - DO NOT INVENT A MATCHING SET:
- This SKU is the upper garment only. ${reason}
- STRICTLY FORBIDDEN: rendering coordinated or "matching" bottom wear. Never give the bottoms this product's print, motif, embroidery, border, colour blocking, fabric or trim, and never render anything that would read as a second product piece the customer expects to receive.
- Style the model in one simple, plain, solid, unbranded bottom in a quiet neutral tone that suits the garment and the set (or the bottom the approved styling plan names). It stays visually subordinate at all times.
- Frame every pose so the upper garment - its neckline, sleeves, fit, print and hem line - remains the subject.
- THIS SECTION OUTRANKS THE POSE BRIEF: the pose plan below was written from the product analysis and may still name bottom wear, a "complete set", or a waistband-to-hem read. Ignore every such instruction and follow this section instead.${args.bottomWear.mode === "top_only" && args.bottomWear.recordedInAnalysis ? "\n- The analysis recorded bottom-wear details for this SKU, but the shoot is configured TOP ONLY. Present the top as the product and keep the bottom neutral and non-matching." : ""}`;
  }
  const effectiveCutClass = effectiveBottomCutClass(args.bottomWear.cutClass, args.hasBottomReference, {
    skuName: args.skuName,
    productDetails: args.productDetails,
    details: args.bottomWear.details,
  });
  const guard = bottomWearSubstitutionGuard(effectiveCutClass);
  let cleanedDetails = args.bottomWear.details;
  if (args.hasBottomReference || effectiveCutClass === "farshi") {
    cleanedDetails = cleanedDetails.replace(/\bnot\s+(?:flared\s+)?(?:farshi|farsi|fasi)(?:\s*\/\s*(?:farshi|farsi|fasi))?(?:\s+(?:pajama|pants|salwar))?\b/gi, "").trim();
  }
  if (effectiveCutClass === "farshi") {
    cleanedDetails = withoutFarshiStructureContradictions(cleanedDetails);
  }
  const bottomRefIndex = (args.promptReferences || []).findIndex((ref) => ref.role === "bottom");
  const bottomImageTag = bottomRefIndex >= 0 ? `IMAGE ${bottomRefIndex + 1}` : null;
  const fabricRefIndex = (args.promptReferences || []).findIndex((ref) => ref.role === "fabric_pattern");
  const fabricImageTag = fabricRefIndex >= 0 ? `IMAGE ${fabricRefIndex + 1}` : null;
  const styleRefIndex = (args.promptReferences || []).findIndex((ref) => ref.role === "style_reference");
  const styleImageTag = styleRefIndex >= 0 ? `IMAGE ${styleRefIndex + 1}` : null;

  return `LOCKED BOTTOM WEAR ARCHITECTURE, SILHOUETTE & PRINT - HIGHEST FIDELITY:
Bottom wear specification: ${boundedText(cleanedDetails, 1_200)}
${args.hasBottomReference && bottomImageTag
  ? `- DEDICATED BOTTOM WEAR AUTHORITY (${bottomImageTag}): ${bottomImageTag} (labeled BOTTOM WEAR / FARSHI) is the pixel-level authority for bottom-wear cut, volume, hem, fabric color, and print. Copy ${bottomImageTag} literally onto the lower body in this frame.
- ZERO BLEED FROM UPPER GARMENT: Strictly DO NOT copy the upper kurta's fabric, embroidery, butti, or print${fabricImageTag ? ` (from ${fabricImageTag})` : ""} onto the bottom wear.
- ZERO BLEED FROM STYLE REFERENCE: Strictly DO NOT copy or borrow the trousers, pants, or outfit from ${styleImageTag || "the STYLE REFERENCE"} image. The bottom wear must match ${bottomImageTag} 100%.`
  : args.hasBottomReference
    ? "- A dedicated BOTTOM WEAR / FARSHI image is in the reference manifest. That image is the pixel-level authority for bottom-wear cut, volume, hem, fabric color, and print. Copy it literally onto the worn trousers/skirt."
    : "- Read bottom-wear cut, volume, hem, fabric color, and print from FRONT, BACK, MANNEQUIN, and ADDITIONAL product images where the trousers/skirt are visible. Do not invent a simpler palazzo or a solid/plain bottom."}
- MANDATORY SILHOUETTE PRESERVATION: render the EXACT bottom wear cut, silhouette, leg volume, leg structure, pleat/gather architecture, and hem construction described above and shown in the product references, in EVERY pose.
- ABSOLUTE PROHIBITION ON SILHOUETTE SUBSTITUTION:
${guard}
- COLOR & PRINT TRANSFER: copy the exact base fabric color, sheen, and motif geometry of the bottom wear from the bottom-visible product references${bottomImageTag ? ` (${bottomImageTag})` : ""}. Large-scale prints — whether bold chevron/zigzag geometric patterns, vertical stripes, or metallic florals/bootas — must remain at their exact recorded physical size, alignment, and density. You are STRICTLY FORBIDDEN from rendering the bottoms as solid/undecorated color, as faint dots/speckles, or as a miniaturized micro-print when the references show bold chevron/zigzag or floral motifs. Never use the kurta/upper FABRIC / PATTERN DETAIL close-up as the bottom print.
- FULL-BODY READABILITY: in every full or three-quarter body frame the bottom wear must be visible from waistband to hem with the footwear grounded, and the join where the top's hem meets the bottom must not be hidden by hands, hair, or a dupatta.${args.isTrueBack && bottomImageTag ? (effectiveCutClass === "farshi" ? `\n- TRUE BACK BOTTOM-WEAR ARCHITECTURE: In this rear view, reproduce the Farshi silhouette, two distinct flared legs, and authentic print from ${bottomImageTag} (BOTTOM WEAR / FARSHI) seen from behind. The 6-inch joined hem panel with 4-inch taper must remain clearly visible above the footwear. Never render plain trousers and never copy the style-reference outfit.` : `\n- TRUE BACK BOTTOM-WEAR ARCHITECTURE: In this rear view, reproduce the authentic bottom wear silhouette, cut, and print from ${bottomImageTag} (BOTTOM WEAR / FARSHI) seen from behind. Never render plain unreferenced bottom wear and never copy the style-reference outfit.`) : ""}`;
}

function garmentPoseFamilyHeading(family: GarmentPoseFamily) {
  return family.replace(/_/g, " ").toUpperCase();
}

/**
 * The sixth frame's rule, written around the feature the analysis chose.
 *
 * It names the subject, the distance, and - explicitly - the two frames it must
 * not become, because a generic "showcase" instruction is what produced a second
 * hero shot for a SKU whose bottom wear was the real story.
 */
function showcasePlanHardRule(args: {
  plan: ShowcasePlan;
  shotType: ShowcaseShotType;
  widenedFromCloseup: boolean;
  closeupHeroDetail: string;
  referencePosture?: ReferencePosture;
}) {
  const lowReference = Boolean(args.referencePosture && isLowPosture(args.referencePosture));
  const aesthetic = showcaseAesthetic(args.shotType, args.plan.featureRegion, lowReference);
  const lines = [
    `- SHOWCASE FRAME SUBJECT: ${args.plan.heroFeature}. This frame exists to sell that one feature${args.plan.whyItSells ? ` - ${args.plan.whyItSells}` : ""
    }. It must be large, sharp, unobstructed, and unmistakably what the frame is about.`,
    `- SHOWCASE FRAME DISTANCE: ${lowReference && STANDING_SHOWCASE_SHOTS.includes(args.shotType)
      ? "Frame around the REFERENCE POSE MATCH posture, wide enough that the named feature reads at its best and is unmistakably the subject of the frame."
      : showcaseShotDirection(args.shotType)}`,
    `- SHOWCASE AESTHETIC PHOTOSHOOT & DETAIL FIDELITY: ${aesthetic} Render every stitch, motif, border edge, and fabric fold of ${args.plan.heroFeature} at true physical scale and material sheen.`,
    "- SHOWCASE FRAME MUST NOT DUPLICATE: this is not a second hero shot. Do not reproduce Pose 1's straight-on, full-length, whole-outfit composition. If this frame is full length, the angle, distance, stance and composition must read as a different photograph whose subject is the named feature, not the outfit as a whole.",
  ];
  if (args.closeupHeroDetail) {
    lines.push(
      `- SHOWCASE FRAME MUST NOT REPEAT THE CLOSE-UP: Pose 5 already sells "${args.closeupHeroDetail}" in a tight crop. This frame must add coverage that pose does not give${args.widenedFromCloseup
          ? " - so shoot the named feature at a wider distance here, showing how it sits on the worn garment rather than re-cropping the same detail."
          : "."
      }`,
    );
  }
  if (args.plan.distinctFrom) {
    lines.push(`- SHOWCASE FRAME DISTINCTION: ${args.plan.distinctFrom}`);
  }
  for (const rule of args.plan.visibilityRules.slice(0, 4)) {
    lines.push(`- ${rule}`);
  }
  lines.push("- Everything else stays locked: same model identity, styling, footwear, set, backdrop, lighting, and the exact garment design, print, colour, fit and construction the product references show.");
  return lines.join("\n");
}

const STANDING_SHOWCASE_SHOTS: readonly ShowcaseShotType[] = ["full_body_feature", "movement_feature"];

/**
 * The full-length and movement aesthetics prescribe a planted standing stance.
 * An adopted folded posture (seated, kneeling, ...) takes the stance from the
 * REFERENCE POSE MATCH block instead; the lighting and readability goals stay.
 */
function showcaseAesthetic(shotType: ShowcaseShotType, region: ShowcaseFeatureRegion, lowReference: boolean) {
  if (!lowReference || !STANDING_SHOWCASE_SHOTS.includes(shotType)) return showcaseAestheticDirection(shotType, region);
  return `Editorial fashion photoshoot aesthetics: the REFERENCE POSE MATCH posture at a soft camera angle so the ${region.replace(/_/g, " ")} reads clearly, directional side-key lighting that carves fabric drape, and grounded contact shadows.`;
}

/**
 * Pose 6 rule when the analysis recorded no showcase plan. With an adopted
 * reference posture only the stance clauses it would contradict are swapped for
 * the REFERENCE POSE MATCH block; every garment-visibility clause stays.
 */
function showcaseHardRule(intent: ShowcaseIntent, family: GarmentPoseFamily, expression = "", referencePosture?: ReferencePosture) {
  const lowReference = Boolean(referencePosture && isLowPosture(referencePosture));
  if (intent === "saree_drape") {
    const bengali = family === "saree_bengali";
    return `- SHOWCASE FRAME HARD RULE (DRAPE-LED): this frame sells the drape. The pallu${bengali ? " (aanchal)" : ""} is the subject - place it exactly as the drape plan states (same shoulder, same fall direction, same visible length) and open it low and flat so its artwork, motif scale, end treatment and border are completely readable. ${lowReference ? "Pose per the REFERENCE POSE MATCH block; keep the pleat stack neat and evenly stacked, and the upper and lower borders continuous and identical in width." : "Front pleats stay flat, evenly stacked and vertical; upper and lower borders stay continuous and identical in width; the hem border stays level."} No hand, arm, hair or prop crosses the pallu artwork.${bengali ? " Hold the upright, serene Bengali posture - level shoulders, tall spine, small deliberate movement." : ""} ${showcaseAestheticDirection("drape_feature", "pallu")} Never a repeat of the hero framing.`;
  }
  if (intent === "set_full_length") {
    return `- SHOWCASE FRAME HARD RULE (COMPLETE SET): one head-to-toe frame that proves the top and the bottom wear are a single coordinated set. The top must read from shoulder seam to hem at its true length and fit, AND the bottom wear must read from waistband to hem with its exact cut, leg volume, pleat architecture, hem finish, colour and print. ${lowReference ? "Pose per the REFERENCE POSE MATCH block; keep the bottom-wear hem and the footwear readable." : "Footwear is grounded and fully visible."} Nothing may crop the hem or the footwear. ${showcaseAesthetic("full_body_feature", "bottom_wear", lowReference)}`;
  }
  if (intent === "playful_backdrop") {
    return `- SHOWCASE FRAME HARD RULE (PLAYFUL, SET-MATCHED): ${referencePosture ? "pose per the REFERENCE POSE MATCH block, interacting only with the backdrop and props ALREADY established in this shoot." : "a natural, relaxed catalog pose that interacts with the backdrop and props ALREADY established in this shoot - a small weight shift, a gentle turn, a shoulder tilt, or a relaxed lean on an element already present."} ${expression ? `Expression: ${expression}.` : "Keep the expression calm and genuine."} Do not freeze a mid-laugh, a walking stride, or a wide leg split. Introduce no new prop, furniture, plant or architecture. The neckline, sleeve shape, hem line, fit and print stay unobstructed, uncrumpled and in frame. ${showcaseAesthetic("movement_feature", "upper_garment", lowReference)}`;
  }
  return `- SHOWCASE FRAME HARD RULE (TRUE FALL AND LENGTH): a full-length frame proving the garment's real fall, fit and length. ${lowReference ? "Pose per the REFERENCE POSE MATCH block; keep the hem complete inside the frame and the garment's fit and length readable, never hitched, tucked, gathered or shortened." : "Side seams hang straight, the hem stays level and complete inside the frame, and the garment is never hitched, tucked, gathered or shortened. Footwear grounded and visible."} ${showcaseAesthetic("full_body_feature", "silhouette", lowReference)}`;
}

function pose6HardRule(args: {
  showcaseShot: { plan: ShowcasePlan; shotType: ShowcaseShotType; widenedFromCloseup: boolean } | null;
  showcaseIntent: ShowcaseIntent;
  poseFamily: GarmentPoseFamily;
  closeupHeroDetail: string;
  expression?: string;
  /** Set when the pose plan matched this frame to the STYLE REFERENCE posture. */
  referencePosture?: ReferencePosture;
}) {
  const coreRule = args.showcaseShot
    ? showcasePlanHardRule({
      plan: args.showcaseShot.plan,
      shotType: args.showcaseShot.shotType,
      widenedFromCloseup: args.showcaseShot.widenedFromCloseup,
      closeupHeroDetail: args.closeupHeroDetail,
      referencePosture: args.referencePosture,
    })
    : showcaseHardRule(args.showcaseIntent, args.poseFamily, args.expression, args.referencePosture);
  const posture = args.referencePosture
    ? `the adopted STYLE REFERENCE ${args.referencePosture} posture from the REFERENCE POSE MATCH block (never a Pose 1 repeat)`
    : "natural posture diverging from Pose 1";
  return `POSE 6 HARD RULE (AESTHETIC FEATURE SHOWCASE & DETAIL LOCK):
${coreRule}
- EDITORIAL PHOTOSHOOT EXECUTION: Deliver magazine-grade fashion photography with intentional camera framing, directional studio lighting that sculpts fabric texture and embroidery relief, ${posture}, strictly two anatomically natural arms and hands clear of the featured detail, and 100% locked model, set, styling, and garment fidelity.`;
}

const SEATED_EDITORIAL_REQUIREMENT = `SEATED EDITORIAL POSE REQUIREMENT (POSE 4):
- The product notes demand an elegant seated pose for this frame.
- Model must be seated gracefully on a minimal studio bench, architectural plinth/cube, or clean studio step that already belongs to the established set (style reference / Pose 1). Do not bring in new furniture.
- Both legs, bottom wear (farshi/trousers/pleats), hemline, and footwear MUST remain fully visible, untangled, and unbunched.
- Posture must be upright, poised, and relaxed editorial - showcasing garment fit and draping without wrinkling or obscuring key details.`;

function poseVariationDirective(
  pose4CroppedAboveAnkles = false,
  adopted: { creative: SlotPlan | null; showcase: SlotPlan | null } = { creative: null, showcase: null },
  styleIsIdentity = false,
): string {
  const text = [
    "6-POSE PLAN VARIATION DIRECTIVE (MANDATORY PHYSICAL DIVERGENCE):",
    "Every shoot executes a distinct 6-pose plan where each frame has a unique physical geometry and purpose. Under NO circumstances should any frame repeat a static frontal standing pose:",
    "- Pose 1 (full_front): Natural straight-on catalog hero in the requested output aspect ratio, weight slightly on one leg, shoulders relaxed, complete silhouette readable.",
    "- Pose 2 (angled): Mandatory 35-to-45 degree turn of torso and hips, both feet planted and close. Never a walking stride or a lifted foot. Keep a joined hem closed.",
    "- Pose 3 (back): 180° true full rear view, shoulders and hips facing fully away; hair and dupatta swept forward for 100% unobstructed rear view. Same face identity and the same style-reference backdrop.",
    adopted.creative
      ? `- Pose 4 (creative): Matches the STYLE REFERENCE person's ${adopted.creative.posture} posture, as the pose plan adopted - body position and attitude only, never the reference outfit, face or handheld objects. Clearly not Pose 1.`
      : pose4CroppedAboveAnkles
      ? "- Pose 4 (creative): A natural editorial stance that is clearly not Pose 1 - relaxed contrapposto or a soft lean honoring the planned editorial crop, or a seated editorial only when the product notes demand sitting. Never copy the style photo's pose. Never a frozen walking stride, a spin, or a wide leg split."
      : "- Pose 4 (creative): A natural editorial stance that is clearly not Pose 1 - relaxed contrapposto or a soft lean, both feet grounded and close, or a seated editorial only when the product notes demand sitting. Never copy the style photo's pose. Never a frozen walking stride, a spin, or a wide leg split.",
    "- Pose 5 (closeup): Genuinely zoomed-in detail crop (face-and-detail or tight product-detail); strictly prohibit full-body hero repeat.",
    adopted.showcase
      ? `- Pose 6 (showcase): A distinct variation of the STYLE REFERENCE person's ${adopted.showcase.posture} posture, as the pose plan adopted, that sells the named feature without repeating Pose 1 or Pose 4. Body position only, never the reference outfit, face or handheld objects.`
      : "- Pose 6 (showcase): A distinct natural catalog stance and framing that sells the named feature without repeating Pose 1. Keep the feet close enough that a joined or tapered hem stays intact.",
  ].join("\n");
  return styleIsIdentity ? styleIdentityQuarantineText(text) : text;
}

const REFERENCE_STANCE = "Body position as the REFERENCE POSE MATCH block states.";
const REFERENCE_POSTURE_ONLY = "its posture is used only as the REFERENCE POSE MATCH block directs";

function generationBottomWear(args: {
  session: JsonRecord; skuName?: string; productDetails?: string; references: PromptReference[]; bottomWearMode?: unknown;
}) {
  const hasBottomReference = args.references.some((reference) => reference.role === "bottom");
  const skuName = String(args.skuName || "");
  const productDetails = String(args.productDetails || "");
  // Analysis records what the references prove; the shoot option records how the
  // merchandiser wants it presented. "auto" keeps them in sync, an explicit
  // choice wins, and a top-only shoot never gets an invented matching set.
  const bottomWear = resolveBottomWearPresentation({
    mode: args.bottomWearMode ?? args.session.bottomWearMode ?? args.session.bottom_wear_mode,
    productIdentity: objectValue(args.session.productIdentity),
    skuName,
    productDetails,
    hasBottomReference,
  });
  const farshi = bottomWear.includesBottomWear &&
    effectiveBottomCutClass(bottomWear.cutClass, hasBottomReference, { skuName, productDetails, details: bottomWear.details }) === "farshi";
  return { bottomWear, hasBottomReference, farshi };
}

/**
 * The Farshi verdict composeGenerationPrompt uses, from the same job inputs.
 * The worker passes it to promptReferenceSlots and buildPoseQaPrompt({ farshi })
 * so QA judges the frame against the prompt that made it.
 */
export function isFarshiGeneration(args: {
  session: JsonRecord; skuName?: string; productDetails?: string; references: PromptReference[]; bottomWearMode?: unknown;
}): boolean {
  return generationBottomWear(args).farshi;
}

/**
 * The stored Pose 4 / Pose 6 adoptions this prompt honours. A stale stored plan
 * must never seat (or kneel, crouch, recline) a Farshi frame, so a low posture
 * is dropped there, mirroring referenceAdoptionBlockReason; a walking posture is
 * never honoured. Feed the QA call's referencePoseMatch and roleLabel
 * referencePoseNumbers from the same result, with farshi from isFarshiGeneration.
 */
export function promptReferenceSlots(session: unknown, farshi: boolean): Record<AdoptableSlot, SlotPlan | null> {
  const slot = (id: AdoptableSlot) => {
    const plan = slotReferencePlan(session, id);
    return plan && plan.posture !== "walking" && !(farshi && isLowPosture(plan.posture)) ? plan : null;
  };
  return { creative: slot("creative"), showcase: slot("showcase") };
}

/**
 * The adopted-posture directive as the prompt and QA state it: handheld clauses
 * and frozen-step sentences are cut (re-leading with the posture when a sentence
 * went), capped at MAX_REFERENCE_DIRECTIVE.
 */
export function referencePoseDirectiveText(posture: string, directive: unknown): string {
  const lead = `Match the STYLE REFERENCE person's ${posture} posture.`;
  const held = sanitizeHeldObjectText(String(directive ?? "").replace(/\s+/g, " ").trim(), lead) || lead;
  const parts = held.split(/(?<=[.!;])\s+/).filter(Boolean);
  const kept = parts.filter((part) => !FROZEN_STRIDE_PATTERN.test(part));
  const text = kept.length === parts.length ? held : [lead, ...kept.filter((part) => part !== lead)].join(" ");
  return boundedText(text, MAX_REFERENCE_DIRECTIVE);
}

/**
 * When the STYLE REFERENCE is also the model identity, an adopted Pose 4/6 must not
 * forbid its face and hair (they follow the FACE & IDENTITY LOCK). Clothing and
 * handheld objects stay quarantined. Rewrites the stored directive and this file's clauses.
 */
export function styleIdentityQuarantineText(text: string): string {
  return text
    .replace(
      /never the reference (clothing|outfit), face, hair or anything in the hands(?: \(jewellery follows the styling plan\))?/g,
      "never the reference $1 or anything in the hands (face and hair follow the FACE & IDENTITY LOCK; jewellery follows the styling plan)",
    )
    .replace(
      /never the reference outfit, face or handheld objects/g,
      "never the reference outfit or handheld objects (face and hair follow the FACE & IDENTITY LOCK)",
    );
}

/**
 * Pose 4 / Pose 6 when session.posePlanning adopted the STYLE REFERENCE
 * posture. Leads the POSE REQUIREMENT block, whose head survives every
 * compaction tier, and replaces that frame's CURRENT FRAME line.
 */
function referencePoseMatchBlock(poseNumber: number, slot: SlotPlan, farshi: boolean, styleIsIdentity = false): string {
  const text = [
    `REFERENCE POSE MATCH (POSE ${poseNumber}):`,
    `- ${referencePoseDirectiveText(slot.posture, slot.directive)}`,
    "- This frame only, with no new furniture: never the reference outfit, face, hair or anything in the hands (jewellery follows the styling plan). Exactly two arms and two hands, each joined to a visible forearm.",
    farshi ? "- FARSHI: keep the feet close and the 6-inch joined hem closed and tapered; adapt this posture without a stride or a leg spread." : "",
    "- This block outranks any generic stance line elsewhere in this prompt; product, anatomy and bottom-wear locks still win.",
  ].filter(Boolean).join("\n");
  return styleIsIdentity ? styleIdentityQuarantineText(text) : text;
}

function currentFrameLine(
  pose: StudioPose & { poseNumber: number },
  isSittingDemanded: boolean,
  croppedAboveAnkles = false,
  expression = "",
): string {
  const poseNum = pose.poseNumber;
  if (poseNum === 1 || pose.id === "full_front") {
    return `CURRENT FRAME (POSE 1 - STRAIGHT-ON HERO): Natural straight-on catalog hero in the requested output aspect ratio. Weight settles slightly on one leg, shoulders and arms stay relaxed, and the full outfit reads from head to hem. ${expression ? `Expression: ${expression}.` : "A calm expression or a small genuine smile."} Never a rigid mannequin stance or a wide stock-photo grin.`;
  }
  if (poseNum === 2 || pose.id === "angled") {
    return "CURRENT FRAME (POSE 2 - MANDATORY 3/4 TURN): Torso and hips MUST physically rotate 35 to 45 degrees. Both feet stay planted and close; never a walking stride or a lifted foot. DO NOT render a flat frontal standing pose or repeat Pose 1. Reveal side silhouette, garment depth, side seams, and sleeve shape.";
  }
  if (poseNum === 3 || pose.id === "back") {
    return "CURRENT FRAME (POSE 3 - 180° REAR VIEW): Model faces fully away from camera. Shoulders and hips square to rear. Hair swept forward, dupatta draped forward over arms/front so rear construction is 100% visible.";
  }
  if (poseNum === 4 || pose.id === "creative") {
    if (isSittingDemanded) {
      return "CURRENT FRAME (POSE 4 - SEATED EDITORIAL): Elegant seated editorial posture on a minimal studio bench or architectural step from the established set. Both legs, bottom wear volume, hemline, and footwear remain fully visible and beautifully arranged.";
    }
    return croppedAboveAnkles
      ? "CURRENT FRAME (POSE 4 - NATURAL EDITORIAL STANCE): A relaxed catalog pose that is clearly not Pose 1: contrapposto or a soft three-quarter lean matching the planned editorial crop, garment hanging with gravity. NEVER a frozen mid-step, a spin, a wide leg split, or a repeat of the flat hero stance."
      : "CURRENT FRAME (POSE 4 - NATURAL EDITORIAL STANCE): A relaxed catalog pose that is clearly not Pose 1: contrapposto or a soft three-quarter lean, both feet grounded and close, garment hanging with gravity. NEVER a frozen mid-step, a spin, a wide leg split, or a repeat of the flat hero stance. A joined Farshi hem stays closed.";
  }
  if (poseNum === 5 || pose.id === "closeup") {
    return "CURRENT FRAME (POSE 5 - ZOOMED-IN DETAIL): Genuinely zoomed in on product craftsmanship and selling details. NEVER repeat a full-body or wide hero frame. The close-up MUST highlight the primary uploaded garment's signature details (such as kurti butti work, chest/yoke embroidery, or neckline craft), and must NEVER focus on a secondary accessory like a dupatta or stole.";
  }
  if (poseNum === 6 || pose.id === "showcase") {
    return "CURRENT FRAME (POSE 6 - SIGNATURE FEATURE SHOWCASE): Framing, angle, and physical stance MUST visibly diverge from Pose 1, with a natural weight shift that keeps the named feature readable. Do not split the legs wide. Never repeat the flat frontal hero stance. Same model face, same uploaded product, and the same style-reference backdrop as the other five frames.";
  }
  return "";
}

function referenceImageScopeDirective(hasModelReference: boolean, useStyleAsModelIdentity = false, referenceFrame = false): string {
  return [
    "REFERENCE IMAGE SCOPE & PRODUCT INTEGRITY:",
    hasModelReference
      ? "- MODEL FACE: the MODEL FACE REFERENCE is the only face, hair, skin tone, and body-proportion source for all six poses. Discard the face, hair, and body in the STYLE REFERENCE and in every product photo. Do not average those faces together."
      : useStyleAsModelIdentity
        ? `- MODEL FACE: the user attached the same image as MODEL FACE REFERENCE and STYLE REFERENCE, so that person's face, hair, skin tone, and body proportions are the model identity for all six poses. ${referenceFrame ? `Still discard that image's clothing and handheld objects; ${REFERENCE_POSTURE_ONLY}.` : "Still discard that image's clothing, posture, and handheld objects."}`
        : `- MODEL FACE: no MODEL FACE REFERENCE is attached. Cast an original photorealistic adult model matching Model Identity below in Pose 1, and keep that face, hair, skin tone, and body proportions identical across Poses 2-6. ${referenceFrame ? `Discard the STYLE REFERENCE person's face, clothing, and handheld props; ${REFERENCE_POSTURE_ONLY}.` : "Discard the STYLE REFERENCE person's face, clothing, pose, pillar-leaning posture, and handheld props."}`,
    "- STYLE REFERENCE BACKDROP: the STYLE REFERENCE is the only source for the photoshoot backdrop, wall, floor, lighting, and camera mood on all six poses, including the back view and any crop. Discard its clothing completely.",
    "- ABSOLUTE PROHIBITION ON COPYING THE STYLE REFERENCE GARMENT: The clothing, outfit, saree, dress, fabric, color, embroidery, or prints shown on the person in the STYLE REFERENCE image MUST BE 100% DISCARDED. Absolutely DO NOT copy, borrow, blend, or reproduce the style reference's clothing onto the model.",
    "- PRODUCT INTEGRITY (SOLE TRUTH FROM UPLOADED PRODUCT IMAGES): the product itself (fabric, colors, prints, pattern geometry, neckline, sleeves, hem, embroidery, trims, closures, and complete bottom wear) MUST come exclusively from uploaded product references. The product must NOT be redesigned, altered, recolored, or restyled based on what the reference image shows. If this written profile disagrees with the product photos on motif, neckline, sleeves, or hem, the photos win. Discard every face and every background inside those product photos.",
    referenceFrame
      ? `- DO NOT BLEND THE REFERENCE OUTFIT: motif, neckline, and sleeves come only from the product photos. Do not copy the Pose 1 stance or handheld props; the style-reference posture is used only as the REFERENCE POSE MATCH block directs.`
      : "- DO NOT BLEND THE REFERENCE OUTFIT: motif, neckline, and sleeves come only from the product photos. Do not copy the style or Pose 1 stance, or handheld props.",
  ].join("\n");
}

/**
 * Uncompacted tail block for props the product notes ask for (requestedHandheldProps).
 * Empty when nothing is requested, so every other shoot keeps its no-props rules.
 */
export function requestedPropsBlock(props: RequestedHandheldProps, poseId: string): string {
  if (!props.groups.length) return "";
  if (poseId === "closeup") {
    return `REQUESTED PROPS (FROM THE PRODUCT NOTES): "${props.note}". This Pose 5 craft crop keeps every prop out of frame so the craft detail stays clear.`;
  }
  const back = poseId === "back";
  const holds = [
    props.groups.includes("drink") ? "one hand holds the drink" : "",
    props.groups.includes("bag")
      ? back ? "the bag hangs from one shoulder or forearm at the side" : "the bag hangs from the opposite shoulder or forearm, as the STYLE REFERENCE carries it"
      : "",
    props.groups.some((group) => group !== "drink" && group !== "bag") ? "any other requested prop is held as the STYLE REFERENCE shows it" : "",
  ].filter(Boolean).join("; ");
  return `REQUESTED PROPS (FROM THE PRODUCT NOTES - CARRY THEM OVER): "${props.note}". Carry over ${props.labels.join(" and ")} exactly as the STYLE REFERENCE shows them (same object, shape, colour, material and size), identical in every frame: ${holds}. ${back
    ? "From behind they stay at the sides and must not cover the back neckline, the stripes or print, the side slits or the hem."
    : "They must not cover the neckline, the embroidery or print, the side slits, the hem or the bottom-wear construction."} Each prop is held by a visible hand joined to its forearm or hangs from a shoulder or forearm - exactly two arms and two hands. This request overrides the general no-props rules for these props only; every other handheld object stays excluded.`;
}

/** Uncompacted identity reminder naming the exact manifest image that carries the face. */
export function identityCheckLine(imageNumber: number, label: string, backView: boolean): string {
  return backView
    ? `IDENTITY CHECK: the face is turned away, but the skin tone, hair colour, length and texture, and body proportions must match IMAGE ${imageNumber} (${label}).`
    : `IDENTITY CHECK: the face, skin tone and hair must match IMAGE ${imageNumber} (${label}) exactly - the same face shape, eyes, brows, nose, lips and jaw; the same skin tone; the same hair colour, length, texture and parting. Do not beautify, slim, lighten or swap the face.`;
}

/**
 * Recorded rear facts for a non-saree true back view. Evidence without a direct back-image
 * source is filtered out of the back prompt, which also dropped the garment length, rear
 * panel and slits; these fields describe the rear (or the whole garment) and are safe there.
 */
export function rearViewChecklist(productIdentity: unknown, includesBottomWear: boolean): string {
  const product = objectValue(productIdentity);
  const fact = (value: unknown, max = 220) => boundedText(String(value ?? "").replace(/\s+/g, " "), max);
  const orientation = objectValue(product.patternGeometry).orientation;
  const slits = (Array.isArray(product.detailPlacementMap) ? product.detailPlacementMap : [])
    .map((entry) => String(entry ?? ""))
    .filter((entry) => /\bslits?\b/i.test(entry))
    .slice(0, 2);
  const lines = [
    product.length ? `- Length and hem: ${fact(product.length)}; the back hem sits at the same height as the front hem.` : "",
    product.backConstruction ? `- Back panel: ${fact(product.backConstruction)}.` : "",
    orientation ? `- Print or stripe direction: ${fact(orientation, 160)}, running the same way as in the BACK PRODUCT image.` : "",
    slits.length ? `- Side slits: ${slits.map((entry) => fact(entry, 160)).join("; ")}. Seen from behind at both side seams, at the same height as the front.` : "",
    includesBottomWear ? "- Bottom wear from behind: the same cut, volume, fall and hem panel as the BOTTOM WEAR reference, both legs visible." : "",
  ].filter(Boolean);
  return lines.length ? `REAR VIEW CHECKLIST (RECORDED PRODUCT FACTS - CHECK EACH AGAINST THE BACK PRODUCT IMAGE):\n${lines.join("\n")}` : "";
}

function anatomicalIntegrityDirective(): string {
  return [
    "STRICT HUMAN ANATOMY & NATURAL LIMB INTEGRITY (ZERO TOLERANCE FOR EXTRA LIMBS):",
    "- EXACTLY TWO ARMS AND TWO HANDS: The model must have strictly and exactly TWO arms and TWO hands in total. It is STRICTLY FORBIDDEN to render a third hand, extra hand, extra arm, duplicate wrist, floating hand, or phantom limb anywhere.",
    "- CONTINUOUS EXTERIOR ANATOMY: Arms and hands stay outside the closed garment perimeter with soft human bends (never mannequin stiff straight arms, splayed plastic fingers, fake slit hands, forearm clawing, or fingers covering chest embroidery).",
    "- COORDINATED HAND PLACEMENT: When one hand is holding, touching, or adjusting the garment/pallu/dupatta, the other hand must be naturally placed outside the closed perimeter. NO THIRD HAND may appear resting on the waist, navel, or pleats.",
    "- NATURAL FINGERS: Render five cleanly separated natural fingers per hand (never fused, webbed, mangled, missing, or extra fingers).",
  ].join("\n");
}

function lockedDetailsDirective(): string {
  return [
    "LOCKED DETAILS ACROSS ALL SIX IMAGES (AVOID CONSISTENCY MISTAKES):",
    "- Background / Backdrop: Exact same physical room, wall finish, flooring, lighting, and shadows across all 6 frames without drift.",
    "- Footwear: The exact same footwear (pair, style, heel, color, finish) across all 6 frames.",
    "- Ornaments & Jewellery: Identical jewellery pieces, metal type, count, and placement across all 6 frames.",
    "- Accessories & Styling: Identical makeup, hair, bag, belt, and styling treatment across all 6 frames.",
    "- Product Layout & Product Design: Garment construction, cuts, seams, trims, embroidery geometry, pattern repeat, and bottom-wear architecture remain locked across all 6 frames.",
  ].join("\n");
}

// Cached analyses can still ask for a stride. The 1,400-character pose block is
// the first section compacted, so that corrective line disappears while the raw
// prompt and body position survive. Rewrite only those pose fields.
const UNPLANTED_POSE_PATTERN = /\b(?:walk(?:ing|s)?|strides?|mid-step|stepped|lifted foot|foot lifted|step(?:s|ping)? forward|feet (?:naturally )?spaced|feet separated|feet apart|shoulder-width|shoulder width|legs spread|wide stance)\b/i;
/** A frozen step is never adoptable (posePlanning.ts), so it is cut from a reference directive too. */
const FROZEN_STRIDE_PATTERN = /\b(?:walk(?:ing|s)?|strid(?:e|es|ing)|mid-(?:step|stride)|lifted foot|foot lifted|step(?:s|ping)? forward)\b/i;
const COPIED_SITTING_PATTERN = /\b(?:sit|sits|sitting|seated)\b/i;
const HELD_OBJECT_PATTERN = FORBIDDEN_HELD_OBJECT_PATTERN;
/** Reference postures the shared patterns above do not cover (planned expression and attitude lines only). */
const REFERENCE_POSTURE_WORD_PATTERN = /\b(?:lean(?:s|ing)?|kneel(?:s|ing)?|crouch(?:es|ing)?|squat(?:s|ting)?|reclin(?:e|es|ed|ing)|lying|lounging|perched)\b/i;

function plantedPoseReplacement(
  pose: { id: string; poseNumber: number },
  sitting: boolean,
  croppedAboveAnkles = false,
): string {
  const poseNumber = pose.poseNumber;
  const id = pose.id;
  if (poseNumber === 2 || id === "angled") {
    return "Torso and hips turn 35 to 45 degrees. Both feet stay planted and close.";
  }
  if ((poseNumber === 4 || id === "creative") && sitting) {
    return "Elegant seated editorial. Hem and footwear stay visible.";
  }
  if (poseNumber === 4 || id === "creative") {
    return croppedAboveAnkles
      ? "Natural editorial stance with relaxed contrapposto matching the planned crop."
      : "Natural editorial stance. Both feet stay planted and close.";
  }
  if (poseNumber === 6 || id === "showcase") {
    return "Planted weight shift. Both feet stay close.";
  }
  return "Natural catalog stance. Both feet stay planted and close.";
}

/**
 * Copied-pose scrubbing for one frame: false strips sitting and stride wording,
 * true keeps sitting, "reference" (a pose-plan reference-matched Pose 4/6) also
 * keeps sitting and points at the REFERENCE POSE MATCH block. Stride wording and
 * held objects are stripped in every frame: walking is never adoptable.
 */
type PoseScrub = boolean | "reference";

function withoutUnplantedPose(value: unknown, replacement: string): string {
  const text = String(value ?? "");
  return UNPLANTED_POSE_PATTERN.test(text) || HELD_OBJECT_PATTERN.test(text) ? replacement : text;
}

function catalogPoseText(value: unknown, replacement: string, keepSitting: PoseScrub): string {
  const planted = withoutUnplantedPose(value, replacement);
  if (keepSitting || !COPIED_SITTING_PATTERN.test(planted)) return planted;
  return replacement;
}

const RELAXED_HANDS = "Both hands relaxed and clear of the garment, holding nothing copied from the style or model photo.";
const CALM_EXPRESSION = "Calm natural expression.";
const SET_PROPS_ONLY = "Set props only. Do not copy objects held in the style or model photo.";
const PLANTED_DISTINCTION = "Distinct from the other frames. Both feet stay planted and close.";
const PLANTED_DISTINCTION_CROPPED = "Distinct from the other frames, matching the planned editorial crop.";
const PLANTED_VISIBILITY = "The named feature stays readable. Both feet stay planted and close.";
const PLANTED_VISIBILITY_CROPPED = "The named feature stays readable within the planned editorial crop.";

const CREATIVE_BODY_KEYS = new Set(["bodyposition", "body_position", "prompt", "description"]);
const CREATIVE_HAND_KEYS = new Set(["handplacement", "hand_placement"]);
const CREATIVE_HELD_KEYS = new Set(["propusage", "prop_usage"]);
const CREATIVE_DISTINCTION_KEYS = new Set(["distinctfrom", "distinct_from"]);
const CREATIVE_VISIBILITY_KEYS = new Set(["visibilityrules", "visibility_rules"]);
const CREATIVE_CAMERA_KEYS = new Set([
  "composition",
  "cameraperspective",
  "camera_perspective",
  "modelstyling",
  "model_styling",
  "photographystyle",
  "photography_style",
  "framing",
]);
const ROOM_CAMERA_ONLY = "Room and camera only.";

function creativeDirectionKey(key: string) {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function withoutHeldObjectClauses(value: string, allowNotes = "") {
  return sanitizeHeldObjectText(value, SET_PROPS_ONLY, allowNotes);
}

// Stored sessions can still carry the older rule that demanded catchlights.
// That sentence invents an uncovered face when the identity photo hides the eyes.
const INVENTED_CATCHLIGHT_PATTERNS: Array<[string, string]> = [
  ["correctly shaped and aligned eyes with realistic catchlights", "eyes as the identity photo shows them, including a cover"],
  ["anatomically correct eyes with realistic catchlights and correctly aligned gaze", "eyes as the identity photo shows them, including a cover"],
];

const CATCHLIGHT_PATTERN = /\bcatch-?lights?\b/i;

function withoutInventedCatchlights(value: string) {
  const replaced = INVENTED_CATCHLIGHT_PATTERNS.reduce((text, [from, to]) => text.replaceAll(from, to), value);
  if (!CATCHLIGHT_PATTERN.test(replaced)) return replaced;
  const kept = replaced.split(/(?<=[.!;])\s+/).map((part) => part.trim()).filter((part) => part && !CATCHLIGHT_PATTERN.test(part));
  return kept.join(" ").trim() || "Eyes stay as the identity photo shows them, including a cover.";
}

function withoutPoseOrHeldClauses(value: string, emptyFallback: string, dropSitting = false) {
  const copied = (part: string) => UNPLANTED_POSE_PATTERN.test(part)
    || HELD_OBJECT_PATTERN.test(part)
    || (dropSitting && COPIED_SITTING_PATTERN.test(part));
  if (!copied(value)) return value;
  const kept = value.split(/(?<=[.!;])\s+/).map((part) => part.trim()).filter((part) => part && !copied(part));
  return kept.join(" ").trim() || emptyFallback;
}

function poseInstructionText(value: unknown, sitting: PoseScrub, emptyFallback: string): string {
  return withoutPoseOrHeldClauses(String(value ?? ""), emptyFallback, !sitting);
}

function poseTitleText(value: unknown, sitting: PoseScrub): string {
  const text = String(value ?? "");
  const copiedPose = UNPLANTED_POSE_PATTERN.test(text)
    || HELD_OBJECT_PATTERN.test(text)
    || (!sitting && COPIED_SITTING_PATTERN.test(text));
  return copiedPose ? "Catalog stance" : text;
}

function poseListItem(value: unknown, sitting: PoseScrub): string {
  return poseInstructionText(value, sitting, "");
}

const IDENTITY_FACE_PATTERN = /\b(?:eyes?|sunglass(?:es)?|shades|cover(?:ed|ing)?|braid|jaw|nose|lips?|hair|skin|face)\b/i;
const HELD_EYEWEAR_PATTERN = /\b(?:(?:holds?|holding|carries|carrying|gripping|clutching)\s+(?:a\s+|her\s+|his\s+|their\s+|the\s+|pair\s+of\s+)?(?:sunglass(?:es)?|eyewear|shades)|(?:sunglass(?:es)?|eyewear|shades)\s+(?:in\s+(?:her\s+|his\s+|their\s+|one\s+)?hands?|held))\b/i;

function globalRegex(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function withoutCopiedPoseInIdentity(
  value: string,
  sitting: PoseScrub,
  preserveFacialEyewear = false,
): string {
  const dropSitting = !sitting;
  const heldPattern = preserveFacialEyewear
    ? FORBIDDEN_NON_EYEWEAR_HELD_OBJECT_PATTERN
    : HELD_OBJECT_PATTERN;
  const poseLike = (part: string) => UNPLANTED_POSE_PATTERN.test(part)
    || new RegExp(heldPattern.source, heldPattern.flags.replace(/g/g, "")).test(part)
    || (preserveFacialEyewear && HELD_EYEWEAR_PATTERN.test(part))
    || (dropSitting && COPIED_SITTING_PATTERN.test(part));
  if (!poseLike(value)) return value;
  const kept = value.split(/(?<=[.!;])\s+/).map((part) => {
    const clause = part.trim();
    if (!clause || !poseLike(clause)) return clause;
    if (!IDENTITY_FACE_PATTERN.test(clause)) return "";
    let text = dropSitting ? clause.replace(globalRegex(COPIED_SITTING_PATTERN), "") : clause;
    text = text.replace(globalRegex(UNPLANTED_POSE_PATTERN), "");
    text = text.replace(globalRegex(heldPattern), "");
    if (preserveFacialEyewear) {
      text = text.replace(globalRegex(HELD_EYEWEAR_PATTERN), "");
    }
    text = text
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;])/g, "$1")
      .replace(/^[,.;\s]+/, "")
      .trim();
    return /[a-z0-9]/i.test(text) ? text : "";
  }).filter(Boolean);
  return kept.join(" ").trim() || "Eyes stay as the identity photo shows them, including a cover.";
}

function sanitizeIdentityText(model: JsonRecord, sitting: PoseScrub): JsonRecord {
  const output: JsonRecord = {};
  for (const [key, value] of Object.entries(model)) {
    const preserveFacialEyewear = key === "face" || key === "faceRealism";
    output[key] = typeof value === "string"
      ? withoutCopiedPoseInIdentity(withoutInventedCatchlights(value), sitting, preserveFacialEyewear)
      : value;
  }
  return output;
}

// Locked art direction is serialized in full. A cached showcase plan can still
// name a walking stride or a sparkler inside body, hand, expression, or prop
// fields. Backdrop strings stay untouched: "walk" inside a room description
// is the set, not a pose.
function sanitizeCreativeDirection(
  value: JsonRecord,
  pose: { id: string; poseNumber: number },
  sitting: PoseScrub,
  croppedAboveAnkles = false,
): JsonRecord {
  const planted = sitting === "reference" ? REFERENCE_STANCE : plantedPoseReplacement(pose, sitting, croppedAboveAnkles);
  const distinctionFallback = croppedAboveAnkles ? PLANTED_DISTINCTION_CROPPED : PLANTED_DISTINCTION;
  const visibilityFallback = croppedAboveAnkles ? PLANTED_VISIBILITY_CROPPED : PLANTED_VISIBILITY;
  const cleanIfCropped = (text: string, fallback: string) =>
    croppedAboveAnkles ? (stripGroundedFeetForCroppedFrame(text) || fallback) : text;
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((entry) => visit(entry));
    if (!input || typeof input !== "object") return input;
    const output: JsonRecord = {};
    for (const [key, entry] of Object.entries(input as JsonRecord)) {
      const normalized = creativeDirectionKey(key);
      if (typeof entry === "string") {
        if (CREATIVE_BODY_KEYS.has(normalized)) {
          output[key] = cleanIfCropped(catalogPoseText(entry, planted, sitting), planted);
          continue;
        }
        if (CREATIVE_HAND_KEYS.has(normalized)) {
          output[key] = catalogPoseText(entry, RELAXED_HANDS, sitting);
          continue;
        }
        if (normalized === "expression") {
          output[key] = catalogPoseText(entry, CALM_EXPRESSION, sitting);
          continue;
        }
        if (CREATIVE_DISTINCTION_KEYS.has(normalized)) {
          output[key] = cleanIfCropped(catalogPoseText(entry, distinctionFallback, sitting), distinctionFallback);
          continue;
        }
        if (CREATIVE_HELD_KEYS.has(normalized)) {
          output[key] = HELD_OBJECT_PATTERN.test(entry) ? SET_PROPS_ONLY : entry;
          continue;
        }
        if (normalized === "suggestedaccessories" || normalized === "suggested_accessories") {
          output[key] = withoutHeldObjectClauses(entry);
          continue;
        }
        if (CREATIVE_CAMERA_KEYS.has(normalized)) {
          output[key] = withoutPoseOrHeldClauses(entry, ROOM_CAMERA_ONLY, !sitting);
          continue;
        }
      }
      if (CREATIVE_VISIBILITY_KEYS.has(normalized) && Array.isArray(entry)) {
        output[key] = entry.map((item) =>
          typeof item === "string"
            ? cleanIfCropped(catalogPoseText(item, visibilityFallback, sitting), visibilityFallback)
            : visit(item)
        );
        continue;
      }
      output[key] = visit(entry);
    }
    return output;
  };
  const sanitized = visit(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized) ? sanitized as JsonRecord : {};
}

export function composeGenerationPrompt(args: {
  skuName: string; productDetails: string; pose: StudioPose & { poseNumber: number };
  session: JsonRecord; references: PromptReference[]; correction?: string; learnings?: string; fashionKnowledge?: string;
  generationMemory?: string; bottomWearMode?: unknown; aspectRatio?: string; useStyleReferenceAsModelIdentity?: boolean;
}) {
  const product = objectValue(args.session.productIdentity);
  const creative = objectValue(args.session.creativeDirection);
  const model = objectValue(args.session.modelIdentity);
  // Null for sessions analysed before v10. They keep the old accessory line
  // instead of being handed generated defaults dressed up as stylist decisions.
  const styling = args.session.stylingPlan ? normalizeStylingPlan(args.session.stylingPlan) : null;
  const evidence = Array.isArray(product?.garmentEvidence) ? product.garmentEvidence as JsonRecord[] : [];
  const storedRules = Array.isArray(args.session.consistencyRules) ? args.session.consistencyRules : CONSISTENCY_RULES;
  const rules = boundedStrings(storedRules.map((rule) => withoutInventedCatchlights(String(rule ?? ""))), 16, 420);
  const isTrueBack = args.pose.id === "back";
  const { bottomWear, hasBottomReference, farshi: farshiGeneration } = generationBottomWear(args);
  const productForPrompt = farshiGeneration && typeof product.bottomWearDetails === "string"
    ? {
      ...product,
      bottomWearDetails: withoutFarshiStructureContradictions(
        product.bottomWearDetails.replace(/\bnot\s+(?:flared\s+)?(?:farshi|farsi|fasi)(?:\s*\/\s*(?:farshi|farsi|fasi))?(?:\s+(?:pajama|pants|salwar))?\b/gi, ""),
      ),
    }
    : product;
  // Existing sessions can bypass normalizeAnalysis, so reapply rear-evidence
  // validation immediately before prompt construction as a final safety gate.
  const promptEvidence = (isTrueBack ? rearEvidenceOnly(evidence, bottomWear.includesBottomWear) : evidence)
    .filter((entry) => !isNonProductEvidenceRole(objectValue(entry).sourceRole ?? objectValue(entry).source_role));
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
  const poseFamily = detectGarmentPoseFamily({
    productIdentity: product,
    category: String(product.category || args.session.category || ""),
    productDetails: String(args.productDetails || ""),
    skuName: String(args.skuName || ""),
  });
  const isShowcase = args.pose.id === "showcase";
  const isPose4 = args.pose.id === "creative" || args.pose.poseNumber === 4;
  // Adoption is read only from the stored session plan, never from pose fields
  // the client sends back. Null for every legacy session and frames 1, 2, 3, 5.
  const posePlanning = storedPosePlanning(args.session);
  const adoptedSlots = promptReferenceSlots(args.session, farshiGeneration);
  const referenceSlot = args.pose.id === "creative" || args.pose.id === "showcase" ? adoptedSlots[args.pose.id] : null;
  const isSittingDemanded = isSeatedEditorialPoseDemanded({
    pose: args.pose,
    productDetails: String(args.productDetails || ""),
    creative,
    stylingNotes: styling?.stylingNotes,
  }) || referenceSlot?.posture === "seated";
  // Farshi keeps the planted, feet-close rewrites in a reference frame: a spread opens the joined hem.
  const poseScrub: PoseScrub = referenceSlot && !farshiGeneration ? "reference" : isSittingDemanded;
  const resolvedAspectRatio = resolveAspectRatioLabel(args.aspectRatio);
  const resolvedOrientation = resolveAspectRatioOrientation(resolvedAspectRatio);
  const orientationDescriptor = resolvedOrientation === "portrait" ? "vertical portrait" : resolvedOrientation;
  const aspectSafePose = sanitizePoseDirectionForAspectRatio(args.pose, resolvedAspectRatio) as StudioPose & { poseNumber: number };
  const isPose4CroppedAboveAnkles = isPose4 && !isSittingDemanded && isAboveAnkleCropFraming(aspectSafePose);
  const directedCreative = sanitizeCreativeDirection(creative, args.pose, poseScrub, isPose4CroppedAboveAnkles);
  // Exact garmentFamily drives the saree truth blocks; the pose taxonomy is
  // broader, and a shoot either taxonomy calls a saree has no bottom wear.
  const isSareeShoot = isSaree || isSareePoseFamily(poseFamily);
  const productCoreJson = compactJson(
    isTrueBack
      ? rearOnlyProductCore(productForPrompt, bottomWear.includesBottomWear)
      : productCore(productForPrompt, bottomWear.includesBottomWear),
    { maxString: 360, maxItems: 16, maxKeys: 32 },
  );
  const modelJson = compactJson(sanitizeIdentityText(model, poseScrub), { maxString: 500, maxItems: 16, maxKeys: 32 });
  const showcaseIntent = effectiveShowcaseIntent({ creative: directedCreative, family: poseFamily, includesBottomWear: bottomWear.includesBottomWear });
  const showcaseShot = effectiveShowcaseShot(directedCreative, { includesBottomWear: bottomWear.includesBottomWear });
  const creativeForPrompt: JsonRecord = { ...directedCreative, showcaseIntent };
  // A legacy snake_case alias must not survive beside the corrected camelCase
  // value and reintroduce the raw complete-set direction in the serialized JSON.
  delete creativeForPrompt.showcase_intent;
  // Existing sessions can bypass normalizeAnalysis. Never serialize a plan that
  // this shoot rejected (for example bottom-led direction in a top-only shoot).
  if (!showcaseShot) {
    delete creativeForPrompt.showcasePlan;
    delete creativeForPrompt.showcase_plan;
  }
  const creativeJson = compactJson(creativeForPrompt, { maxString: 500, maxItems: 16, maxKeys: 32 });
  const sareeTruthJson = isSaree ? requiredJsonSection(isTrueBack ? "Direct rear saree truth" : "Canonical saree truth", sareeTruth, 10_000) : "";
  const sareeDrapePlanJson = isSaree && !isTrueBack ? requiredJsonSection("Canonical saree drape plan", sareeDrapePlan, 4_000) : "";
  const patternGeometryJson = compactJson(patternGeometryOf(product), { maxString: 500, maxItems: 16, maxKeys: 24 });
  const embroideryGeometryJson = compactJson(embroideryGeometryOf(product), { maxString: 500, maxItems: 16, maxKeys: 24 });
  // The back frame keeps one rear product image, plus the model face, the
  // style-reference backdrop, and the Pose 1 continuity anchor. Front product
  // photos stay out so their construction cannot leak onto the rear.
  const promptReferences = isTrueBack
    ? args.references.filter((ref) =>
        isDirectBackProductRole(ref.role) ||
        ref.role === "bottom" ||
        ref.role === "model_identity" ||
        ref.role === "style_reference" ||
        ref.role === "approved_pose"
      )
    : args.references;
  if (isTrueBack && !promptReferences.some((ref) => isDirectBackProductRole(ref.role))) {
    throw new Error("The true back pose requires the current uploaded back product reference. Reanalyse or replace the back image before generation.");
  }
  const hasApprovedAnchor = promptReferences.some((reference) => reference.role === "approved_pose");
  const hasModelReference = promptReferences.some((reference) => reference.role === "model_identity");
  const hasStyleReference = promptReferences.some((reference) => reference.role === "style_reference");
  const useStyleModelIdentity = !hasModelReference && hasStyleReference && Boolean(args.useStyleReferenceAsModelIdentity);
  const referencePoseNumbers = [adoptedSlots.creative ? 4 : 0, adoptedSlots.showcase ? 6 : 0].filter(Boolean);
  const manifest = promptReferences.map((reference, index) => `IMAGE ${index + 1}: ${roleLabel(reference.role, { useStyleAsModelFace: useStyleModelIdentity, hasModelReference, hasApprovedAnchor, referencePoseNumbers })}`).join("\n");
  const requestedProps = requestedHandheldProps(`${args.skuName ?? ""} ${args.productDetails ?? ""}`);
  const identityImageNumber = promptReferences.findIndex((reference) => reference.role === (hasModelReference ? "model_identity" : "style_reference")) + 1;
  const identityLine = (hasModelReference || useStyleModelIdentity) && identityImageNumber > 0
    ? identityCheckLine(identityImageNumber, hasModelReference ? "MODEL FACE REFERENCE" : "the photo uploaded as both MODEL FACE REFERENCE and STYLE REFERENCE", isTrueBack)
    : "";
  const bottomRefIndex = promptReferences.findIndex((ref) => ref.role === "bottom");
  const bottomImageTag = bottomRefIndex >= 0 ? `IMAGE ${bottomRefIndex + 1}` : null;
  const isCloseup = args.pose.id === "closeup";
  const highlightedDetails = boundedStrings(
    (Array.isArray(args.pose.highlightedDetails) ? args.pose.highlightedDetails : [])
      .map((item) => poseListItem(item, poseScrub))
      .filter(Boolean),
    12,
    260,
  ).join(", ");
  const closeupMode = isCloseup ? resolveCloseupMode({ pose: args.pose, creative: directedCreative }) : "face_and_detail";
  const closeupHeroDetail = boundedText(directedCreative.closeupHeroDetail || directedCreative.closeup_hero_detail || highlightedDetails, 260);
  // Pose 5's own recorded subject, without the current pose's highlights as a
  // fallback: on pose 6 that fallback is this frame's details, which would make
  // every showcase look like a collision with the close-up.
  const recordedCloseupHeroDetail = boundedText(directedCreative.closeupHeroDetail ?? directedCreative.closeup_hero_detail, 260);
  // The analysis chooses this frame's subject per SKU. The fixed intents remain
  // only for a cached analysis made before showcasePlan existed. Resolved by the
  // shared helper so the pose brief, this rule, the shoot memory and the feedback
  // row all describe the same frame.
  const sceneLock = sceneLockBlock({ creativeDirection: directedCreative, poseNumber: args.pose.poseNumber, hasApprovedAnchor, hasStyleReference });
  const isMacroShowcase = isShowcase && showcaseShot?.shotType === "macro_detail";
  const faceRequired = !isTrueBack && !(isCloseup && closeupMode === CLOSEUP_PRODUCT_DETAIL) && !isMacroShowcase;
  const faceQualityInstruction = faceRequired
    ? "The face must read as a real photographed person: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry, eyes kept as the identity photo shows them, including a cover that hides them, and naturally aligned teeth (not uniformly perfect, no extra or missing teeth). Never render a plastic, waxy, over-smoothed, mirror-symmetric, or otherwise synthetic \"AI face\". Never distort, warp, blur, or misalign eyes, eyebrows, nose, lips, ears, or teeth."
    : isTrueBack
      ? `The model is photographed from behind. Keep hair color/style, skin tone, ear jewelry, and body proportions strictly consistent with the identity anchor. If the model glances back over her shoulder showing her profile or any part of her face, that face MUST match ${hasModelReference ? "the MODEL FACE REFERENCE" : useStyleModelIdentity ? "the STYLE REFERENCE face identity (duplicated upload)" : "APPROVED POSE 1 (never copy the STYLE REFERENCE person's face)"}. APPROVED POSE 1 is the room and the identity anchor: do not copy its pose or objects in the hands. Never substitute a different person or face.`
      : "This frame is a PRODUCT-DETAIL close-up. Do not force a full beauty-face crop. If any portion of the face appears it MUST match the identity lock - same jawline, eyes, skin texture with visible pores, and makeup. Prefer filling the frame with the named product selling detail; omit or crop the face when a full face would make that detail too small to read.";
  const plantedStance = poseScrub === "reference"
    ? REFERENCE_STANCE
    : plantedPoseReplacement(args.pose, isSittingDemanded, isPose4CroppedAboveAnkles);
  const cleanPoseText = (rawValue: unknown) => {
    const base = catalogPoseText(rawValue, plantedStance, poseScrub);
    return isPose4CroppedAboveAnkles ? (stripGroundedFeetForCroppedFrame(base) || plantedStance) : base;
  };
  const poseTitle = boundedText(poseTitleText(args.pose.title, poseScrub), 160);
  const poseDescription = boundedText(cleanPoseText(aspectSafePose.description), 600);
  const posePrompt = boundedText(cleanPoseText(aspectSafePose.prompt), 1_200);
  const poseCamera = boundedText(poseInstructionText(aspectSafePose.cameraAngle, poseScrub, "Eye-level catalog angle."), 360);
  const poseFraming = boundedText(poseInstructionText(aspectSafePose.framing, poseScrub, "Catalog framing."), 360);
  const posePurpose = boundedText(poseInstructionText(aspectSafePose.purpose, poseScrub, "Show the garment clearly."), 420);
  const poseConsistency = boundedText(poseInstructionText(aspectSafePose.consistencyNotes, poseScrub, "Same model, product, and backdrop as the other frames."), 600);
  const stylingNotes = styling
    ? poseInstructionText(styling.stylingNotes, poseScrub, "")
    : "";
  const themeInterpretation = styling
    ? poseInstructionText(styling.themeInterpretation, poseScrub, "")
    : "";
  // A frame that does not copy the reference posture drops planner sentences naming one
  // ("leaning languor", "kneeling grace"); the shared scrub only covers sit, stride and props.
  const withoutReferencePosture = (text: string) => referenceSlot
    ? text
    : text.split(/(?<=[.!;])\s+/).filter((part) => !REFERENCE_POSTURE_WORD_PATTERN.test(part)).join(" ").replace(/;\s*$/, ".");
  // Planner-owned expression for this frame; "" keeps every legacy expression line.
  const rawPlannedExpression = plannedPoseExpression(args.session, args.pose.id);
  const plannedExpressionText = rawPlannedExpression
    ? withoutReferencePosture(catalogPoseText(rawPlannedExpression, CALM_EXPRESSION, poseScrub)) || CALM_EXPRESSION
    : "";
  const plannedExpression = plannedExpressionText ? boundedText(plannedExpressionText, 300).replace(/[.!\s]+$/, "") : "";
  // Shoot-wide, but scrubbed with this frame's pose rules: a reference attitude
  // such as "seated ease" or "leaning languor" never reaches a frame that does not copy that posture.
  const expressionAttitude = posePlanning
    ? withoutReferencePosture(poseInstructionText(expressionAttitudeLine(posePlanning.expressionPlan), poseScrub, CALM_EXPRESSION)) ||
      CALM_EXPRESSION
    : "";

  const allowedDelta = [
    `pose/body position: ${referenceSlot ? `the STYLE REFERENCE ${referenceSlot.posture} posture, exactly as the REFERENCE POSE MATCH block states` : isPose4 && isSittingDemanded ? "Elegant seated editorial pose on a minimal studio bench, architectural plinth/cube, or clean studio step that already belongs to the established set (no new furniture); complete garment, bottom-wear volume, and footwear clearly visible and styled" : boundedText(cleanPoseText(aspectSafePose.bodyPosition), 360)}`,
    `camera angle: ${poseCamera}`,
    `framing: ${poseFraming}`,
    `output aspect ratio: ${resolvedAspectRatio} ${orientationDescriptor} framing`,
    `expression: ${boundedText(plannedExpressionText || catalogPoseText(aspectSafePose.expression, CALM_EXPRESSION, poseScrub), 360)}`,
  ];
  const correction = boundedText(args.correction, 1_200);
  const learnings = boundedText(args.learnings, 900);
  const fashionKnowledge = boundedText(args.fashionKnowledge, 700);
  // The shoot memory is built from the stored plan. When this prompt honours none
  // of its adoptions (a stale low posture on a Farshi shoot), it must not name a
  // posture frame either (generationMemory.ts style-reference lines).
  const memoryDropsPosture = !referencePoseNumbers.length &&
    (posePlanning?.slots.creative.source === "reference" || posePlanning?.slots.showcase.source === "reference");
  const generationMemory = boundedText(
    memoryDropsPosture
      ? String(args.generationMemory ?? "").replace(/, (?:and|plus its) posture in Pose [46](?: and Pose 6)? only(?:; never its outfit or handheld objects)?/g, " only")
      : args.generationMemory,
    900,
  );
  const recordedVisibility = boundedStrings(
    (Array.isArray(args.pose.productVisibilityRules) ? args.pose.productVisibilityRules : [])
      .map((item) => {
        const cleaned = poseListItem(item, poseScrub);
        return isPose4CroppedAboveAnkles ? stripGroundedFeetForCroppedFrame(cleaned) : cleaned;
      })
      .filter(Boolean),
    12,
    260,
  ).join("; ");
  const visibilityRules = (
    bottomWear.includesBottomWear &&
    effectiveBottomCutClass(bottomWear.cutClass, hasBottomReference, {
      skuName: String(args.skuName || ""),
      productDetails: String(args.productDetails || ""),
      details: bottomWear.details,
    }) === "farshi"
  )
    ? reconcileFarshiVisibilityRules(recordedVisibility)
    : recordedVisibility;
  const poseCategory = (isTrueBack || args.pose.id === "back")
    ? "back"
    // The sixth frame carries its own intent-specific hard rule below, so the
    // generic keyword categories must not claim it ("showcase" reads as the
    // playful/detail category and would fight a full-length set frame).
    : args.pose.id === "showcase"
      ? "showcase"
      : (isPose4 && isSittingDemanded)
        ? "sitting"
        // A plan-adopted non-seated reference posture (leaning, kneeling, signature...).
        : (isPose4 && referenceSlot)
        ? "reference"
        // Pose 4 is a planted editorial stance. Planner wording such as
        // "three-quarter" must not select the 90-degree profile.
        : isPose4
          ? "dynamic"
          // Pose 2 is a planted 35-to-45 turn. "side" and "three-quarter" in the
          // planner text must not select the 90-degree profile with a staggered stance.
          : (args.pose.poseNumber === 2 || args.pose.id === "angled")
            ? "angled"
            // Pose 1 is the listing hero. A copied sit or the word "side" must not turn it into a seated frame or a 90-degree profile.
            : (args.pose.poseNumber === 1 || args.pose.id === "full_front")
              ? "front"
              // Pose 5 is a craft crop. Sitting or walking words in the plan must not replace that crop with a seated or striding category.
              : (args.pose.poseNumber === 5 || args.pose.id === "closeup")
                ? "playful"
                : detectPoseCategory([
                    args.pose.id,
                    poseDescription,
                    posePrompt,
                    catalogPoseText(args.pose.bodyPosition, plantedStance, poseScrub),
                  ].join(" "));
  const categoryRules = poseCategoryRules(poseCategory, { croppedAboveAnkles: isPose4CroppedAboveAnkles, expression: plannedExpression });
  // Compaction keeps the first 1,400 characters of this block. The current
  // frame and the seated rules have to lead, or a long six-pose summary
  // deletes them and leaves only the raw pose prompt. A reference-matched
  // frame leads with its REFERENCE POSE MATCH block instead of the frame line.
  const poseRequirementLead = [
    referenceSlot
      ? referencePoseMatchBlock(args.pose.poseNumber, referenceSlot, farshiGeneration, useStyleModelIdentity)
      : currentFrameLine(args.pose, isSittingDemanded, isPose4CroppedAboveAnkles, plannedExpression),
    isPose4 && isSittingDemanded && !referenceSlot ? SEATED_EDITORIAL_REQUIREMENT : "",
    categoryRules ? `POSE CATEGORY RULES (${poseCategory.toUpperCase()}):\n${categoryRules}` : "",
    poseVariationDirective(isPose4CroppedAboveAnkles, adoptedSlots, useStyleModelIdentity),
  ].filter(Boolean).join("\n");
  const evidenceLines = promptEvidence.slice(0, 16).map((entry) => {
    const row = objectValue(entry);
    const lines = [
      `- Region ${boundedText(row.region, 120).toUpperCase() || "UNKNOWN"}: [State: ${boundedText(row.state, 80)}]`,
      `  Source: ${boundedText(row.sourceRole ?? row.source_role, 80) || "UNRECORDED"}`,
      `  Construction: ${boundedText(row.visibleConstruction, 360) || "None explicitly proven"}`,
      `  Decoration/Trim: ${boundedText(row.visibleDecoration, 360) || "None explicitly proven"}`,
    ];
    const closures = String(row.closures || "").trim();
    if (closures && closures.toLowerCase() !== "none") {
      lines.push(`  Closures: ${boundedText(closures, 240)}`);
    }
    const absentItems = boundedStrings(row.explicitlyAbsent, 12, 180).filter((s) => s && s.toLowerCase() !== "none");
    if (absentItems.length > 0) {
      lines.push(`  Absent: ${absentItems.join(", ")}`);
    }
    const uncertainty = String(row.uncertainty || "").trim();
    if (uncertainty && uncertainty.toLowerCase() !== "none") {
      lines.push(`  Uncertainty: ${boundedText(uncertainty, 260)}`);
    }
    return lines.join("\n");
  }).join("\n");

  const positiveDupattaClauses = [
    String(product.accessoriesIncluded || ""),
    String(styling?.ornaments || ""),
    String(args.productDetails || ""),
  ]
    .flatMap((text) => text.split(/[,;\n.!?]+/))
    .map((clause) => clause.trim())
    .filter((clause) => (
      clause.length > 0 &&
      /\b(?:dupatta|stole|chunni|odhani)\b/i.test(clause) &&
      !/\b(?:no|not|without|never(?:\s+add)?|absent|missing|excluded|excludes|optional|Optional)\b/i.test(clause) &&
      !/\b(?:dupatta|stole|chunni|odhani|scarf|shawl)\s*:\s*none\b/i.test(clause)
    ));
  const hasDupatta = !isSareeShoot && positiveDupattaClauses.length > 0;
  const dupattaLock = hasDupatta
    ? isTrueBack || args.pose.id === "back"
      ? `\nDUPATTA DRAPE & FIDELITY LOCK (REAR VIEW):\n- Include the uploaded dupatta/stole from the product references (exact fabric weight, colour/ombré gradient, motif scale, and border/gota lace trim), draped cleanly forward over both forearms/elbows or held lightly in front so 100% of the rear garment neckline, closures, and back panel stay completely unobstructed.\n`
      : `\nDUPATTA DRAPE & FIDELITY LOCK:\n- Render the uploaded dupatta/stole faithfully (exact sheer/opaque fabric, colour/ombré gradient, motif placement, and border/gota lace trim from the MANNEQUIN / ADDITIONAL / FRONT product references), draped naturally over one shoulder/forearm so the primary garment neckline, butti craft, and bottom-wear cut stay clearly visible.\n`
    : "";

  const prompt = `Create ONE real-camera fashion e-commerce photograph for ${boundedText(args.skuName, 160) || "this product"} that is indistinguishable from an unretouched frame of a professional catalog shoot.

SHOOT AUTHORITY - APPLY BEFORE ANYTHING ELSE:
- Model face and body: ${hasModelReference ? `IMAGE labeled MODEL FACE REFERENCE only. ${referenceSlot ? "Ignore the style-reference person's face and body proportions, and every face in the product photos." : "Ignore the style-reference person and every face in the product photos."}${hasApprovedAnchor ? " Also match the realized face, hair, and skin in APPROVED POSE 1. Do not copy that frame's pose, garment, or objects in the hands." : ""}` : useStyleModelIdentity ? "the STYLE REFERENCE face, hair, and body proportions, because the user attached the same photo as both MODEL FACE REFERENCE and STYLE REFERENCE." : hasApprovedAnchor ? (referenceSlot ? `the APPROVED POSE 1 model face, hair, and body proportions. Ignore the person's face and body proportions in the STYLE REFERENCE; ${REFERENCE_POSTURE_ONLY}.` : "the APPROVED POSE 1 model face, hair, and body proportions. Ignore the person's face, pose, and body in the STYLE REFERENCE.") : referenceSlot ? `an original photorealistic adult fashion model matching the locked model identity below (never copy the STYLE REFERENCE person's face or props; ${REFERENCE_POSTURE_ONLY}), held identical across all six frames.` : "an original photorealistic adult fashion model matching the locked model identity below (never copy the STYLE REFERENCE person's face, body stance, or props), held identical across all six frames."}
- Backdrop and background: ${hasStyleReference ? `the STYLE REFERENCE room/environment ONLY (wall, pillars, arches, floor, light) on all six poses, including this one. ${referenceSlot ? "Do NOT wedge/pin the model behind a foreground pillar or copy handheld coffee cups/totes/bags; the style-reference posture is used only as the REFERENCE POSE MATCH block directs." : "Do NOT wedge/pin the model behind a foreground pillar or copy the style-reference person's lean/sitting posture or handheld coffee cups/totes/bags."} Never a product-photo background and never a generic white sweep.` : "the locked creative direction, identical in all six poses."}
- Product DNA: uploaded product photos only. Copy garment design, print, colour, embroidery, and construction exactly. A detail crop may omit the face, but any visible face is still this same person and any visible set is still this same backdrop.
${bottomWear.includesBottomWear && bottomImageTag ? `- Bottom wear truth: The trousers/bottom wear MUST be derived EXCLUSIVELY from ${bottomImageTag} (BOTTOM WEAR / FARSHI). Never copy upper-garment fabric/embroidery or style-reference clothing onto the bottom wear.` : ""}

REFERENCE MANIFEST IN UPLOAD ORDER:
${manifest}
${generationMemory ? `
GENERATION MEMORY (DO NOT FORGET):
${generationMemory}
- Product images remain garment/SKU truth. Style reference remains set/backdrop authority. Approved Pose 1 keeps the same face, hair, skin, and set. Do not copy its pose, garment, or objects in the hands.
` : ""}

EDIT GOAL:
Place the exact uploaded product on one consistent professional adult fashion model and create Pose ${args.pose.poseNumber}: ${poseTitle}. The finished image must look like the same real professional photoshoot as every other frame in this set.
CRITICAL PRODUCT INTEGRITY RULE: The product clothing (garment, fabric, colors, prints, embroidery, neckline, sleeves, and bottom wear) must be taken EXCLUSIVELY and EXACTLY from the UPLOADED PRODUCT reference images. The clothing/outfit worn by the person in the STYLE REFERENCE image is strictly ignored and 100% DISCARDED. Absolutely DO NOT copy, transfer, or blend the style reference image's garment onto the model. Dress the model ONLY in the uploaded product.${bottomWear.includesBottomWear && bottomImageTag ? ` The bottom wear must strictly replicate the fabric, print, cut, and silhouette of ${bottomImageTag} (BOTTOM WEAR / FARSHI) and must NOT match the kurta fabric or borrow from the style reference.` : ""}
Photoshoot environment authority: The physical studio set, backdrop wall, architectural features, flooring, and lighting MUST be derived solely from the STYLE REFERENCE${hasApprovedAnchor ? " as already photographed in APPROVED POSE 1 - rebuild exactly the set Pose 1 shows, including in a back view" : " (if supplied)"} and the SCENE LOCK below - never a different or generic set. Copy the room and lighting depth only: position the model cleanly in open unobstructed floor space in front of the architectural backdrop (NEVER pinned behind a foreground column/pillar, ${referenceSlot ? "NEVER copying a coffee cup, tote bag, or sunglass case from the style photo; the posture follows only the REFERENCE POSE MATCH block" : "NEVER copying a coffee cup, tote bag, sunglass case, or leaning stance from the style photo"}). STRICTLY PROHIBITED: Do NOT copy, borrow, or reproduce any background walls, arches, urns, terracotta pots, plants, furniture, or outdoor locations visible behind the garment in the FRONT, BACK, BOTTOM, or other product reference photos. Those product backgrounds are pre-shoot noise and must be 100% discarded.

${sceneLock}

PHOTOGRAPHIC REALISM - MUST READ AS CAPTURED BY A REAL CAMERA, NEVER AS AI-GENERATED:
${anatomicalIntegrityDirective()}
- Camera and optics: full-frame camera with a lens suited to this framing (about 85mm for full-length and three-quarter frames, macro-style close focus for detail crops), low ISO, real optical depth of field with gradual focus falloff. No fake bokeh, cut-out or halo edges, or pasted-on subject.
- Colour and tone: true-to-life colours and exposure from a restrained professional RAW edit. Accurate, varied skin tones with natural redness and undertones; very fine sensor grain; soft highlight roll-off and detail in the shadows. No HDR, bloom, glow, haze, oversaturation, teal-orange grade, glossy beauty retouch, painterly, illustrated, 3D or CGI look.
- Real person: an individual, believable face with natural character, not an idealized stock face; relaxed, weight-bearing posture with slight natural asymmetry; correct hands with five fingers, knuckles and nails; natural neck, shoulder and limb proportions. Hair shows individual strands and a few flyaways, never a solid helmet-like mass.
- Natural, realistic expressions and smiles: model expressions and smiles must look effortless, relaxed, and natural. Soft, genuine smiles with relaxed cheek muscles and gentle eye warmth, or calm editorial poise — strictly avoid forced, wide, exaggerated, frozen, or artificial 'stock-photo' smiles. Teeth, if visible, must look natural, relaxed, and anatomically accurate.
- Real textile: visible weave or knit, natural creases at elbows, waist and knees, gravity-driven folds, real thickness at hems and seams. No vinyl or plastic sheen unless the fabric is genuinely satin or silk.
- Grounded in the set: one coherent light source direction across face, garment and background; soft contact shadows under the feet; the model physically occupies the room.

LOCKED SUBJECT - MUST NOT CHANGE:
${modelJson}
- Same recognizable face, skin tone, body proportions, hairstyle, hair length/color, makeup, accessories and footwear across the complete set.
${plannedExpression ? `- Model expression in this frame: ${plannedExpression}; never a stiff, forced, or frozen smile.` : "- Model expressions: authentic, relaxed warmth and natural composure; never a stiff, forced, or frozen smile."}
- Pose 1 anchors the set for later poses. It never overrides the reference face or the product photos.

FACE & IDENTITY LOCK - HIGHEST PRIORITY:
${hasModelReference
    ? `The image labeled MODEL FACE REFERENCE in the reference manifest above is the exact, non-negotiable face and identity for this model in EVERY pose, including this one. Reproduce it as close to pixel-identical as photographically possible: identical facial bone structure, eyes (shape, color, spacing), eyebrows, nose, lips, jawline, skin tone and texture, and hairstyle. Do not idealize, beautify, average, restyle, or blend it with any other face - this must read as the same real person from that reference photo, not merely a similar-looking model. If the eyes are hidden, keep that cover and the visible face. Do not invent a different person.${hasApprovedAnchor ? " APPROVED POSE 1 is that same person already photographed in this shoot. Match its realized face, hair, and skin as well as the MODEL FACE REFERENCE. Do not copy Pose 1's pose, garment, or objects in the hands, and do not invent a third face." : ""}`
    : useStyleModelIdentity
      ? `The STYLE REFERENCE image${identityImageNumber > 0 ? ` (IMAGE ${identityImageNumber})` : ""} is the face for every pose, because the user attached the same photo in both Model Face and Style Ref. Match its face, skin tone and hair exactly: the same jaw, nose, eyes, brows and lips, the same skin tone, and the same hair colour, length, texture and parting. If the eyes are hidden, keep that cover and the visible face. Do not invent a different person. ${referenceSlot ? `Discard that image's clothing and handheld objects; ${REFERENCE_POSTURE_ONLY}.` : "Discard that image's clothing, pose, pillar-leaning stance, and handheld objects."}${hasApprovedAnchor ? " APPROVED POSE 1 must show that same face, hair, and skin. Use it for the realized identity and the room. Do not copy its pose or objects in the hands." : ""}`
      : hasApprovedAnchor
        ? "The image labeled APPROVED POSE 1 in the reference manifest above is the exact, non-negotiable ground truth for this model's identity. Reproduce the identical facial bone structure, eye shape and color, eyebrow shape, nose, lips, jawline, skin tone and texture, and hairstyle seen in that image - do not idealize, beautify, average, or drift toward a different face. Ignore any person visible in the STYLE REFERENCE."
        : `This is the hero pose and establishes the model identity anchor for the whole shoot. Commit to one specific, photorealistic, naturally attractive adult face with real individual character (not an idealized, airbrushed, symmetric stock face) exactly as described in modelIdentity above — ${referenceSlot ? `completely discarding the person's face and props in the STYLE REFERENCE (${REFERENCE_POSTURE_ONLY})` : "completely discarding the person's face, pose, and props in the STYLE REFERENCE"} — every later pose in this set must reproduce this same Pose 1 face.`}
${faceQualityInstruction}

LOCKED PRODUCT - MUST NOT CHANGE:
${referenceImageScopeDirective(hasModelReference, useStyleModelIdentity, Boolean(referenceSlot))}
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
    ? `The one direct uploaded BACK / SAREE REAR-BACK DRAPE image in the manifest is the sole visual product authority for the upper garment back.${bottomWear.includesBottomWear ? " Bottom wear preserves its authentic cut, volume, pleats, hem, and print DNA from the bottom wear references and recorded bottom-wear specifications." : ""} Do not derive upper-garment rear construction from a front, pallu, body detail, border, blouse, mannequin, model, style, or generated image.`
    : `original product images always outrank generated anchors and style references. FRONT controls front construction and, when bottoms are visible, bottom-wear cut and print; BACK solely controls rear construction including rear bottom-wear; FABRIC/PATTERN resolves UPPER-garment material, embroidery and small construction only unless that image itself shows the trousers/skirt; BOTTOM WEAR / FARSHI (if supplied) is the pixel-level authority for bottom-wear cut, volume, hem, color and print; a MANNEQUIN/DRESS-FORM shot resolves worn shape, fit, proportion, drape and bottom volume, while a FLAT-LAY resolves outline, construction, panel layout and length only, since flat cloth shows no worn drape. ADDITIONAL supports product truth including bottoms; STYLE controls art direction, photoshoot backdrop, room architecture, flooring, and lighting only - STYLE REFERENCE is the SOLE AUTHORITY for the photoshoot environment, never product identity. Product reference backgrounds must be 100% discarded.${isSaree ? " For sarees, FULL SAREE FRONT and REAR/BACK DRAPE control their complete worn regions; SAREE BODY/WEAVE controls body colour, weave and motif geometry; FULLY SPREAD PALLU alone controls the pallu boundary and artwork; BORDER/TASSELS controls edge geometry and tassel construction; BLOUSE FRONT/BACK controls only the matching blouse region. Never classify or treat the pallu spread as generic body fabric." : ""}`}
- Product references may be flat-lay, folded, pinned or shot on a mannequin or dress form. Rebuild the garment as it falls on a live human body, and never render a mannequin, dress form, hanger, clip, pin, prop stand, or the flat background surface in the output.
${isSaree ? (isTrueBack
    ? "- SAREE REAR RULE: read the visible pallu fall, border, tassels, weave and blouse-back only from the direct rear image. When the direct rear reference is an unadorned mannequin wrap showing no ornate blouse back, render a clean, modest, undecorated plain solid tonal blouse back matching Pose 1 (no bare strapless chest/back, no invented dori/keyhole/cutout/embroidery). Never mirror or extend a front-only design into the back."
    : "- SAREE SPECIFIC RULES: Pallu artwork stays on the pallu, never bleed the border into the main body, do not duplicate the pallu into multiple loose cloth panels, border width stays identical, follow the drape plan explicitly. NEVER render a bare/strapless mannequin upper-torso look: if product photos show the saree draped on a blouseless mannequin with no separate stitched blouse photo, dress the model in a clean, modest, plain undecorated tailored solid short/elbow-sleeve blouse in a cohesive matching/complementary tone with zero invented embroidery or embellishments.") : ""}

GARMENT TRUTH CONTRACT (EVIDENCE BY REGION):
${evidenceLines}
${placement.length ? `Detail placement hard locks:\n${placement.map((rule) => `- ${rule}`).join("\n")}` : "- Preserve every visible detail only in the exact region shown by the authoritative image."}
${absent.length ? `Negative-evidence hard locks:\n${absent.map((rule) => `- ${rule}`).join("\n")}` : "- Add no button, closure, tassel/latkan, trim, embroidery, pocket, logo, jewelry or hardware unless the authoritative product image proves it exists at that location."}

CRITICAL EVIDENCE RULES:
- If a region's state is "confirmed_absent", do not render the decoration, trim, closure, or specialized construction represented by that region.
- If a region's state is "unknown", it MUST be rendered in plain base fabric without any unproven decoration, trim, or specialized construction. UNKNOWN DOES NOT MEAN INFER.
- Do NOT extrapolate decoration. If trim is confirmed at the front hem but the side seam is unknown, do not extend the trim up the side.
${isTrueBack ? `- BACK-POSE EVIDENCE VETO: For the upper garment/saree rear, only a confirmed rear region whose Source is BACK PRODUCT or SAREE REAR / BACK DRAPE may place rear construction or decoration. A front-, fabric-, pallu-, border-, blouse-, mannequin-, model-, style-, generated-, or unrecorded source cannot prove a rear lace, trim, border, closure, or motif. If the direct rear evidence does not explicitly prove it, render plain base fabric in that upper-garment rear region. Bottom wear must faithfully maintain its authentic cut, print, volume, pleating, and hem from the bottom wear reference and recorded bottom-wear profile.
- BACK-POSE DUPATTA & HAIR UNOBSTRUCTED RULE: Hair must be swept forward over shoulders or styled in an updo, and dupatta/shawl must drape forward over arms so the entire rear garment construction and embroidery are 100% visible and unobstructed.` : ""}

${isTrueBack ? `REAR PRODUCT GEOMETRY LOCK:
- The direct rear product image is the only visual geometry source for the upper garment in this frame. Reproduce only the rear-facing motif shape, scale, spacing, orientation, repeat, density, weave, border, tassel, blouse-back, and embroidery actually visible there.
- Do not use a fabric close-up, front frame, pallu spread, border image, blouse piece, or generated image to complete unseen upper-garment rear geometry.
- If the rear image does not clearly resolve an upper-garment region, render it as plain base fabric with no inferred decoration, trim, closure, motif, border, tassel, or embroidery.
- Bottom wear retains its authentic print geometry, physical motif scale, color, and Farshi silhouette/hem structure across all frames.` : (isSaree ? `SAREE GEOMETRY AND PATTERN LOCK - the difference between photographing THIS saree and inventing a similar one:
- The SAREE BODY / WEAVE CLOSE-UP image is the pixel-level authority for the main body's motif shape, scale, spacing, orientation, and weave structure. Read the body geometry strictly from that image.
- The FULLY SPREAD PALLU image is the sole authority for pallu artwork, scale, orientation, repeat, density, and edge construction.
- The SAREE BORDER / TASSELS DETAIL image is the sole authority for upper/lower border widths, border motifs, and tassel construction.
- Reproduce all motifs at their stated physical scale relative to the body or pallu. Do not enlarge, simplify, stylize, redraw, or "clean up" a motif.
- Keep every accent colour inside the print and embroidery. Small secondary-colour details within a motif field are part of this product's identity, not noise to average away.
- If a region is not clearly resolved in any reference, render it plainly in the garment's base fabric, colour and texture only. Never copy a neighbouring panel's motif arrangement into it, never mirror or continue decoration across it, and never invent decoration to fill it.`     : `PRINT AND EMBROIDERY GEOMETRY LOCK - the difference between photographing THIS garment and inventing a similar one:
Pattern geometry: ${patternGeometryJson}
Embroidery geometry: ${embroideryGeometryJson}
- The FABRIC / PATTERN DETAIL image is the pixel-level authority for UPPER-garment motif shape, motif scale, spacing, orientation and embroidery construction only. Read that geometry off that image rather than reproducing a generic version of the same craft or style. It is NOT the authority for bottom-wear print unless the image itself clearly shows the trousers/skirt.
- Reproduce motifs at the stated physical scale relative to the body. Do not enlarge, simplify, stylize, redraw or "clean up" a motif, and do not reduce a dense print to fewer, larger shapes.
- Keep the print's orientation, repeat interval and density identical, including where panels differ - body, sleeves, yoke, bottom wear and dupatta each keep their own stated treatment. Never copy kurta/upper embroidery scale onto the bottoms.
- Keep every accent colour inside the print. Small secondary-colour details within a motif field are part of this product's identity, not noise to average away.
- Reproduce embroidery as the same internal geometry: same lattice or motif structure, same count and rhythm of repeated units, same borders, same coverage area, and the same relationship to the neckline, tie, drawstring and tassel.
- If a region is not clearly resolved in any reference, render it plainly in the garment's base fabric, colour and texture only. Never copy a neighbouring panel's motif arrangement into it, never mirror or continue decoration across it, and never invent decoration to fill it - unresolved means undecorated, not "probably like the panel next to it".`)}

${bottomWearSection({
  bottomWear,
  isSaree: isSareeShoot,
  hasBottomReference,
  skuName: String(args.skuName || ""),
  productDetails: String(args.productDetails || ""),
  promptReferences,
  isTrueBack,
})}

LOCKED ART DIRECTION & SET CONTINUITY - MUST NOT CHANGE BETWEEN POSES:
- ABSOLUTE PROHIBITION ON PRODUCT PRE-SHOOT BACKGROUNDS: Never reproduce the background, wall, arches, urns, pots, plants, steps, or environment visible behind the garment in the product reference photos (front, back, bottom, mannequin). The photoshoot set must come exclusively from the STYLE REFERENCE (or Pose 1 anchor / studio specification).
- BACKDROP AND SET CONTINUITY ACROSS ALL POSES: The exact same photoshoot set (wall color, wall finish, floor, and lighting) must remain identical across every pose in this set without drift or forgetting context.
${lockedDetailsDirective()}
${hasApprovedAnchor
  ? `- SET & BACKDROP HARD LOCK TO APPROVED POSE 1:
  * Rebuild the EXACT SAME physical room and backdrop set from Pose 1: identical wall color, wall plaster/paint finish, texture, architectural elements, floor surface, and carpet/rug.
  * ZERO NEW PROPS: Do NOT add urns, brass urlis, flower petals, steps, pedestals, or vases absent from that room. Objects in the hands are not the set.
  * LIGHTING & SHADOW CONTINUITY: Keep the exact same light direction, shadow density, and warm/cool color temperature established in Pose 1.
  * The camera and model remain in the exact same photoshoot location - only the pose and framing change.`
  : "- Maintain a single, consistent studio set, wall finish, flooring, and lighting setup across all poses."}
- SET ONLY: the direction below is backdrop, light, and camera. It does not set the pose, the garment, or handheld props.
${creativeJson}
- Build the set described above, and where a STYLE REFERENCE or APPROVED POSE 1 image is supplied, rebuild only the room those images show: the same wall colour and finish, floor or ground surface, furniture in the room, light direction and quality, and colour grade. Do not substitute a different backdrop.

${styling ? `APPROVED STYLING PLAN - the stylist's decisions for this shoot, identical in every frame:
- Footwear: ${boundedText(poseInstructionText(styling.footwear, poseScrub, ""), 360)}
- Jewellery: ${boundedText(poseInstructionText(styling.jewellery, poseScrub, ""), 360)}
- Ornaments and accessories: ${boundedText(poseInstructionText(styling.ornaments, poseScrub, ""), 360)}
- Makeup: ${boundedText(poseInstructionText(styling.makeup, poseScrub, ""), 360)}
- Hair: ${boundedText(poseInstructionText(styling.hair, poseScrub, ""), 360)}
${stylingNotes ? `- Stylist notes: ${boundedText(stylingNotes, 600)}` : ""}
${themeInterpretation ? `- Theme being served: ${boundedText(themeInterpretation, 600)}` : ""}
- Style the model with exactly these pieces - the same metal, the same count, the same placement in every frame. Do not add a necklace, bangle, ring, belt, bag, hair ornament or any other accessory this plan does not list, and do not drop one it does.
- JEWELLERY & ORNAMENT LOCK: Wear exactly the jewellery and ornaments in this plan. If the plan copied style-reference ornaments, keep those pieces identical. Do not invent competing necklaces, maang tikkas, extra bangles, or hair jewellery. Product-included jewellery from the product references outranks style-reference jewellery when both exist, and nothing in this plan may hide neckline or embroidery.
- This is styling only. It never becomes part of the garment, never hides or replaces a garment detail, bottom wear or footwear shown in the product references, and never contradicts the placement or absence locks above.
${directedCreative.suggestedAccessories ? `- Legacy stylist note (subordinate to the plan above): ${boundedText(withoutHeldObjectClauses(String(directedCreative.suggestedAccessories), [args.skuName, args.productDetails].filter(Boolean).join(" ")), 420)}` : ""}`
  : `STYLING ADDITION (optional, locked once chosen):
${directedCreative.suggestedAccessories ? `The stylist has proposed adding: ${boundedText(withoutHeldObjectClauses(String(directedCreative.suggestedAccessories), [args.skuName, args.productDetails].filter(Boolean).join(" ")), 420)}. Style the model with exactly this addition, identical across every pose. It is a styling choice only - it must never hide, replace, or contradict the garment, bottom wear, or footwear shown in the product references.` : "No additional styling accessory is needed for this product - use only what the product references show."}
- JEWELLERY & ORNAMENT LOCK: ${hasStyleReference
    ? "If the STYLE REFERENCE image in this manifest shows jewellery or ornaments that complement this product and the product itself does not already include competing pieces, keep those exact style-reference pieces identical across the set. Never invent a second jewellery story."
    : "No STYLE REFERENCE image is in this manifest. Use only jewellery/ornaments that ship with the product or were named in the approved styling plan. Do not invent jewellery from a missing style reference."}`}
${dupattaLock}
ALLOWED DELTA - THE ONLY THINGS THAT MAY CHANGE:
${allowedDelta.map((value) => `- ${value}`).join("\n")}
- Hand placement: ${boundedText(sanitizeHeldObjectText(catalogPoseText(args.pose.handPlacement, RELAXED_HANDS, poseScrub), RELAXED_HANDS, [args.skuName, args.productDetails].filter(Boolean).join(" ")), 360)}
- Everything not named here stays locked.

POSE REQUIREMENT:
${poseRequirementLead}
Description: ${poseDescription}
Details to highlight: ${highlightedDetails}
Visibility rules: ${visibilityRules}
Purpose: ${posePurpose}
Consistency notes: ${poseConsistency}
GARMENT POSE GRAMMAR (${garmentPoseFamilyHeading(poseFamily)}) - body language and framing only; it never changes the garment's design, print, colour, fit or construction:
${garmentPoseDirection(poseFamily, { croppedAboveAnkles: isPose4CroppedAboveAnkles })}
${isShowcase
    ? (showcaseShot
      ? showcasePlanHardRule({
        plan: showcaseShot.plan,
        shotType: showcaseShot.shotType,
        widenedFromCloseup: showcaseShot.widenedFromCloseup,
        closeupHeroDetail: recordedCloseupHeroDetail,
        referencePosture: referenceSlot?.posture,
      })
      : showcaseHardRule(showcaseIntent, poseFamily, plannedExpression, referenceSlot?.posture))
    : ""}
${isPose4 && hasStyleReference && !referenceSlot ? `
DO NOT COPY THE STYLE POSE (POSE 4):
- A person sitting in the STYLE REFERENCE does not make this frame seated. Also never copy a foreground pillar-leaning posture or handheld props from the STYLE REFERENCE.
` : ""}
${correction ? `
CORRECTION REQUIRED FROM PREVIOUS QA ATTEMPT:
${correction}
- Address this correction completely and literally. Do not change anything else that was working.` : ""}
${fashionKnowledge ? `
FASHION KNOWLEDGE (SEEDED CUT/PRINT GUIDANCE, SUBORDINATE TO PRODUCT REFERENCES):
${fashionKnowledge}
- Valid only when the current product references confirm this bottom garment. Product references ALWAYS override this guidance.
` : ""}
${learnings ? `
CONTINUOUS LEARNING ADVISORY (APPROVED, REFERENCE-SCOPED GUIDANCE):
${learnings}
- These are explicitly approved guards only. Product-scoped guidance is valid only for this exact source-reference fingerprint.
- You MUST validate these guards against the current product's GARMENT TRUTH CONTRACT. If a guard contradicts the current authoritative product references or evidence, ignore it. The current product references ALWAYS override learning guidance.
` : ""}

PROMPT:
(Pose, camera and framing only. The SCENE LOCK above decides the set.)
${posePrompt}

REALISTIC INTEGRATION:
- Treat this as frame ${args.pose.poseNumber} from one photographed contact sheet, not a new image concept. Reuse the same physical set coordinates, time of day, camera family, exposure, white balance, light direction, shadow density, and color grade established by Pose 1.
- Preserve natural fabric drape, folds, gravity, occlusion, thickness and construction for this exact material and fit.
- Match locked lighting direction, color temperature, shadows, contact shadows, perspective, lens feel, depth and scene geometry.
- Keep anatomy realistic with continuous exterior arm/wrist paths and soft natural fingers kept clear of chest embroidery.
- Preserve believable pores, flyaway hairs, fabric microtexture, seam depth, edge transitions, optical depth of field, and grounded foot/contact shadows. Avoid waxy skin, over-smoothed fabric, duplicated motifs, over-sharpening, floating garments, plastic texture, and other synthetic AI tells.
${faceRequired ? `- If the identity photo hides the eyes, keep that cover and the visible jaw, nose, lips, and hair. Do not invent an uncovered face. Eyes the photo shows stay naturally shaped and aligned.
- Follow the planned expression; do not force a smile. If teeth show, render them naturally aligned in the correct count - never uniformly perfect, fused, extra, missing, or warped.
- Skin must show real photographic micro-detail (pores, faint texture variation) rather than an airbrushed, plastic, or over-smoothed "beauty filter" look.` : ""}

PROHIBITED UNRELATED CHANGES:
- STRICT ANATOMICAL RULE: NEVER render three hands, extra arms, duplicate hands, floating hands, phantom limbs, or extra body parts. Never render hands poking impossibly through mid-garment/pallu/dupatta slits, awkward forearm clawing, splayed stiff mannequin fingers, or fingers covering chest embroidery.
- STRICT PRODUCT ISOLATION RULE: Never copy, transfer, or borrow the clothing, saree, dress, colors, prints, or embroidery from the STYLE REFERENCE image. Dress the model ONLY in the uploaded product. ${referenceSlot ? "Also never copy handheld props (coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones); the style-reference posture is used only as the REFERENCE POSE MATCH block directs." : "Also never copy handheld props (coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones) or foreground pillar-leaning postures."}
- STRICT PROHIBITION ON COPYING PRE-SHOOT BACKGROUNDS: Never reproduce pre-shoot background walls, terracotta arches, urns, pots, plants, or outdoor scenery from product reference images.
- Never render duplicate or identical frontal standing poses across different pose slots (Poses 2, 4, and 6 must visibly physically diverge from Pose 1), ${poseScrub === "reference" ? "and never freeze a walking stride, spin, or wide leg split. This frame's body position follows the REFERENCE POSE MATCH block." : `and never freeze a walking stride, spin, or wide leg split.${isPose4CroppedAboveAnkles ? " Frame cleanly to the planned editorial crop without forcing out-of-frame feet." : " Keep both feet grounded in a natural catalog stance; a joined or tapered hem stays closed."}`}
${bottomWear.includesBottomWear
    ? "- ABSOLUTE PROHIBITION ON BOTTOM WEAR SUBSTITUTION: never alter the recorded bottom-wear cut, silhouette, volume, colour or print, or reduce bold motifs to solid colour or tiny dots."
    : isSareeShoot
      ? `- Never substitute or restyle the saree drape, pallu placement, pleat stack or border geometry.
- SAREE BLOUSE SAFEGUARD: NEVER render a bare/strapless mannequin upper-torso look. If product photos show a blouseless mannequin wrap with no separate stitched blouse photo, dress the model in a clean, modest, plain undecorated solid matching/complementary short/elbow-sleeve blouse locked across all poses.`
      : "- ABSOLUTE PROHIBITION ON INVENTING A MATCHING SET: never render coordinated bottom wear that repeats this product's print, motif, embroidery, border, colour blocking or fabric. The bottom stays plain neutral styling."}
${(args.pose.id === "back" || isTrueBack) ? `- DUPATTA REAR VISIBILITY LOCK: Drape any dupatta/shawl/stole forward over both arms so the entire back garment (neckline, embroidery, seams, hem) stays 100% unobstructed.
- HAIR REAR VISIBILITY LOCK: Sweep hair forward or into an updo so back neckline, ties, and rear embroidery stay 100% visible.
- TRUE BACK HARD RULE: shoulders and hips fully face away; reproduce uploaded BACK exactly without inferring rear details from FRONT.` : ""}
- Never change the Pose 1 backdrop wall, floor, lighting, or add unreferenced props (urlis, urns, petals, pedestals), text, logos, or people.
- Never render artificial, forced, stiff, or frozen stock catalog smiles, or dead stiff mannequin arms.
- Never redesign the product or copy garment details from the style reference, and never add, complete, or relocate decoration for symmetry.
${rules.map((rule) => `- ${rule}`).join("\n")}

Product accuracy is more important than style matching.${
    // The closing tail is never compacted (compactFullPromptSafely Tier 5 keeps it whole).
    expressionAttitude ? `\nEXPRESSION & ATTITUDE (PLANNED FOR THE WHOLE SHOOT, WHENEVER THE FACE IS VISIBLE): ${expressionAttitude}` : ""}
${isCloseup ? `${pose5HardRule({ closeupMode, heroDetail: closeupHeroDetail, expression: plannedExpression })}
` : ""}${isShowcase ? `${pose6HardRule({ showcaseShot, showcaseIntent, poseFamily, closeupHeroDetail: recordedCloseupHeroDetail, expression: plannedExpression, referencePosture: referenceSlot?.posture })}
` : ""}${[
    identityLine,
    isTrueBack && !isSaree ? rearViewChecklist(product, bottomWear.includesBottomWear) : "",
    requestedPropsBlock(requestedProps, args.pose.id),
  ].filter(Boolean).map((block) => `${block}\n`).join("")}Output only the finished photograph: no captions, labels, collage, borders or watermark.`;

  // Props the notes ask for narrow every generic no-props line before compaction measures the prompt.
  const finalPrompt = withRequestedPropsAllowed(prompt, requestedProps);
  return assertGenerationPromptWithinLimit(
    finalPrompt.length > IMAGE_PROMPT_SAFE_CHARS ? compactFullPromptSafely(finalPrompt) : finalPrompt,
  );
}
