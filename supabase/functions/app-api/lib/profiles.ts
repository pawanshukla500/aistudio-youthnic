export type JsonRecord = Record<string, unknown>;

import {
  effectiveShowcaseShot,
  normalizeShowcasePlan,
  productHighlightFrame,
  productHighlightPlan,
  showcaseAestheticDirection,
  type ShowcasePlan,
  showcaseShotDirection,
  type ShowcaseShotType,
} from "./showcaseFeature.ts";
import {
  classifyBottomCut,
  detectGarmentPoseFamily,
  effectiveBottomCutClass,
  FARSHI_SILHOUETTE_STRUCTURE,
  type GarmentPoseFamily,
  hasBottomWearInAnalysis,
  isSareePoseFamily,
  normalizeBottomWearMode,
  positiveBottomWearPortion,
  recordedBottomWearText,
  resolveBottomWearPresentation,
} from "./garmentPoses.ts";
import { isNonProductEvidenceRole } from "./referencePolicy.ts";
import {
  isLowPosture,
  mergeGraphPosePlanning,
  normalizePosePlanning,
  type PosePlanning,
  type PosePlanningContext,
  type ReferencePose,
  type SlotPlan,
  type StyleReferenceProfile,
} from "./posePlanning.ts";

// Print and embroidery are what make a garment this SKU rather than a similar
// one, and a single free-text sentence cannot pin motif scale, spacing or the
// geometry of an embroidered yoke. These structured profiles carry that detail
// into every generation prompt and give QA something exact to measure against.
export type PatternGeometryProfile = {
  type: string;
  scale: string;
  orientation: string;
  density: string;
  repeat: string;
  placementByPanel: string[];
  accentColors: string[];
  motifInventory: string[];
};

export type EmbroideryGeometryProfile = {
  placement: string;
  geometry: string;
  motifStructure: string;
  scaleRelativeToGarment: string;
  colorsAndMaterial: string;
  borders: string;
  necklineRelation: string;
};

// What the model wears alongside the garment. Held apart from productIdentity,
// which records what the product references actually show: footwear the customer
// receives is product truth, footwear the stylist adds is a styling decision, and
// conflating them let the generator treat a proposed accessory as part of the SKU.
export type StylingPlanProfile = {
  footwear: string;
  jewellery: string;
  ornaments: string;
  makeup: string;
  hair: string;
  stylingNotes: string;
  themeInterpretation: string;
};

export type GarmentRegionEvidence = {
  region: string;
  // The exact reference role that proved this region. Keeping the source with
  // the observation prevents a front-only trim from becoming a rear hard lock.
  sourceRole: string;
  state: "confirmed" | "confirmed_absent" | "unknown";
  visibleConstruction: string;
  visibleDecoration: string;
  closures: string;
  explicitlyAbsent: string[];
  uncertainty: string;
};

export type SareeTruthProfile = {
  body: {
    mainFabric: string;
    weave: string;
    weaveGeometry: string;
    texture: string;
    transparency: string;
    shine: string;
    baseColor: string;
    secondaryColors: string[];
    pattern: string;
    motifInventory: string[];
    motifScale: string;
    motifOrientation: string;
    motifRepeat: string;
    motifDensity: string;
    motifPlacement: string;
    embellishment: string;
    bodyOrientation: string;
  };
  borders: {
    upperBorder: string;
    lowerBorder: string;
    borderWidth: string;
    upperBorderWidth: string;
    lowerBorderWidth: string;
    borderColors: string;
    construction: string;
    motifGeometry: string;
    edgeTreatment: string;
    continuityRules: string;
    tasselColor: string;
    tasselConstruction: string;
    tasselSpacing: string;
  };
  pallu: {
    hasDistinctPallu: boolean;
    startingRegion: string;
    baseColor: string;
    motifInventory: string[];
    motifScale: string;
    motifOrientation: string;
    motifRepeat: string;
    motifDensity: string;
    borders: string;
    artwork: string;
    zari: string;
    embroidery: string;
    tassels: string;
    edgeTreatment: string;
    visualOrientation: string;
    evidenceReferences: string;
    uncertainty: string;
  };
  pleatZone: {
    patternBehavior: string;
    borderBehavior: string;
    embellishmentBehavior: string;
    hasSpecialPanel: boolean;
  };
  blouse: {
    hasBlouse: boolean;
    color: string;
    fabric: string;
    frontConstruction: string;
    backConstruction: string;
    neckline: string;
    sleeves: string;
    ties: string;
    closure: string;
    embroidery: string;
    border: string;
    pattern: string;
    fit: string;
    isUnstitchedPiece: boolean;
  };
  physics: {
    weight: string;
    stiffness: string;
    fluidity: string;
    transparency: string;
    shine: string;
    creaseBehavior: string;
    expectedFall: string;
  };
  regionEvidence: GarmentRegionEvidence[];
};

export type SareeDrapePlan = {
  baseDrapeFamily: string;
  shoulderSide: string;
  waistTuck: string;
  frontPleatTreatment: string;
  palluShoulderPlacement: string;
  openOrPleatedPallu: string;
  palluSpread: string;
  palluFallDirection: string;
  palluVisibleLength: string;
  handInteraction: string;
  movementAmount: string;
  pinningBehavior: string;
  borderVisibility: string;
  blouseVisibility: string;
  coverageConstraints: string;
  poseSpecificDrapeState: string;
};

export type ProductIdentityProfile = {
  garmentFamily: string;
  category: string;
  mainColor: string;
  secondaryColors: string[];
  fabric: string;
  pattern: string;
  print: string;
  patternGeometry: PatternGeometryProfile;
  embroideryGeometry: EmbroideryGeometryProfile;
  texture: string;
  neckline: string;
  sleeveType: string;
  length: string;
  fit: string;
  silhouette: string;
  frontConstruction: string;
  backConstruction: string;
  buttons: string;
  zippers: string;
  pockets: string;
  embroidery: string;
  logos: string;
  accessoriesIncluded: string;
  bottomWearDetails: string;
  footwearDetails: string;
  detailPlacementMap: string[];
  absenceConstraints: string[];
  invariantDetails: string[];
  uncertaintyNotes: string[];
  garmentEvidence: GarmentRegionEvidence[];
  sareeTruth?: SareeTruthProfile;
  sareeDrapePlan?: SareeDrapePlan;
};

export type StudioPose = {
  id: string;
  title: string;
  description: string;
  cameraAngle: string;
  framing: string;
  bodyPosition: string;
  handPlacement: string;
  expression: string;
  highlightedDetails: string[];
  productVisibilityRules: string[];
  primaryReference: string;
  purpose: string;
  consistencyNotes: string;
  prompt: string;
  enabled: boolean;
  /** Set only on Pose 4/6 when the pose plan copies the style-reference posture (e.g. "seated"). */
  referencePosture?: string;
  /** expressionPlan.attitude from the pose plan. */
  attitude?: string;
};

// The bottom-wear vocabulary now lives in garmentPoses.ts because pose planning,
// prompt composition and the new presentation option all read it. These three
// wrappers keep every existing caller and stored session working unchanged.
export function recordedBottomWearDetails(productIdentity: unknown): string {
  return recordedBottomWearText(productIdentity);
}

export function hasRecordedBottomWear(productIdentity: unknown): boolean {
  return hasBottomWearInAnalysis(productIdentity);
}

export function isFarshiBottomWear(detailsOrProduct: unknown): boolean {
  return classifyBottomCut(detailsOrProduct) === "farshi";
}

export const CLOSEUP_FACE_AND_DETAIL = "face_and_detail";
export const CLOSEUP_PRODUCT_DETAIL = "product_detail";
export type CloseupMode = typeof CLOSEUP_FACE_AND_DETAIL | typeof CLOSEUP_PRODUCT_DETAIL;

const YES_DIRECTION_FLAG = /^(yes|true|required|1)$/i;
const NO_DIRECTION_FLAG = /^(no|false|0)$/i;
const SITTING_POSE_RE = /\b(sit|sits|sitting|seated)\b/i;

const EXPLICIT_SIT_REQUEST = /\b(?:buyer|customer|client|merchant|seller|user|request(?:ed)?|ask(?:ed|s)?|product notes?|mandat(?:e|ory)|explicit(?:ly)?|instruct(?:ion|ed)?)\b/i;

/** A non-empty reason is a description of a photo unless it is an explicit request. */
function stylePhotoSittingReason(value: unknown): boolean {
  const text = String(value ?? "").trim();
  if (!text || EXPLICIT_SIT_REQUEST.test(text)) return false;
  return true;
}
const PRODUCT_DETAIL_CLOSEUP_RE =
  /\b(product[_\s-]?detail(?:[_\s-]?(?:first|only|crop))?|detail[_\s-]?(?:first|only|crop)|omit(?:ting)?(?: the)? face|face optional|without(?: a)?(?: full)? face|macro (?:product )?detail)\b/i;

export function normalizeYesNoFlag(value: unknown, fallback: "yes" | "no" = "no"): "yes" | "no" {
  if (value === true) return "yes";
  if (value === false) return "no";
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (YES_DIRECTION_FLAG.test(text)) return "yes";
  if (NO_DIRECTION_FLAG.test(text)) return "no";
  return fallback;
}

export function isYesDirectionFlag(value: unknown): boolean {
  return normalizeYesNoFlag(value, "no") === "yes";
}

export function normalizeCloseupMode(value: unknown, fallback: CloseupMode = CLOSEUP_FACE_AND_DETAIL): CloseupMode {
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return fallback;
  if (
    text === CLOSEUP_PRODUCT_DETAIL ||
    text === "product_detail_first" ||
    text === "detail" ||
    text === "detail_only" ||
    text === "detail_crop" ||
    text === "macro_detail"
  ) return CLOSEUP_PRODUCT_DETAIL;
  if (
    text === CLOSEUP_FACE_AND_DETAIL ||
    text === "face" ||
    text === "beauty" ||
    text === "face_to_chest" ||
    text === "face_and_product"
  ) return CLOSEUP_FACE_AND_DETAIL;
  return fallback;
}

export const SHOWCASE_INTENTS = [
  "saree_drape",
  "set_full_length",
  "playful_backdrop",
  "full_length_silhouette",
] as const;
export type ShowcaseIntent = typeof SHOWCASE_INTENTS[number];

export function normalizeShowcaseIntent(value: unknown): ShowcaseIntent | "" {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (SHOWCASE_INTENTS as readonly string[]).includes(normalized) ? normalized as ShowcaseIntent : "";
}

export function effectiveShowcaseIntent(args: {
  creative: JsonRecord;
  family: GarmentPoseFamily;
  includesBottomWear: boolean;
}): ShowcaseIntent {
  const recordedValue = normalizeShowcaseIntent(args.creative.showcaseIntent ?? args.creative.showcase_intent);
  if (isSareePoseFamily(args.family)) return "saree_drape";
  // Enum validity is not garment compatibility: a non-saree must never inherit
  // pallu/pleat direction from a stale or misclassified analysis.
  const recorded = recordedValue === "saree_drape" ? "" : recordedValue;
  // A complete-set frame is only coherent when this shoot actually renders the
  // bottom. Consumers must serialize this same effective intent, not the stale
  // analysis value that was suppressed for a top-only shoot.
  if (!args.includesBottomWear && (recorded === "set_full_length" || !recorded)) {
    return args.family === "short_kurti_top" || args.family === "western_casual"
      ? "playful_backdrop"
      : "full_length_silhouette";
  }
  if (recorded) return recorded;
  if (args.includesBottomWear) return "set_full_length";
  return "full_length_silhouette";
}

function joinedPoseText(pose: {
  id?: string;
  title?: string;
  description?: string;
  prompt?: string;
  framing?: string;
  bodyPosition?: string;
  purpose?: string;
  cameraAngle?: string;
  expression?: string;
  highlightedDetails?: unknown;
  productVisibilityRules?: unknown;
} | undefined) {
  if (!pose) return "";
  const listed = [
    ...(Array.isArray(pose.highlightedDetails) ? pose.highlightedDetails : []),
    ...(Array.isArray(pose.productVisibilityRules) ? pose.productVisibilityRules : []),
  ].map((entry) => String(entry ?? ""));
  return [
    pose.id,
    pose.title,
    pose.description,
    pose.prompt,
    pose.framing,
    pose.bodyPosition,
    pose.purpose,
    pose.cameraAngle,
    pose.expression,
    ...listed,
  ].join(" ");
}

export function resolveCloseupMode(args: {
  pose?: {
    id?: string;
    title?: string;
    description?: string;
    prompt?: string;
    framing?: string;
    bodyPosition?: string;
    purpose?: string;
    cameraAngle?: string;
    expression?: string;
    highlightedDetails?: unknown;
    productVisibilityRules?: unknown;
  };
  creative?: JsonRecord;
}): CloseupMode {
  const recorded = args.creative?.closeupMode ?? args.creative?.closeup_mode;
  if (String(recorded ?? "").trim()) return normalizeCloseupMode(recorded);
  if (PRODUCT_DETAIL_CLOSEUP_RE.test(joinedPoseText(args.pose))) return CLOSEUP_PRODUCT_DETAIL;
  return CLOSEUP_FACE_AND_DETAIL;
}

/** "yes" only when the stored flag is an explicit sit, not a description of a reference photo. */
export function recordedSeatedPoseDemand(creative: JsonRecord | undefined): "yes" | "no" {
  const recorded = creative?.seatedPoseRequired ?? creative?.seated_pose_required;
  const describedPhoto = stylePhotoSittingReason(creative?.seatedPoseReason ?? creative?.seated_pose_reason);
  return isYesDirectionFlag(recorded) && !describedPhoto ? "yes" : "no";
}

export function isSeatedEditorialPoseDemanded(args: {
  pose?: {
    id?: string;
    title?: string;
    description?: string;
    prompt?: string;
    framing?: string;
    bodyPosition?: string;
    purpose?: string;
    cameraAngle?: string;
    expression?: string;
    highlightedDetails?: unknown;
    productVisibilityRules?: unknown;
  };
  productDetails?: string;
  creative?: JsonRecord;
  stylingNotes?: string;
}): boolean {
  // A written description of the style photo is the room, not a request for pose 4 to sit.
  if (recordedSeatedPoseDemand(args.creative) === "yes") return true;
  // User notes can still demand sitting even when analysis recorded "no".
  if (SITTING_POSE_RE.test(String(args.productDetails ?? ""))) return true;
  return false;
}

export type PoseSlotContext = {
  garmentFamily?: string;
  productIdentity?: unknown;
  category?: string;
  productDetails?: string;
  skuName?: string;
  poseFamily?: GarmentPoseFamily;
  /** "auto" | "included" | "top_only". An explicit choice outranks the analysis. */
  bottomWearMode?: unknown;
  /** The vision analysis's chosen subject for the sixth frame. */
  showcasePlan?: unknown;
  /** Pose 5's recorded subject, so a colliding sixth frame is widened here too. */
  closeupHeroDetail?: unknown;
  /** Reference-led planning; only an adopted creative/showcase slot changes its template. */
  posePlanning?: PosePlanning;
};

function poseSlotContext(input: string | PoseSlotContext): PoseSlotContext {
  return typeof input === "string" ? { garmentFamily: input } : (input || {});
}

/**
 * Resolve the pose family for a slot request. Callers that already hold the
 * full product identity get the fine-grained family (Bengali saree, kurta set
 * with bottoms, short top); a legacy caller passing only the coarse
 * `garmentFamily` string still gets a sensible family.
 */
export function poseFamilyFor(input: string | PoseSlotContext): GarmentPoseFamily {
  const context = poseSlotContext(input);
  if (context.poseFamily) return context.poseFamily;
  const productIdentity = context.productIdentity ?? (context.garmentFamily ? { garmentFamily: context.garmentFamily } : {});
  return detectGarmentPoseFamily({
    productIdentity,
    category: context.category,
    productDetails: context.productDetails,
    skuName: context.skuName,
  });
}

/** Whether the sixth frame's brief shows bottom wear (the same rule getPoseSlots uses). */
function showcaseIncludesBottomWearFor(
  family: GarmentPoseFamily,
  args: { bottomWearMode?: unknown; productIdentity?: unknown; skuName?: string; productDetails?: string; hasBottomReference?: boolean },
): boolean {
  // An uploaded bottom photo counts in auto mode, as it does at generation (compilePosePrompt).
  const presentation = resolveBottomWearPresentation({
    mode: args.bottomWearMode,
    productIdentity: args.productIdentity ?? {},
    skuName: args.skuName,
    productDetails: args.productDetails,
    hasBottomReference: args.hasBottomReference,
  });
  return presentation.includesBottomWear || (
    normalizeBottomWearMode(args.bottomWearMode) !== "top_only" &&
    (family === "kurta_set" || family === "lehenga")
  );
}

/** The implicit subject of the family fallback sixth frames (see showcaseSlot). */
function fallbackShowcaseSubject(family: GarmentPoseFamily, hasBottoms: boolean): { region: string; shotType: string } {
  if (isSareePoseFamily(family)) return { region: "pallu", shotType: "drape_feature" };
  if (hasBottoms) return { region: "bottom_wear", shotType: "full_body_feature" };
  if (family === "short_kurti_top" || family === "western_casual") return { region: "upper_garment", shotType: "movement_feature" };
  return { region: "silhouette", shotType: "full_body_feature" };
}

/**
 * The PosePlanningContext for a normalized analysis. index.ts rebuilds it with
 * the same options at generation time, so the hard guards see the same garment.
 */
export function posePlanningContextFor(
  analysis: { productIdentity?: unknown; creativeDirection?: unknown },
  options: {
    categoryFallback?: string;
    bottomWearMode?: unknown;
    skuName?: string;
    productDetails?: string;
    hasBottomReference?: boolean;
  } = {},
): PosePlanningContext {
  const productIdentity = objectValue(analysis.productIdentity);
  const garmentFamily = String(productIdentity.garmentFamily ?? "");
  const poseFamily = poseFamilyFor({
    productIdentity,
    garmentFamily,
    category: String(productIdentity.category || options.categoryFallback || ""),
    skuName: options.skuName,
    productDetails: options.productDetails,
  });
  // Mirrors compilePosePrompt in index.ts so the Farshi guard sees the generation's cut.
  const presentation = resolveBottomWearPresentation({
    mode: options.bottomWearMode,
    productIdentity,
    skuName: options.skuName,
    productDetails: options.productDetails,
    hasBottomReference: options.hasBottomReference,
  });
  const bottomCutClass = garmentFamily === "saree" || !presentation.includesBottomWear
    ? "none"
    : effectiveBottomCutClass(presentation.cutClass, Boolean(options.hasBottomReference), {
      skuName: options.skuName,
      productDetails: options.productDetails,
      details: presentation.details,
    });
  const hasBottoms = showcaseIncludesBottomWearFor(poseFamily, { ...options, productIdentity });
  const shot = effectiveShowcaseShot(analysis.creativeDirection, { includesBottomWear: hasBottoms });
  const fallback = fallbackShowcaseSubject(poseFamily, hasBottoms);
  const creative = objectValue(analysis.creativeDirection);
  return {
    poseFamily,
    bottomCutClass,
    showcaseFeatureRegion: shot ? shot.plan.featureRegion : fallback.region,
    showcaseShotType: shot ? shot.shotType : fallback.shotType,
    sitRequested: isSeatedEditorialPoseDemanded({ creative, productDetails: options.productDetails }),
    closeupMode: normalizeCloseupMode(creative.closeupMode ?? creative.closeup_mode),
  };
}

/** Reference-posture prose the v36 prompt may still write into a Pose 4/6 that ended product-led. */
const REFERENCE_POSTURE_PROSE =
  /\b(?:sit|sits|sitting|seat(?:s|ed|ing)?|perch(?:es|ed|ing)?|lean(?:s|ed|ing|t)?|kneel(?:s|ing)?|knelt|crouch(?:es|ed|ing)?|squat(?:s|ted|ting)?|reclin(?:e|es|ed|ing)|loung(?:e|es|ed|ing)|walk(?:s|ed|ing)?|strid(?:e|es|ing)|mid[-\s]?step)\b|\bstyle[-\s]reference\b[^.]{0,80}?\b(?:pose|posture|stance)\b/i;

function adoptedSlot(planning: PosePlanning | undefined, poseId: string): SlotPlan | null {
  if (poseId !== "creative" && poseId !== "showcase") return null;
  const slot = planning?.slots[poseId];
  return slot?.source === "reference" ? slot : null;
}

/** Pose 4 copying the style-reference posture: keeps the garment readability rules, drops the never-sit text. */
function referenceCreativeSlot(base: StudioPose, slot: SlotPlan, isSaree: boolean, referencePose?: ReferencePose): StudioPose {
  const camera = referencePose?.cameraAngle ?? "";
  return {
    ...base,
    title: "Signature Reference Pose",
    framing: camera
      ? `3:4 portrait framed as the STYLE REFERENCE is shot (${camera}), with the complete matched ${slot.posture} posture and the garment's front design, print and colours reading clearly`
      : `3:4 portrait framed so the complete matched ${slot.posture} posture and the garment's front design, hem and construction read clearly, composed differently from Pose 1`,
    bodyPosition: slot.directive,
    cameraAngle: camera
      ? `${camera}, as the STYLE REFERENCE is shot`
      : "Editorial angle chosen for the matched posture, distinct from Pose 1's straight-on hero",
    description: `A natural editorial frame matching the style reference's ${slot.posture} posture while the uploaded garment stays the clear subject.`,
    productVisibilityRules: [
      "product remains the visual subject",
      "no prop or limb hides key construction",
      "the matched posture does not alter the garment's cut, fit, length, pleats, or bottom-wear silhouette",
      "the garment's front design, print and colours stay exactly as the product photos show",
      ...(isLowPosture(slot.posture) ? ["in the folded posture the hem and any bottom wear may rest naturally, but never bunch over or hide the print"] : []),
      ...(isSaree ? ["chest pallu drape, border work, and pleat transitions stay clear"] : []),
      "no handheld objects or style-reference clothing copied",
    ],
    consistencyNotes: "Borrow the style reference's posture, art direction, backdrop, and subtle jewellery taste only; garment, footwear, model identity, and studio light continuity remain locked",
    prompt: `Create a natural editorial catalog frame in the style reference's ${slot.posture} posture. ${slot.directive} Keep both arms anatomically continuous outside garment edges with natural soft fingers clear of yoke craft and a warm, effortless expression. Maintain identical model identity, product truth, and studio set light.`,
  };
}

/** Pose 6 as a complementary variation of the reference posture; the hero-feature framing and rules stay. */
function referenceShowcaseSlot(base: StudioPose, slot: SlotPlan): StudioPose {
  return {
    ...base,
    bodyPosition: slot.directive,
    // Hero brief and product lock first. The visibility rules and the directive are also
    // rendered elsewhere (visibility rules, bodyPosition / REFERENCE POSE MATCH), so the
    // 1,200-char pose-prompt cap in generationPrompt.ts cuts those first.
    prompt: `Create the sixth catalog frame as a complementary variation of the style reference's ${slot.posture} posture, composed for its hero feature. ${base.description} Render the exact model face, hair, skin tone, makeup, jewellery and footwear described in the locked model identity and styling plan, the exact studio set, backdrop wall, flooring and lighting described in the locked creative direction, and the garment's design, print, colour, fit and construction exactly as the product references show. Keep unobstructed: ${base.productVisibilityRules.slice(0, 4).join("; ")}. ${slot.directive}`,
  };
}

/**
 * Build the sixth frame from the feature the vision analysis actually chose.
 *
 * This is the normal path. The family templates below are only the floor for a
 * cached or legacy analysis that predates the plan, and a fixed template is what
 * turned this frame into a second hero shot in the first place.
 */
function knownProductField(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(not visible in the supplied references|unknown|none|none - standalone garment|n\/a|-)$/i.test(trimmed)) {
    return "";
  }
  return trimmed;
}

function buildShowcaseGarmentDetailSummary(
  productIdentity: unknown,
  family: GarmentPoseFamily,
  hasBottoms: boolean,
): { summary: string; highlights: string[] } {
  const product = objectValue(productIdentity);
  const mainColor = knownProductField(product.mainColor ?? product.main_color);
  const fabric = knownProductField(product.fabric);
  const pattern = knownProductField(product.pattern ?? product.print);
  const embroidery = knownProductField(product.embroidery);
  const neckline = knownProductField(product.neckline);
  const sleeveType = knownProductField(product.sleeveType ?? product.sleeve_type);
  const silhouette = knownProductField(product.silhouette);
  const bottomDetails = hasBottoms ? knownProductField(product.bottomWearDetails ?? product.bottom_wear_details) : "";

  const parts: string[] = [];
  const highlights: string[] = [];

  if (mainColor && fabric) {
    parts.push(`${mainColor} ${fabric}`);
    highlights.push(`${mainColor} ${fabric}`);
  } else if (mainColor) {
    parts.push(mainColor);
  } else if (fabric) {
    parts.push(fabric);
  }

  if (isSareePoseFamily(family)) {
    const sareeTruth = objectValue(product.sareeTruth);
    const body = objectValue(sareeTruth.body);
    const pallu = objectValue(sareeTruth.pallu);
    const borders = objectValue(sareeTruth.borders);
    const palluArtwork = knownProductField(pallu.artwork);
    const lowerBorder = knownProductField(borders.lowerBorder);
    const baseColor = knownProductField(body.baseColor);
    const mainFabric = knownProductField(body.mainFabric);
    if (!parts.length && (baseColor || mainFabric)) {
      parts.push([baseColor, mainFabric].filter(Boolean).join(" "));
    }
    if (palluArtwork) {
      parts.push(`pallu artwork: ${palluArtwork}`);
      highlights.push(palluArtwork);
    }
    if (lowerBorder) {
      parts.push(`border: ${lowerBorder}`);
      highlights.push(lowerBorder);
    }
  } else {
    if (embroidery) {
      parts.push(`embroidery: ${embroidery}`);
      highlights.push(embroidery);
    }
    if (pattern && pattern.toLowerCase() !== embroidery.toLowerCase()) {
      parts.push(`pattern: ${pattern}`);
      highlights.push(pattern);
    }
    if (neckline) parts.push(`neckline: ${neckline}`);
    if (sleeveType) parts.push(`sleeves: ${sleeveType}`);
    if (silhouette) parts.push(`silhouette: ${silhouette}`);
    if (bottomDetails) {
      parts.push(`bottom wear: ${bottomDetails}`);
      highlights.push(bottomDetails);
    }
  }

  const bottomSummary = bottomDetails ? `bottom wear: ${bottomDetails}` : "";
  const summaryParts = parts.filter((part) => part !== bottomSummary);
  return {
    // Reserve one of the five bounded slots for the bottom specification;
    // otherwise upper-garment fields can silently drop it from complete sets.
    summary: [
      ...summaryParts.slice(0, bottomSummary ? 4 : 5),
      ...(bottomSummary ? [bottomSummary] : []),
    ].join("; "),
    highlights: highlights.slice(0, 4),
  };
}

/**
 * Analysis v38+: the sixth frame as the PRODUCT HIGHLIGHT - a tight, accurate detail close-up of
 * the feature productHighlightPlan resolved, framed where that feature sits on the worn garment.
 */
function productHighlightSlot(plan: ShowcasePlan, family: GarmentPoseFamily, productIdentity?: unknown, hasBottoms = false): StudioPose {
  const frame = productHighlightFrame(plan.featureRegion);
  const garmentDetails = buildShowcaseGarmentDetailSummary(productIdentity, family, hasBottoms);
  const feature = plan.heroFeature;
  const back = plan.featureRegion === "back_detail";
  const authority = back
    ? "the BACK product photo is the only authority for this back detail: match its closure type, every crossing, bow and hanging end, seams and length exactly, and never invent one"
    : "every stitch, trim, motif and fold matches the product photos at true scale, colour and placement, with nothing invented, simplified or moved";
  const recordedBack = back ? knownProductField(objectValue(productIdentity).backConstruction) : "";
  return {
    id: "showcase",
    title: `Product Highlight: ${feature.length > 48 ? `${feature.slice(0, 45).trimEnd()}...` : feature}`,
    framing: `3:4 portrait detail close-up. ${frame.crop} The model still wears the garment, with the same set and light softly visible behind.`,
    cameraAngle: `${frame.camera}, sharp focus across ${feature}`,
    bodyPosition: `${frame.body}, strictly two natural arms and hands`,
    handPlacement: plan.handPlacement || `Hands clear of ${feature}, never covering, pinching or flattening it`,
    expression: back
      ? "Face turned away from the camera; identity carried by hair, skin tone and styling"
      : "Face mostly outside the crop; if any part shows, it is the locked identity with a relaxed, natural look",
    productVisibilityRules: [
      `${feature} is the subject of this close-up and must be large, sharp and completely unobstructed`,
      authority,
      ...(recordedBack ? [`recorded back construction to match: ${recordedBack}`] : []),
      ...(garmentDetails.summary ? [`preserve exact garment specifications: ${garmentDetails.summary}`] : []),
      ...plan.visibilityRules,
      "never a full-body or three-quarter frame, and never a repeat of the Pose 5 subject",
    ].slice(0, 8),
    consistencyNotes: "Same model identity, styling, set, backdrop and lighting as Pose 1; only the camera moves in close on this feature",
    description: `A tight product-highlight close-up of ${feature}${plan.whyItSells ? ` - ${plan.whyItSells}` : ""}.`,
    highlightedDetails: [feature, plan.featureRegion.replace(/_/g, " "), ...garmentDetails.highlights].slice(0, 6),
    primaryReference: plan.evidenceReference || (isSareePoseFamily(family) ? "saree_front_drape" : "front"),
    purpose: plan.whyItSells || "Show, up close, the detail that makes this product worth buying",
    prompt: `Create a tight, accurate product-highlight close-up of ${feature} on the worn garment. ${frame.crop} ${frame.body}. Render it exactly as the product references show: ${authority}. ${plan.distinctFrom ? `${plan.distinctFrom} ` : ""}Keep the exact studio set, backdrop and lighting described in the locked creative direction, softly out of focus behind the crop.`,
    enabled: true,
  };
}

function showcaseSlotFromPlan(
  plan: ShowcasePlan,
  family: GarmentPoseFamily,
  shot: { shotType: ShowcaseShotType; widenedFromCloseup: boolean },
  productIdentity?: unknown,
  hasBottoms = false,
): StudioPose {
  const shotDirection = showcaseShotDirection(shot.shotType);
  const aestheticDirection = showcaseAestheticDirection(shot.shotType, plan.featureRegion);
  const garmentDetails = buildShowcaseGarmentDetailSummary(productIdentity, family, hasBottoms);
  // The plan's own framing/posture text describes its original distance, so it
  // is dropped once a close-up collision has widened the frame.
  const plannedFraming = shot.widenedFromCloseup ? "" : plan.framing;
  const plannedBodyPosition = shot.widenedFromCloseup ? "" : plan.bodyPosition;
  const plannedCameraAngle = shot.widenedFromCloseup ? "" : plan.cameraAngle;
  const feature = plan.heroFeature;
  const subjectRule = `${feature} is the subject of this frame and must be large, sharp and completely unobstructed`;
  const detailRules = [
    subjectRule,
    ...(garmentDetails.summary ? [`preserve exact garment specifications: ${garmentDetails.summary}`] : []),
    ...plan.visibilityRules,
    "strictly two arms and two hands in natural editorial coordination - never covering the featured detail",
    "this frame must add coverage the other five do not: never a repeat of the hero framing or of the close-up's subject",
  ];
  return {
    id: "showcase",
    title: `Feature Focus: ${feature.length > 48 ? `${feature.slice(0, 45).trimEnd()}...` : feature}`,
    framing: plannedFraming || `3:4 portrait framed for ${feature}. ${shotDirection} ${aestheticDirection}`,
    cameraAngle: plannedCameraAngle ||
      `Eye-level to sculpted editorial angle and distance so ${feature} reads with magazine-grade clarity`,
    bodyPosition: plannedBodyPosition ||
      `Poised editorial posture and natural angle chosen so ${feature} is presented at its best, natural and unforced, with the garment uncrumpled and strictly two anatomically natural arms and hands`,
    handPlacement: plan.handPlacement || `Hands clear of ${feature}; they may frame or hold it open with graceful two-hand coordination, never cover it`,
    expression: plan.expression ||
      "Warm, natural Gen-Z energy with the same face and hairstyle as every other frame, or no face at all when the crop is tight on the feature",
    productVisibilityRules: detailRules.slice(0, 8),
    consistencyNotes: "Same model identity, styling, footwear, set, backdrop and lighting as Pose 1; only the framing and posture change to sell this feature",
    description: `A frame built around ${feature}${plan.whyItSells ? ` - ${plan.whyItSells}` : ""}${garmentDetails.summary ? ` (${garmentDetails.summary})` : ""
    }. ${aestheticDirection}`,
    highlightedDetails: [feature, plan.featureRegion.replace(/_/g, " "), ...garmentDetails.highlights].slice(0, 6),
    primaryReference: plan.evidenceReference || (isSareePoseFamily(family) ? "saree_front_drape" : "front"),
    purpose: plan.whyItSells || "Sell the detail that makes this product worth buying",
    prompt: `Create a catalog frame built entirely around ${feature}. ${shotDirection} ${aestheticDirection} ${garmentDetails.summary ? `Verified garment details to render with 100% fidelity: ${garmentDetails.summary}. ` : ""
      }${shot.widenedFromCloseup
        ? "Shoot it at this wider distance so it reads on the worn garment rather than as a repeat of the detail crop. "
        : ""
      }${plan.distinctFrom ? `It must differ from the other frames: ${plan.distinctFrom} ` : ""
    }Render the exact model face, hair, skin tone, makeup, jewellery and footwear described in the locked model identity and styling plan, the exact studio set, backdrop wall, flooring and lighting described in the locked creative direction, and the garment's design, print, colour, fit and construction exactly as the product references show.`,
    enabled: true,
  };
}

/** The sixth frame's fallback brief, chosen by garment family. */
function showcaseSlot(family: GarmentPoseFamily, hasBottoms: boolean, productIdentity?: unknown): StudioPose {
  const garmentDetails = buildShowcaseGarmentDetailSummary(productIdentity, family, hasBottoms);
  const specClause = garmentDetails.summary ? ` Verified garment specifications: ${garmentDetails.summary}.` : "";
  if (family === "saree_bengali" || family === "saree_ethnic") {
    const bengali = family === "saree_bengali";
    const aesthetic = showcaseAestheticDirection("drape_feature", "pallu");
    return {
      id: "showcase",
      title: bengali ? "Pallu (Aanchal) & Drape Showcase" : "Pallu & Drape Showcase",
      framing: `3:4 portrait, full or three-quarter body framed so the complete pallu panel and the hem border stay inside the frame. ${aesthetic}`,
      bodyPosition: bengali
        ? "Standing tall and serene with shoulders open and level, body angled a few degrees off camera, weight settled on one leg, so the aanchal falls clear of the body and reads as one continuous placed panel"
        : "Standing poised with a gentle turn of the torso so the pallu opens away from the body and its full length and artwork read clearly",
      handPlacement: "One hand may hold the pallu edge low, flat and open so its artwork stays fully visible; the other stays relaxed and clear of the border and pleats (strictly two natural arms and hands)",
      expression: "Calm, warm, self-assured - the same face, hair and styling as every other frame",
      productVisibilityRules: [
        "the pallu artwork, its border and its end treatment are the subject of this frame and must be fully visible and uncreased",
        ...(garmentDetails.summary ? [`preserve exact saree specifications: ${garmentDetails.summary}`] : []),
        "upper and lower borders stay continuous, identical in width, and the hem border stays level",
        "front pleats stay flat, evenly stacked and vertical",
        "the drape plan's shoulder side, fall direction and visible pallu length are unchanged",
        "no hand, arm, hair or prop crosses the pallu artwork",
      ].slice(0, 8),
      consistencyNotes: "Same model identity, styling, set, backdrop and lighting as Pose 1; only the drape presentation opens up",
      description: `A drape-led frame that presents the pallu exactly as the drape plan specifies, with its artwork, border and fall fully readable.${specClause} ${aesthetic}`,
      cameraAngle: "Eye-level, slightly wider than the hero frame so the pallu's full length fits with editorial lighting depth",
      highlightedDetails: (bengali
        ? ["pallu/aanchal artwork", "border continuity", "pleat structure", "weave", ...garmentDetails.highlights]
        : ["pallu artwork", "border geometry", "drape fall", "pleat structure", ...garmentDetails.highlights]).slice(0, 6),
      primaryReference: "saree_pallu_spread",
      purpose: "Show the drape and pallu a saree buyer actually judges",
      prompt: bengali
        ? `Create an elegant Bengali-saree drape frame. ${aesthetic}${specClause} The model stands tall and serene in the studio set, body a few degrees off camera, with the aanchal/pallu placed exactly as the drape plan specifies - over its recorded shoulder, falling in its recorded direction and length, opened low and flat so its artwork, end-piece and border are completely readable. Front pleats stay flat, even and vertical; upper and lower borders stay continuous and identical in width; the hem border stays level. Render the exact model face, hair, makeup, jewellery and footwear described in the locked model identity and styling plan, and the exact studio set, backdrop wall, flooring and lighting described in the locked creative direction.`
        : `Create a graceful saree drape frame. ${aesthetic}${specClause} The model stands poised in the studio set with a gentle torso turn so the pallu opens away from the body and its artwork, motif scale, border and fall are completely readable, exactly as the drape plan specifies. Front pleats stay flat, even and vertical; upper and lower borders stay continuous and identical in width. Render the exact model face, hair, makeup, jewellery and footwear described in the locked model identity and styling plan, and the exact studio set, backdrop wall, flooring and lighting described in the locked creative direction.`,
      enabled: true,
    };
  }

  if (hasBottoms) {
    const aesthetic = showcaseAestheticDirection("full_body_feature", "bottom_wear");
    return {
      id: "showcase",
      title: "Signature Top & Bottom Showcase",
      framing: `3:4 portrait, head-to-toe with the complete top hem and the complete bottom-wear hem plus footwear inside the frame - never cropped at the knee or ankle. ${aesthetic}`,
      bodyPosition: "Natural catalog stance with a small weight shift so both legs, the true hem, and the pleat volume stay readable, feet close enough that a joined or tapered hem does not open into a palazzo; distinctly varied from Pose 1's frontal stance",
      handPlacement: "Hands held clear of the torso and hips so the top's hem line, the waistband and the bottom-wear silhouette are all unobstructed (strictly two natural arms and hands)",
      expression: "Natural, relaxed, authentic Gen-Z expression with the same face and hairstyle as every other frame; subtle genuine warmth, never a forced artificial smile",
      productVisibilityRules: [
        "the complete outfit reads as a set: top from shoulder to hem AND bottom wear from waistband to hem in one frame",
        ...(garmentDetails.summary ? [`preserve exact garment specifications: ${garmentDetails.summary}`] : []),
        "exact bottom-wear cut, leg volume, pleat architecture, hem finish and print strictly preserved",
        "the join between top hem and bottom waistband is visible, not hidden by hands, hair or a dupatta",
        "footwear grounded and fully visible with natural contact shadows",
        "sleeve length and cuff remain readable",
      ].slice(0, 8),
      consistencyNotes: "Same model identity, styling, footwear, set, backdrop and lighting as Pose 1; only the stance and framing open up to sell the complete set",
      description: `A full-length frame whose job is to prove the top and the bottom wear are one coordinated set, both fully visible.${specClause} ${aesthetic}`,
      cameraAngle: "Eye-level to slightly low dynamic editorial angle framed for the complete set",
      highlightedDetails: ["complete set", "bottom-wear silhouette and print", "top length and fit", "footwear", ...garmentDetails.highlights].slice(0, 6),
      primaryReference: "front",
      purpose: "Sell the complete two-piece set in a single catalog frame",
      prompt: `Create a full-length catalog frame that sells the complete set. ${aesthetic}${specClause} The model uses a natural weight shift, feet close enough that a joined or tapered hem stays closed, so both legs of the bottom wear, their true volume, and authentic print read clearly. Show the top from shoulder seam to hem at its true length, and bottom wear from waistband to hem with its exact cut, leg volume, pleating, hem finish, colour and print preserved. Footwear is grounded and visible. Distinct in angle and stance from Pose 1. Render the exact model face, hair, skin tone, makeup, jewellery and footwear described in the locked model identity and styling plan, and the exact studio set, backdrop wall, flooring and lighting described in the locked creative direction.`,
      enabled: true,
    };
  }

  if (family === "short_kurti_top" || family === "western_casual") {
    const aesthetic = showcaseAestheticDirection("movement_feature", "upper_garment");
    return {
      id: "showcase",
      title: "Playful Backdrop Moment",
      framing: `3:4 portrait, three-quarter or full body with the garment's hem line and neckline inside the frame and the established backdrop clearly readable behind the model. ${aesthetic}`,
      bodyPosition: "A natural, relaxed pose that belongs to this set - a small weight shift, a gentle turn, a shoulder tilt, or a relaxed lean against the backdrop element already present; never a frozen stride or a repeat of the hero stance",
      handPlacement: "Relaxed and natural - a hand at the side or lightly at the hip - never crossing the print, neckline or hem, and never a third hand (strictly two natural arms and hands)",
      expression: "Calm, genuine warmth: a small natural smile or an easy glance — never a frozen mid-laugh or an artificial toothy grin",
      productVisibilityRules: [
        "the garment stays the subject: neckline, sleeve shape, hem line, fit and print all unobstructed",
        ...(garmentDetails.summary ? [`preserve exact garment specifications: ${garmentDetails.summary}`] : []),
        "movement must not crumple, twist, or ride the garment up",
        "the pose interacts only with the backdrop and props already established in Pose 1 - never new furniture, props or architecture",
        "the established backdrop is clearly readable behind the model",
      ].slice(0, 8),
      consistencyNotes: "Same model identity, styling, footwear, set, backdrop and lighting as Pose 1; only the body language becomes playful",
      description: `A lively, natural, scroll-stopping moment that plays against the established backdrop while keeping the garment fully readable.${specClause} ${aesthetic}`,
      cameraAngle: "Eye-level candid editorial angle",
      highlightedDetails: ["playful energy", "garment fit and hem", "interaction with the established set", ...garmentDetails.highlights].slice(0, 6),
      primaryReference: "front",
      purpose: "Social-first lifestyle frame that makes the product feel wearable",
      prompt: `Create a natural fashion frame inside the locked studio set. ${aesthetic}${specClause} Use a relaxed pose that belongs to that set - a small weight shift, a gentle turn, or a lean on the backdrop element already present - with a calm genuine expression, never a frozen mid-laugh or a wide stride. Keep the garment's neckline, sleeve shape, hem line, fit, colour and print completely readable and uncrumpled. Do not introduce any new prop, furniture, or architecture. Render the exact model face, hair, skin tone, makeup, jewellery and footwear described in the locked model identity and styling plan, and the exact studio set, backdrop wall, flooring and lighting described in the locked creative direction.`,
      enabled: true,
    };
  }

  const aesthetic = showcaseAestheticDirection("full_body_feature", "silhouette");
  return {
    id: "showcase",
    title: "Full-Length Silhouette Showcase",
    framing: `3:4 portrait, head-to-toe with the complete hemline and footwear inside the frame. ${aesthetic}`,
    bodyPosition: "Dynamic silhouette stance with weight shifted onto one leg, hips angled naturally, so the side seams hang straight, the hem stays level, and the garment shows its true fall and length from a fresh perspective; not a static copy of Pose 1",
    handPlacement: "Hands clear of the body so the silhouette, hem line, any slit and the waist treatment stay unobstructed (strictly two natural arms and hands)",
    expression: "Warm, natural, confident Gen-Z energy with an authentic, effortless expression (never an artificial smile), with the same face and hairstyle as every other frame",
    productVisibilityRules: [
      "the complete silhouette from shoulder to hem is readable and the hem stays level",
      ...(garmentDetails.summary ? [`preserve exact garment specifications: ${garmentDetails.summary}`] : []),
      "true length and fit preserved - never hitched, tucked, gathered or shortened",
      "sleeve length, cuff, neckline and any side slit remain readable",
      "footwear grounded and fully visible",
    ].slice(0, 8),
    consistencyNotes: "Same model identity, styling, footwear, set, backdrop and lighting as Pose 1; only the stance and framing change",
    description: `A full-length frame that shows the garment's true fall, fit and length on the body.${specClause} ${aesthetic}`,
    cameraAngle: "Eye-level, slight three-quarter dynamic angle, full body",
    highlightedDetails: ["silhouette", "true length and fall", "fit", "hem finish", ...garmentDetails.highlights].slice(0, 6),
    primaryReference: "front",
    purpose: "Prove fit, fall and length for the listing",
    prompt: `Create a full-length catalog frame inside the locked studio set. ${aesthetic}${specClause} The model stands with a natural weight shift and angled hips so the side seams hang straight, the hem stays level, and the garment shows its true length, fall and fit from an active perspective distinct from Pose 1. Keep the neckline, sleeves, cuffs, any side slit and the hem finish completely readable, and keep the footwear grounded and visible. Render the exact model face, hair, skin tone, makeup, jewellery and footwear described in the locked model identity and styling plan, and the exact studio set, backdrop wall, flooring and lighting described in the locked creative direction.`,
    enabled: true,
  };
}

export function getPoseSlots(input: string | PoseSlotContext): readonly StudioPose[] {
  const context = poseSlotContext(input);
  const family = poseFamilyFor(context);
  const isSaree = isSareePoseFamily(family);
  // The sixth frame's brief must agree with how the shoot will actually be
  // rendered, so a top-only shoot never stores a "show the bottom wear" brief.
  const bottomPresentation = resolveBottomWearPresentation({
    mode: context.bottomWearMode,
    productIdentity: context.productIdentity ?? {},
    skuName: context.skuName,
    productDetails: context.productDetails,
  });
  const hasBottoms = bottomPresentation.includesBottomWear || (
    normalizeBottomWearMode(context.bottomWearMode) !== "top_only" &&
    (family === "kurta_set" || family === "lehenga")
  );
  // Resolved once here so the stored brief and the generation hard rule describe
  // the same frame even when a close-up collision widens it.
  const showcaseShot = effectiveShowcaseShot(
    {
      showcasePlan: context.showcasePlan,
      closeupHeroDetail: context.closeupHeroDetail,
    },
    { includesBottomWear: hasBottoms },
  );
  const farshiBottom = bottomPresentation.cutClass === "farshi";
  const isShortTop = family === "short_kurti_top";
  const isLongKurti = family === "long_kurti";
  const useCloserPose4 = !farshiBottom && (isSaree || isShortTop || isLongKurti || family === "kurta_set" || family === "western_casual");
  const frontBottomRule = farshiBottom
    ? "exact Farshi structure: three waist pleats each side, one large side-joint pleat each side, 6-inch joined hem with a 4-inch taper; never palazzo, lehenga, skirt, or a gathered salwar cuff; motifs stay at recorded scale"
    : "exact authentic bottom wear cut, volume, and print strictly preserved (farshi must never flatten into palazzo/lehenga/skirt; large motifs must never become solid or dots)";
  const angledBottomRule = farshiBottom
    ? "Farshi structure stays readable from the side: soft structured drape, three waist pleats each side, one large pleat at each side joint, and the 6-inch joined hem with its 4-inch taper; never a palazzo, lehenga, or dhoti"
    : "authentic bottom wear cut, leg volume, and print strictly preserved - never flattened into palazzo/lehenga or tapered into dhoti";
  const rearBottomRule = farshiBottom
    ? "Farshi from the rear keeps two legs, three waist pleats each side, one large pleat at each side joint, and the 6-inch joined hem with its 4-inch taper; never a skirt, open palazzo hem, or gathered salwar cuff"
    : "exact bottom wear cut, volume, and print visible from rear - never flattened, never a skirt, never gathered into cuffs";

  const slots: StudioPose[] = [
    {
      id: "full_front",
      title: "Full Front View",
      framing: isShortTop
        ? "3:4 portrait, natural mid-thigh or balanced full hero centered close enough so the top fills most of the frame cleanly with true neckline, sleeves, and hem completely inside frame"
        : "3:4 portrait, head-to-toe with footwear and garment hem fully inside frame, centered in an open studio floor zone with clean breathing room around the silhouette",
      bodyPosition: isSaree
        ? "Straight-on toward camera in an open studio floor zone away from foreground pillars, shoulders relaxed and spine tall, weight resting gently on one leg, feet planted and close; living-human poise rather than rigid mannequin symmetry"
        : "Straight-on toward camera (shoulders and hips evenly aligned forward) with soft weight settled slightly on one leg so stance feels relaxed and human, both feet planted and close; never copy stiff mannequin arms or stand pinned behind a foreground pillar",
      handPlacement: isSaree
        ? "One arm relaxed cleanly beside the hip with soft natural fingers and the other hand resting lightly at the outer hip/pleat border edge from the outside — never copy splayed mannequin fingers and never poke a hand through a slit inside saree pleats"
        : isShortTop
          ? "One hand lightly relaxed near the waist/hip crease with soft natural fingers and the opposite arm relaxed beside the body — never dead-hanging symmetrically like a mannequin and never covering front prints or embroidery"
          : "Asymmetric relaxed natural placement (one hand soft near hip or outer dupatta/garment edge, opposite arm relaxed clear of torso) — never dead straight mannequin arms, never emerging through fake dupatta/kurta slits, and never covering neckline or yoke craft",
      expression: "Natural, warm, approachable expression with soft relaxed lips and a genuine slight smile or calm composed glance; never a forced, stiff, or artificial toothy grin",
      productVisibilityRules: isShortTop
        ? ["front construction, neckline, sleeves, and bottom hem completely unobstructed", "top framed prominently as primary visual subject", "no garment detail hidden by hands or hair"]
        : [
        "front construction unobstructed",
        frontBottomRule,
          ...(isSaree ? ["complete saree front drape, shoulder pallu, front pleats, and lower border clearly visible"] : ["complete bottom wear visible from waist to hem"]),
        "no garment detail hidden by hands or hair",
      ],
      consistencyNotes: "Establish the model, face, hair, accessories, footwear, scene, lighting, and color-treatment anchor for poses 2-6",
      description: isShortTop
        ? "Straight-on front hero cropped cleanly around the top so fit, neckline, sleeves, and hemline read effortlessly."
        : "Straight-on full-body hero view centered cleanly in the room with complete silhouette readable from head to hem.",
      cameraAngle: isShortTop ? "Eye-level straight-on medium-full catalog hero" : "Eye-level straight-on full-body",
      highlightedDetails: ["front construction", "overall silhouette", "complete outfit"],
      primaryReference: "front",
      purpose: "Primary e-commerce listing image",
      prompt: isShortTop
        ? "Create a straight-on front hero photograph framed close enough that the top fills the frame cleanly from head to below the hip/thigh hem. Show true neckline, sleeve silhouette, print/embroidery, and clean hem fit paired with quiet understated neutral bottoms. Use relaxed, asymmetrical living-human arm placement and a soft, genuine expression (never rigid mannequin arms or artificial grins)."
        : "Create a straight-on full-body front hero photograph positioned in an unobstructed open floor zone of the set (never pinned behind a foreground pillar). Show the complete outfit from head to hem, preserving authentic garment/saree/bottom wear silhouette and print truth with living-human weight shift, natural relaxed hands along exterior edges only, and an effortless calm expression (never mannequin stiff fingers or artificial smiles).",
      enabled: true,
    },
    {
      id: "angled",
      title: isSaree ? "Turning Drape & Fall View" : "Turning 3/4 View",
      framing: isShortTop
        ? "3:4 portrait, three-quarter knees-up framing (head to mid-thigh/knee) zoomed noticeably closer than Pose 1 so sleeve cut, shoulder seam, neckline, and hip hem read crisply"
        : "3:4 portrait, full-body at a slightly closer angled perspective down the room showing clear side silhouette depth with garment hem and footwear intact",
      bodyPosition: "Rotate torso and hips together 35 to 45 degrees into an intentional three-quarter angle in a distinct perspective from Pose 1, both feet planted and close, clearly displaying side silhouette, garment depth, side seam, and sleeve/drape fall without a walking stride or lifted foot; do not stand flat-on to camera",
      handPlacement: isSaree
        ? "Front hand relaxed down beside the outer hip/border with natural curved fingers and rear arm eased slightly behind the waist so pallu shoulder drop and side pleats stay unobstructed — zero stiff mannequin fingers or mid-pleat slit hands"
        : "Front hand relaxed lightly near the outer thigh or behind the hip crease with natural soft fingers so the side seam, slit, sleeve cuff, and waist fit remain 100% readable; never claw or grip the opposite forearm",
      expression: "Same recognizable face and styling, with a relaxed, natural glance following the three-quarter turn; authentic subtle warmth, never an exaggerated or frozen stock smile",
      productVisibilityRules: isSaree
        ? ["drape depth and pallu fall clearly visible", "silhouette is not compressed", "model clearly rotated 35-45 degrees off Pose 1 angle"]
        : isShortTop
          ? ["sleeve shape, armhole, shoulder seam, and waist/hip hem clearly visible", "silhouette is not compressed", "framed knees-up so top construction fills the frame"]
        : [
            "front and side construction and any side slit remain readable",
          "silhouette is not compressed",
          angledBottomRule,
          "bottom wear remains unchanged and visible",
        ],
      consistencyNotes: "Use Pose 1 only as the model and shoot anchor; preserve the original product references as garment truth",
      description: isSaree
        ? "A three-quarter angled view from a subtly shifted camera perspective revealing drape depth, pleat stack, and pallu fall."
        : isShortTop
          ? "A closer three-quarter knees-up angled view that showcases sleeve depth, side fit, and top hem construction clearly."
          : "A three-quarter side view from a shifted angle revealing side seams, garment depth, fit, and silhouette volume.",
      cameraAngle: "Eye-level 35-50 degree three-quarter perspective",
      highlightedDetails: isSaree ? ["drape depth", "pallu fall", "pleats"] : isShortTop ? ["sleeve silhouette", "side fit", "hem finish"] : ["side silhouette", "fit", "drape and construction"],
      primaryReference: "front",
      purpose: "Show garment depth and fit",
      prompt: isShortTop
        ? "Create a closer three-quarter knees-up catalog pose with torso and hips rotated 35 to 45 degrees away from Pose 1's frontal stance. Keep sleeves, shoulder construction, side profile, and hemline crisp and close enough to study easily over understated neutral bottoms, with relaxed soft hands clear of the garment and a genuine natural glance."
        : "Create an intentional 35-to-45 degree three-quarter fashion pose clearly angled and distanced differently from Pose 1, with both feet planted and close so a joined hem stays closed. Reveal side silhouette, drape depth, side seams, and sleeve shape while keeping the full outfit readable and preserving authentic bottom wear or saree pleats. Natural living hands outside the garment perimeter; relaxed natural glance and effortless expression.",
      enabled: true,
    },
    {
      id: "back",
      title: "Back View",
      framing: isShortTop
        ? "3:4 portrait, three-quarter knees-up or full rear view clearly showing the back neckline, shoulders, and complete top back hem"
        : "3:4 portrait, head-to-toe true rear view with the full back and hem visible",
      bodyPosition: "Model faces fully away from camera with shoulders and hips square, weight relaxed on one hip and natural slight human posture; no three-quarter cheat",
      handPlacement: "Arms slightly eased away from the torso sides with natural soft fingers so the entire back panel, waist shape, back hem, and side seams read cleanly",
      expression: "Face is not forced toward camera; preserve identity through hair, body, and styling continuity; if glancing back, profile must match identity anchor naturally",
      productVisibilityRules: isSaree
        ? ["uploaded back image is the sole back-design authority", "rear drape and pallu fall visible", "hair swept forward or into an updo leaving upper back clear", "exact same backdrop wall, floor, and lighting from Pose 1 - zero new props"]
        : [
          "uploaded back image is the sole back-design authority",
          "entire rear construction visible from neckline to hem",
          "dupatta or shawl draped forward over arms/front only - back of kurti/dress must be 100% visible and unobstructed",
          "hair swept forward or in an updo - back neckline, ties, and rear details completely unobstructed",
          "never infer back details from the front",
          rearBottomRule,
          "exact same backdrop wall, floor, and lighting from Pose 1 - zero new props",
        ],
      consistencyNotes: "Keep the exact same model identity, hair, accessories, footwear, exact bottom wear, and identical studio set/backdrop wall from Pose 1 while showcasing the authoritative back",
      description: "A true full back view sourced from the uploaded back product photograph with unobstructed rear garment construction.",
      cameraAngle: "Eye-level straight-on back view",
      highlightedDetails: isSaree ? ["rear drape", "pallu fall", "back blouse details"] : ["back construction", "back neckline", "rear pattern placement"],
      primaryReference: "back",
      purpose: "Document the real back design",
      prompt: "Turn the model fully away from camera to capture the authentic rear garment design from the uploaded back reference. For outfits with a dupatta, shawl, or stole, drape it forward over the arms or front so the back panel, neckline, embroidery, seams, and fit remain 100% unobstructed and clearly visible. Sweep hair forward or into an updo. Preserve the exact model identity, styling, and the identical studio set, wall color, and lighting established in Pose 1.",
      enabled: true,
    },
    {
      id: "creative",
      title: "Natural Editorial Pose",
      framing: useCloserPose4
        ? isShortTop
          ? "3:4 portrait, waist-up to mid-thigh editorial framing noticeably closer than Pose 1 with natural set depth behind the model"
          : "3:4 portrait, knees-up three-quarter editorial framing clearly closer and differently composed than Pose 1 while keeping upper drape, waist, and garment fall crisp"
        : "3:4 portrait with full head-to-toe editorial framing in a shifted studio spot and distinct posture from Pose 1",
      bodyPosition: useCloserPose4
        ? "Relaxed editorial contrapposto or soft three-quarter shoulder lean clearly distinct from Pose 1's centered stance within the same room — upper body eased into a natural asymmetric weight shift matching the closer editorial crop; sit only when product notes demand sitting, never copy style-reference sitting or pillar-pinning, and never freeze a walking stride"
        : "Relaxed full-length editorial stance in a distinct angle/spot of the room, far from Pose 1's pose: soft contrapposto weight shift with both feet grounded and close so hems, pleats, and joined Farshi hems stay intact. Sit only when the product notes demand sitting; never copy style-reference posture or freeze a walking stride",
      handPlacement: isSaree
        ? "One hand gracefully touches the exterior outer lower edge of the pallu/drape from outside while the other hand rests softly beside the hip/waistline with natural curved fingers — zero phantom hands emerging from inside pleats and zero stiff splayed fingers"
        : "Intentional asymmetric relaxed editorial arms — for example one hand resting softly near a hip/pocket crease or lightly guiding the outer dupatta border while the other relaxes with a gentle elbow bend; never claw the opposite forearm or cover yoke embroidery",
      expression: "Calm, natural editorial warmth — a soft genuine smile or easy unposed gaze; never a frozen laugh or an artificial stock grin",
      productVisibilityRules: isSaree
        ? ["product remains the visual subject", "closer editorial crop shows chest pallu drape, border work, and pleat transitions clearly", "no prop or limb hides key drape features", "no handheld coffee/bag/sunglasses copied from style reference"]
        : useCloserPose4
          ? [
            "product remains the visual subject within the planned knees-up/waist-up editorial crop",
            "clear variation in camera distance and body language from Pose 1",
            "no prop or limb hides neckline, sleeves, yoke, or garment construction",
            "no handheld objects or style-reference clothing copied",
          ]
        : [
          "product remains the visual subject",
          "no prop or limb hides key construction",
          "creative movement does not alter bottom wear cut, leg volume, fit, or silhouette",
          "if seated on a bench or architectural step, both trouser legs and footwear remain visible, unbunched, and fully displayed",
        ],
      consistencyNotes: "Borrow only art direction, backdrop, and subtle jewellery taste from style references; garment, footwear, model identity, and studio light continuity remain locked",
      description: useCloserPose4
        ? "A closer, distinct editorial pose (knees-up or waist-up three-quarter angle) clearly diverging in camera proximity and body language from Pose 1, unless product notes demand sitting."
        : "A full-length natural editorial pose clearly distinct from Pose 1 (relaxed contrapposto with feet grounded and close), unless the product notes demand a seated frame.",
      cameraAngle: useCloserPose4 ? "Intimate eye-level to slight editorial angle, knees-up or mid-thigh crop" : "Product-appropriate dynamic full-body editorial angle",
      highlightedDetails: isSaree ? ["upper drape and border clarity", "fabric fluidity", "editorial poise"] : isShortTop ? ["bodice & sleeve fit up close", "editorial warmth", "neckline craft"] : ["movement and silhouette", "fabric drape", "editorial variety"],
      primaryReference: "front",
      purpose: "Campaign and social-commerce storytelling with genuine compositional variety",
      prompt: useCloserPose4
        ? "Create a closer three-quarter editorial portrait (knees-up or waist-to-mid-thigh framing as planned) with a relaxed contrapposto shoulder/hip shift clearly distinct in distance and posture from Pose 1. Sit only if the product notes explicitly ask for a seated shot; never copy sitting, pillar-leaning, clothing, coffee cups, or tote bags from the style reference, and never freeze a walking stride. Keep both arms anatomically continuous outside garment edges with natural soft fingers clear of yoke craft and a warm, effortless expression. Maintain identical model identity, product truth, and studio set light."
        : "Create a full-length natural editorial catalog frame clearly distinct in angle and posture from Pose 1 — a relaxed contrapposto stance with both feet grounded and close so hems, pleats, and joined Farshi hems stay intact. Sit only when the product notes explicitly demand sitting. Never copy a seated pose or handheld objects from the style photo, and never freeze a walking stride. Use a calm, natural expression, relaxed exterior hands, and identical model identity, product truth, and studio set light.",
      enabled: true,
    },
    {
      id: "closeup",
      title: "Face + Details Close-Up",
      framing: "3:4 portrait, genuinely zoomed in - either a face-to-chest/face-to-waist crop with a LARGE readable product detail, or a tighter product-detail crop when a full face would make that detail too small - never a repeat of the full-body hero",
      bodyPosition: "Natural, relaxed upper-body or detail-crop angle that keeps the chosen selling detail large and sharp; include the face only when that still leaves the detail catalog-readable",
      handPlacement: "Keep hands relaxed OUT of the chest/yoke embroidery or primary craft zone (arms eased downward at sides or cropped cleanly out of frame) so zero fingers obscure, press flat on, or distract from the craftsmanship",
      expression: "When the face is in frame: a soft, genuine, calm expression with relaxed eyes; never a forced grin. When product-detail-first: expression is optional because the face may be partial or omitted",
      productVisibilityRules: [
        "the named primary product selling detail is large, sharp, and 100% unobstructed - never covered by fingers, hands, or a dupatta",
        "never a full-body or wide hero repeat",
        "include a sharp face-to-chest or face-to-waist pairing only when that crop still makes the detail readable",
        "if embroidery, neckline craft, print scale, pallu/border, or fabric texture would be too small beside a full face, crop to the product detail instead of the face",
      ],
      consistencyNotes: "Keep the same identity, hair, makeup, jewellery, footwear, scene, lighting, and product truth from Pose 1; only the crop tightens around the selling detail",
      description: "A zoomed-in macro shot selling the primary garment's signature craftsmanship with hands completely clear of the craft.",
      cameraAngle: "Eye-level macro or tight detail crop centered squarely on the primary craft detail",
      highlightedDetails: ["key primary garment detail", "craftsmanship and weave", "optional face"],
      primaryReference: isSaree ? "saree_body_detail" : "fabric_pattern",
      purpose: "Social-first product-detail shot proving primary fabric, weave, and embroidery quality",
      prompt: "Create a genuinely zoomed-in product-detail macro photograph clearly tighter than Pose 1, focused on the primary garment's signature craft (kurti/top neckline, yoke embroidery, butti weave, or saree body weave & border — never hijacked by a secondary dupatta). Keep hands cleanly out of the embroidery zone (never pressing fingers flat across chest motifs). Include the locked face only in a face-to-chest crop if the detail stays large; otherwise crop tightly onto the garment craft itself inside the exact same room lighting.",
      enabled: true,
    },
    showcaseShot?.plan.productHighlight
      ? productHighlightSlot(showcaseShot.plan, family, context.productIdentity, hasBottoms)
      : showcaseShot
      ? showcaseSlotFromPlan(showcaseShot.plan, family, showcaseShot, context.productIdentity, hasBottoms)
      : showcaseSlot(family, hasBottoms, context.productIdentity),
  ];
  const creativeRef = adoptedSlot(context.posePlanning, "creative");
  const showcaseRef = adoptedSlot(context.posePlanning, "showcase");
  if (!creativeRef && !showcaseRef) return slots;
  return slots.map((slot) => {
    if (slot.id === "creative" && creativeRef) return referenceCreativeSlot(slot, creativeRef, isSaree, context.posePlanning?.referencePose);
    if (slot.id === "showcase" && showcaseRef) return referenceShowcaseSlot(slot, showcaseRef);
    return slot;
  });
}

function stringValue(value: unknown, fallback = "Not visible in the supplied references") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function bottomWearDetailsValue(value: unknown, fallback = "Not visible in the supplied references"): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const parts = [
      typeof obj.classification === "string" ? obj.classification.trim() : "",
      typeof obj.cutTruth === "string" ? obj.cutTruth.trim() : "",
      typeof obj.waistAndPleating === "string" ? obj.waistAndPleating.trim() : "",
      typeof obj.legVolume === "string" ? obj.legVolume.trim() : "",
      typeof obj.hemline === "string" ? obj.hemline.trim() : "",
      typeof obj.fabricColorPrint === "string" ? obj.fabricColorPrint.trim() : "",
      typeof obj.negativeConstraints === "string" ? obj.negativeConstraints.trim() : "",
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(". ");
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v || "")}`)
      .join(". ");
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function stringArray(value: unknown, fallback: string[] = []) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return fallback;
  const entries = value.map((item) => stringValue(item, "")).filter(Boolean);
  return entries.length ? entries.slice(0, 20) : fallback;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stripJsonFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export function parseJsonResponse(text: string): JsonRecord {
  const directCandidate = stripJsonFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(directCandidate);
  } catch {
    const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    const cleaned = stripJsonFences(withoutThink);
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      const objectMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!objectMatch) throw err;
      parsed = JSON.parse(objectMatch[0]);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The AI provider returned an invalid object.");
  return parsed as JsonRecord;
}

function patternGeometry(product: JsonRecord): PatternGeometryProfile {
  const geometry = objectValue(product.patternGeometry ?? product.pattern_geometry);
  return {
    // A legacy profile may describe the print in `print` and leave `pattern`
    // empty. Declaring such a garment solid would make the generation lock
    // contradict the product.
    type: stringValue(geometry.type, stringValue(product.pattern, stringValue(product.print, "Solid - no repeating pattern visible"))),
    scale: stringValue(geometry.scale),
    orientation: stringValue(geometry.orientation),
    density: stringValue(geometry.density),
    repeat: stringValue(geometry.repeat),
    placementByPanel: stringArray(geometry.placementByPanel ?? geometry.placement_by_panel),
    accentColors: stringArray(geometry.accentColors ?? geometry.accent_colors),
    motifInventory: stringArray(geometry.motifInventory ?? geometry.motif_inventory),
  };
}

function embroideryGeometry(product: JsonRecord): EmbroideryGeometryProfile {
  const geometry = objectValue(product.embroideryGeometry ?? product.embroidery_geometry);
  return {
    placement: stringValue(geometry.placement, stringValue(product.embroidery, "No embroidery visible")),
    geometry: stringValue(geometry.geometry),
    motifStructure: stringValue(geometry.motifStructure ?? geometry.motif_structure),
    scaleRelativeToGarment: stringValue(geometry.scaleRelativeToGarment ?? geometry.scale_relative_to_garment),
    colorsAndMaterial: stringValue(geometry.colorsAndMaterial ?? geometry.colors_and_material),
    borders: stringValue(geometry.borders),
    necklineRelation: stringValue(geometry.necklineRelation ?? geometry.neckline_relation),
  };
}

/**
 * `preserveEmpty` separates two different callers. Analysis output wants a
 * default when the model left a field blank. A stylist's save does not: clearing
 * a field is a decision, and refilling it with generated text would overwrite
 * that decision on every round trip.
 */
export function normalizeStylingPlan(raw: unknown, options: { preserveEmpty?: boolean } = {}): StylingPlanProfile {
  const plan = objectValue(raw);
  const field = (value: unknown, fallback: string) => {
    if (options.preserveEmpty && (typeof value === "string" || value === null)) return String(value ?? "").trim();
    return stringValue(value, fallback);
  };
  return {
    footwear: field(plan.footwear, "Simple neutral footwear that suits the garment without competing with it"),
    jewellery: field(plan.jewellery, "Minimal jewellery appropriate to the garment and scene"),
    ornaments: field(plan.ornaments, "No additional ornaments"),
    makeup: field(plan.makeup, "Natural everyday makeup with soft definition"),
    hair: field(plan.hair, "Simple hairstyle that keeps the neckline and yoke visible"),
    stylingNotes: field(plan.stylingNotes ?? plan.styling_notes, ""),
    themeInterpretation: field(plan.themeInterpretation ?? plan.theme_interpretation, ""),
  };
}

function garmentEvidence(product: JsonRecord): GarmentRegionEvidence[] {
  const evidence = product.garmentEvidence ?? product.garment_evidence;
  if (!Array.isArray(evidence)) return [];
  return evidence.map((e: unknown) => {
    const obj = objectValue(e);
    const state = String(obj.state || "unknown").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return {
      region: stringValue(obj.region),
      sourceRole: normalizeReferenceRole(
        obj.sourceRole ?? obj.source_role ?? obj.evidenceRole ?? obj.evidence_role ?? obj.referenceRole ?? obj.reference_role,
      ),
      state: ["confirmed", "confirmed_absent", "unknown"].includes(state) ? state as "confirmed" | "confirmed_absent" | "unknown" : "unknown",
      visibleConstruction: stringValue(obj.visibleConstruction ?? obj.visible_construction),
      visibleDecoration: stringValue(obj.visibleDecoration ?? obj.visible_decoration),
      closures: stringValue(obj.closures),
      explicitlyAbsent: stringArray(obj.explicitlyAbsent ?? obj.explicitly_absent),
      uncertainty: stringValue(obj.uncertainty),
    };
  }).filter((entry) => !isNonProductEvidenceRole(entry.sourceRole));
}

function normalizeReferenceRole(value: unknown) {
  return stringValue(value, "").toLowerCase().replace(/[\s-]+/g, "_");
}

function isRearRegion(value: string) {
  return /(?:^|\b)(?:back|rear|centre[_\s-]?back|center[_\s-]?back)(?:\b|$)/i.test(value);
}

const REAR_SOURCE_ROLES = new Set([
  "back",
  "saree_back_drape",
  "saree_blouse_back",
  "saree_blouse_back_piece",
]);

const REAR_DETAIL_TERMS = [
  "lace",
  "trim",
  "piping",
  "fringe",
  "tassel",
  "latkan",
  "embroidery",
  "border",
  "ribbon",
  "sequin",
  "bead",
  "button",
  "zipper",
  "zip",
  "tie",
  "closure",
  "keyhole",
];

function rearRegionMatches(claim: string, evidence: GarmentRegionEvidence) {
  const claimLocation = claim.split(":", 1)[0].toLowerCase();
  const evidenceLocation = evidence.region.toLowerCase();
  if (!isRearRegion(claimLocation) || !isRearRegion(evidenceLocation)) return false;
  const areaTerms = ["neck", "hem", "body", "blouse", "waist", "sleeve", "bottom", "pallu", "border", "tassel"];
  const requiredAreas = areaTerms.filter((term) => claimLocation.includes(term));
  return requiredAreas.every((term) => evidenceLocation.includes(term));
}

function rearDetailIsProven(claim: string, evidence: GarmentRegionEvidence) {
  const claimText = claim.toLowerCase();
  const sourceText = [evidence.visibleConstruction, evidence.visibleDecoration, evidence.closures].join("\n").toLowerCase();
  const absentText = evidence.explicitlyAbsent.join(" ").toLowerCase();
  return REAR_DETAIL_TERMS
    .filter((term) => claimText.includes(term))
    .every((term) => {
      const negated = new RegExp(`\\b(?:no|without|absent|lacks?|does not have|doesn't have|not)\\b.*\\b${term}\\b`, "i");
      const directlyDenied = sourceText.split(/[.\n;]/).some((statement) => negated.test(statement));
      return sourceText.includes(term) && !absentText.includes(term) && !directlyDenied;
    });
}

/**
 * A placement map is useful only where it remains tied to physical evidence.
 * In particular, never let a front-only lace/trim claim leak into a back pose
 * through a free-text "back hem" placement. Legacy analyses without source
 * provenance remain readable, but their rear placement claims are deliberately
 * treated as unproven until a fresh analysis records the direct back source.
 */
export function sanitizeDetailPlacementMap(value: unknown, evidenceValue: unknown): string[] {
  const evidence = Array.isArray(evidenceValue)
    ? garmentEvidence({ garmentEvidence: evidenceValue })
    : garmentEvidence(objectValue(evidenceValue));
  return stringArray(value).filter((claim) => {
    if (!isRearRegion(claim)) return true;
    return evidence.some((entry) =>
      entry.state === "confirmed" &&
      REAR_SOURCE_ROLES.has(entry.sourceRole) &&
      rearRegionMatches(claim, entry) &&
      rearDetailIsProven(claim, entry)
    );
  });
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") return true;
    if (value.trim().toLowerCase() === "false") return false;
  }
  return fallback;
}

function normalizeRegionEvidence(value: unknown): GarmentRegionEvidence[] {
  return garmentEvidence({ garmentEvidence: value });
}

export function normalizeSareeTruth(
  raw: unknown,
): SareeTruthProfile | undefined {
  const truth = objectValue(raw);
  if (!Object.keys(truth).length) return undefined;
  const body = objectValue(truth.body);
  const borders = objectValue(truth.borders);
  const pallu = objectValue(truth.pallu);
  const pleatZone = objectValue(truth.pleatZone ?? truth.pleat_zone);
  const blouse = objectValue(truth.blouse);
  const physics = objectValue(truth.physics);
  return {
    body: {
      mainFabric: stringValue(body.mainFabric ?? body.main_fabric, ""),
      weave: stringValue(body.weave, ""),
      weaveGeometry: stringValue(body.weaveGeometry ?? body.weave_geometry, ""),
      texture: stringValue(body.texture, ""),
      transparency: stringValue(body.transparency, ""),
      shine: stringValue(body.shine, ""),
      baseColor: stringValue(body.baseColor ?? body.base_color, ""),
      secondaryColors: stringArray(
        body.secondaryColors ?? body.secondary_colors,
      ),
      pattern: stringValue(body.pattern, ""),
      motifInventory: stringArray(body.motifInventory ?? body.motif_inventory),
      motifScale: stringValue(body.motifScale ?? body.motif_scale, ""),
      motifOrientation: stringValue(
        body.motifOrientation ?? body.motif_orientation,
        "",
      ),
      motifRepeat: stringValue(body.motifRepeat ?? body.motif_repeat, ""),
      motifDensity: stringValue(body.motifDensity ?? body.motif_density, ""),
      motifPlacement: stringValue(
        body.motifPlacement ?? body.motif_placement,
        "",
      ),
      embellishment: stringValue(body.embellishment, ""),
      bodyOrientation: stringValue(
        body.bodyOrientation ?? body.body_orientation,
        "",
      ),
    },
    borders: {
      upperBorder: stringValue(borders.upperBorder ?? borders.upper_border, ""),
      lowerBorder: stringValue(borders.lowerBorder ?? borders.lower_border, ""),
      borderWidth: stringValue(borders.borderWidth ?? borders.border_width, ""),
      upperBorderWidth: stringValue(
        borders.upperBorderWidth ?? borders.upper_border_width,
        "",
      ),
      lowerBorderWidth: stringValue(
        borders.lowerBorderWidth ?? borders.lower_border_width,
        "",
      ),
      borderColors: stringValue(
        borders.borderColors ?? borders.border_colors,
        "",
      ),
      construction: stringValue(borders.construction, ""),
      motifGeometry: stringValue(
        borders.motifGeometry ?? borders.motif_geometry,
        "",
      ),
      edgeTreatment: stringValue(
        borders.edgeTreatment ?? borders.edge_treatment,
        "",
      ),
      continuityRules: stringValue(
        borders.continuityRules ?? borders.continuity_rules,
        "",
      ),
      tasselColor: stringValue(borders.tasselColor ?? borders.tassel_color, ""),
      tasselConstruction: stringValue(
        borders.tasselConstruction ?? borders.tassel_construction,
        "",
      ),
      tasselSpacing: stringValue(
        borders.tasselSpacing ?? borders.tassel_spacing,
        "",
      ),
    },
    pallu: {
      hasDistinctPallu: booleanValue(
        pallu.hasDistinctPallu ?? pallu.has_distinct_pallu,
      ),
      startingRegion: stringValue(
        pallu.startingRegion ?? pallu.starting_region,
        "",
      ),
      baseColor: stringValue(pallu.baseColor ?? pallu.base_color, ""),
      motifInventory: stringArray(
        pallu.motifInventory ?? pallu.motif_inventory,
      ),
      motifScale: stringValue(pallu.motifScale ?? pallu.motif_scale, ""),
      motifOrientation: stringValue(
        pallu.motifOrientation ?? pallu.motif_orientation,
        "",
      ),
      motifRepeat: stringValue(pallu.motifRepeat ?? pallu.motif_repeat, ""),
      motifDensity: stringValue(pallu.motifDensity ?? pallu.motif_density, ""),
      borders: stringValue(pallu.borders, ""),
      artwork: stringValue(pallu.artwork, ""),
      zari: stringValue(pallu.zari, ""),
      embroidery: stringValue(pallu.embroidery, ""),
      tassels: stringValue(pallu.tassels, ""),
      edgeTreatment: stringValue(
        pallu.edgeTreatment ?? pallu.edge_treatment,
        "",
      ),
      visualOrientation: stringValue(
        pallu.visualOrientation ?? pallu.visual_orientation,
        "",
      ),
      evidenceReferences: stringValue(
        pallu.evidenceReferences ?? pallu.evidence_references,
        "",
      ),
      uncertainty: stringValue(pallu.uncertainty, ""),
    },
    pleatZone: {
      patternBehavior: stringValue(
        pleatZone.patternBehavior ?? pleatZone.pattern_behavior,
        "",
      ),
      borderBehavior: stringValue(
        pleatZone.borderBehavior ?? pleatZone.border_behavior,
        "",
      ),
      embellishmentBehavior: stringValue(
        pleatZone.embellishmentBehavior ?? pleatZone.embellishment_behavior,
        "",
      ),
      hasSpecialPanel: booleanValue(
        pleatZone.hasSpecialPanel ?? pleatZone.has_special_panel,
      ),
    },
    blouse: {
      hasBlouse: booleanValue(blouse.hasBlouse ?? blouse.has_blouse),
      color: stringValue(blouse.color, ""),
      fabric: stringValue(blouse.fabric, ""),
      frontConstruction: stringValue(
        blouse.frontConstruction ?? blouse.front_construction,
        "",
      ),
      backConstruction: stringValue(
        blouse.backConstruction ?? blouse.back_construction,
        "",
      ),
      neckline: stringValue(blouse.neckline, ""),
      sleeves: stringValue(blouse.sleeves, ""),
      ties: stringValue(blouse.ties, ""),
      closure: stringValue(blouse.closure, ""),
      embroidery: stringValue(blouse.embroidery, ""),
      border: stringValue(blouse.border, ""),
      pattern: stringValue(blouse.pattern, ""),
      fit: stringValue(blouse.fit, ""),
      isUnstitchedPiece: booleanValue(
        blouse.isUnstitchedPiece ?? blouse.is_unstitched_piece,
      ),
    },
    physics: {
      weight: stringValue(physics.weight, ""),
      stiffness: stringValue(physics.stiffness, ""),
      fluidity: stringValue(physics.fluidity, ""),
      transparency: stringValue(physics.transparency, ""),
      shine: stringValue(physics.shine, ""),
      creaseBehavior: stringValue(
        physics.creaseBehavior ?? physics.crease_behavior,
        "",
      ),
      expectedFall: stringValue(
        physics.expectedFall ?? physics.expected_fall,
        "",
      ),
    },
    regionEvidence: normalizeRegionEvidence(
      truth.regionEvidence ?? truth.region_evidence,
    ),
  };
}

export function normalizeSareeDrapePlan(
  raw: unknown,
): SareeDrapePlan | undefined {
  const plan = objectValue(raw);
  if (!Object.keys(plan).length) return undefined;
  return {
    baseDrapeFamily: stringValue(
      plan.baseDrapeFamily ?? plan.base_drape_family,
      "",
    ),
    shoulderSide: stringValue(plan.shoulderSide ?? plan.shoulder_side, ""),
    waistTuck: stringValue(plan.waistTuck ?? plan.waist_tuck, ""),
    frontPleatTreatment: stringValue(
      plan.frontPleatTreatment ?? plan.front_pleat_treatment,
      "",
    ),
    palluShoulderPlacement: stringValue(
      plan.palluShoulderPlacement ?? plan.pallu_shoulder_placement,
      "",
    ),
    openOrPleatedPallu: stringValue(
      plan.openOrPleatedPallu ?? plan.open_or_pleated_pallu,
      "",
    ),
    palluSpread: stringValue(plan.palluSpread ?? plan.pallu_spread, ""),
    palluFallDirection: stringValue(
      plan.palluFallDirection ?? plan.pallu_fall_direction,
      "",
    ),
    palluVisibleLength: stringValue(
      plan.palluVisibleLength ?? plan.pallu_visible_length,
      "",
    ),
    handInteraction: stringValue(
      plan.handInteraction ?? plan.hand_interaction,
      "",
    ),
    movementAmount: stringValue(
      plan.movementAmount ?? plan.movement_amount,
      "",
    ),
    pinningBehavior: stringValue(
      plan.pinningBehavior ?? plan.pinning_behavior,
      "",
    ),
    borderVisibility: stringValue(
      plan.borderVisibility ?? plan.border_visibility,
      "",
    ),
    blouseVisibility: stringValue(
      plan.blouseVisibility ?? plan.blouse_visibility,
      "",
    ),
    coverageConstraints: stringValue(
      plan.coverageConstraints ?? plan.coverage_constraints,
      "",
    ),
    poseSpecificDrapeState: stringValue(
      plan.poseSpecificDrapeState ?? plan.pose_specific_drape_state,
      "",
    ),
  };
}

/**
 * Job states in which the worker will still spend money on a session.
 *
 * A session may have at most one job in these states. Queueing one that is
 * already running produced a second job and a second set of pose rows against
 * the same session, so every pose was generated and billed twice. The partial
 * unique index on generation_jobs uses this same set.
 *
 * "cancelling" belongs here: the worker still claims such a job and only stops
 * once it reaches finalizeCancelledJob, so a replacement started in that window
 * spends alongside it. It is transient, so it blocks the next run only briefly.
 */
export const ACTIVE_GENERATION_JOB_STATUSES = ["queued", "processing", "cancelling"] as const;

export const REQUIRED_POSE_IDS = [
  "full_front",
  "angled",
  "back",
  "creative",
  "closeup",
  "showcase",
] as const;
const SAREE_ANALYSIS_ERROR =
  "Stored saree analysis is incomplete or outdated. Reanalyse the product references before generation.";

function sectionHasEvidence(section: unknown) {
  return Object.values(objectValue(section)).some((value) => {
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return false;
  });
}

export function sareeAnalysisIssues(session: unknown): string[] {
  const value = objectValue(session);
  const product = objectValue(value.productIdentity ?? value.product_identity);
  const references = Array.isArray(value.references)
    ? value.references.map(objectValue)
    : [];
  const garmentFamily = String(product.garmentFamily ?? product.garment_family).toLowerCase();
  const category = String(value.category ?? product.category).toLowerCase();
  const isSareeSession = garmentFamily === "saree" || category.includes("saree") ||
    references.some((reference) => String(reference.role || "").startsWith("saree_"));
  if (!isSareeSession) return [];
  const truth = objectValue(product.sareeTruth ?? product.saree_truth);
  const plan = objectValue(product.sareeDrapePlan ?? product.saree_drape_plan);
  const poseValue = value.posePlan ?? value.pose_plan;
  const poses: unknown[] = Array.isArray(poseValue) ? poseValue : [];
  const issues: string[] = [];
  if (garmentFamily !== "saree") issues.push("garment family is not saree");
  if (!Object.keys(truth).length) issues.push("saree truth is missing");
  for (const section of ["body", "borders", "pallu", "physics"] as const) {
    if (!sectionHasEvidence(truth[section])) {
      issues.push(`${section} evidence is missing`);
    }
  }
  if (!Object.keys(plan).length) issues.push("saree drape plan is missing");
  if (
    poses.length !== REQUIRED_POSE_IDS.length ||
    poses.map((pose) => String(objectValue(pose).id)).join(",") !==
      REQUIRED_POSE_IDS.join(",")
  ) {
    issues.push("the ordered six-pose plan is incomplete");
  }
  const availableProductReferences = references.filter((reference) => {
    const role = String(reference.role || "");
    const isProduct = ![
      "style_reference",
      "model_identity",
      "approved_pose",
      "generated",
    ].includes(role);
    return isProduct &&
      Boolean(
        String(
          reference.storagePath ?? reference.storage_path ??
            reference.downloadUrl ?? reference.download_url ?? "",
        ).trim(),
      );
  });
  if (!availableProductReferences.length) {
    issues.push("authoritative product references are unavailable");
  }
  const availableRoles = new Set(
    availableProductReferences.map((reference) => String(reference.role || "")),
  );
  const requiredEvidence: Array<[string, string[]]> = [
    ["full saree front", ["saree_front_drape", "front"]],
    ["rear/back drape", ["saree_back_drape", "back"]],
  ];
  for (const [label, roles] of requiredEvidence) {
    if (!roles.some((role) => availableRoles.has(role))) {
      issues.push(`${label} reference is missing`);
    }
  }
  return issues;
}

export function assertSareeGenerationReady(session: unknown) {
  if (sareeAnalysisIssues(session).length) {
    throw new Error(SAREE_ANALYSIS_ERROR);
  }
}

const FORBIDDEN_HELD_OBJECT_CORE = String.raw`iced[-\s]?coffee|coffee|latte|matcha|boba|espresso|drinks?|beverages?|drinking\s+glass(?:es)?|tea[-\s]?(?:cup|mug|glass)s?|(?:coffee|tea|paper|plastic|takeaway|iced)[-\s]?cups?|mugs?|(?:water|plastic|drink|beverage|glass)[-\s]?bottles?(?!\s*green)|drinking\s+straws?|plastic\s+straws?|sipper\s+straws?|totes?|tote[-\s]?handles?|handbags?|shoulder[-\s]?bags?|sling[-\s]?bags?|backpacks?|wallets?|smartphones?|cell\s+phones?|phones?|sparklers?|fireworks?|handheld\s+props?|handheld\s+objects?|bags?|purses?|clutch(?:es)?|flowers?|bouquets?|diya[s]?|candles?|umbrellas?`;

export const FORBIDDEN_NON_EYEWEAR_HELD_OBJECT_PATTERN = new RegExp(`\\b(?:${FORBIDDEN_HELD_OBJECT_CORE})\\b`, "i");
export const FORBIDDEN_HELD_OBJECT_PATTERN = new RegExp(`\\b(?:${FORBIDDEN_HELD_OBJECT_CORE}|sunglass(?:es)?|eyewear|shades)\\b`, "i");

/** Handheld props a user can ask for in the product notes, grouped by what they are. */
const REQUESTABLE_PROP_GROUPS: ReadonlyArray<{ id: string; label: string; words: string }> = [
  { id: "drink", label: "the drink (cup or glass)", words: String.raw`iced[-\s]?coffee|coffee|latte|matcha|boba|espresso|drinks?|beverages?|cups?|mugs?|(?:coffee|drinking|water|juice|iced)\s+glass(?:es)?|glass(?:es)?\s+of` },
  { id: "bag", label: "the bag", words: String.raw`hand[-\s]?bags?|bags?|totes?|purses?|clutch(?:es)?|backpacks?` },
  { id: "sunglasses", label: "the sunglasses", words: String.raw`sun[-\s]?glass(?:es)?|eyewear` },
  { id: "phone", label: "the phone", words: String.raw`(?:smart|cell\s+)?phones?` },
  { id: "flowers", label: "the flowers", words: String.raw`flowers?|bouquets?` },
  { id: "umbrella", label: "the umbrella", words: String.raw`umbrellas?` },
];
const PROP_HOLD_VERB = /\b(?:hold|holds|holding|held|carry|carries|carrying|carried|sip|sips|sipping)\b/i;
// Hinglish: "haath mein coffee pakde hue", "coffee glass hold kare aur hand bag liye".
// "liye" holds only as "liye hue/ho/hai" ("ke liye" means "for"); "haath"/"hath mein" is "in hand".
const PROP_HINDI_HOLD = /\b(?:hold|pakad\w*|pakd\w*)\s+(?:karo|kare|karen|karein|kiya|kiye|karna|karke|kar|hue|huye|rakho|rakhe|rakhi)\b|(?<!\bk[eia]\s)\b(?:liye|liya)\s+(?:hue|huye|ho|hai|hain)\b|\bha+th\s+(?:mein|me|main)\b/i;
const PROP_IN_HAND = /\bin\s+(?:(?:her|his|their|one|the|a)\s+)?(?:(?:right|left)\s+)?hands?\b|\bon\s+(?:(?:her|his|their|the|one)\s+)?(?:(?:right|left)\s+)?shoulders?\b/i;
const PROP_ENGLISH_NEGATION = /\b(?:no|not|never|without|avoid|remove|exclude|don'?t|do\s+not)\b/i;
// Hindi negations only count in a Hinglish clause ("mat" is also an English word).
const PROP_HINDI_NEGATION = /\b(?:nahi|nahin|nhi|mat|na)\b/i;
const PROP_HINDI_MARKER = /\b(?:mein|aur|ke|ki|ka|hai|ho|bhi|sirf|karo|kare|karna|pakd\w*|liye|rakho|haath)\b/i;
// A prop word used as a colour, sleeve, shape or garment detail: "coffee brown", "cup sleeves",
// "umbrella shape", "bag-style pocket", "coffee table", "flowers printed on the border".
const PROP_AS_DESCRIPTOR = /^[\s-]*(?:brown|green|beige|black|white|red|blue|pink|gold|cream|grey|gray|colou?r(?:ed)?|shades?|tones?|hued?|sleeves?|cut|flare|hem|prints?|printed|motifs?|embroider\w*|butti|work|shape[sd]?|style[sd]?|pattern(?:ed)?|pockets?|table|stand|cover|frock|wal[ia]|ka|ki|dupatta|kurta|kurti|stole|saree|lehenga|of)\b/i;
const PROP_WINDOW_WORDS = 10;
const PROP_LIST_ITEM = /^(?:(?:and|or|plus|&)\s+)?(?:a|an|the|her|his|their|some|one)\b/i;

export type RequestedHandheldProps = {
  /** REQUESTABLE_PROP_GROUPS ids, e.g. ["drink", "bag"]. Empty when nothing is requested. */
  groups: string[];
  labels: string[];
  /** The requesting clauses from the notes, bounded. */
  note: string;
};

/**
 * Where a clause's held object sits: the words after an English holding verb, the whole clause
 * for Hinglish (object before and after the verb), or the clause around "in her hand". Empty
 * when the clause holds nothing. `start` is the window's offset in the clause.
 */
function propWindow(clause: string): { text: string; start: number; hindi: boolean; verbAt: number } | null {
  if (PROP_HINDI_HOLD.test(clause)) return { text: clause, start: 0, hindi: true, verbAt: -1 };
  const verb = clause.match(PROP_HOLD_VERB);
  if (verb && verb.index !== undefined) {
    const rest = clause.slice(verb.index + verb[0].length);
    const start = verb.index + verb[0].length + (rest.length - rest.trimStart().length);
    // One word past the window lets a trailing descriptor ("phone pocket") be seen.
    return { text: rest.trimStart().split(/\s+/).slice(0, PROP_WINDOW_WORDS + 1).join(" "), start, hindi: false, verbAt: verb.index };
  }
  return PROP_IN_HAND.test(clause) ? { text: clause, start: 0, hindi: false, verbAt: -1 } : null;
}

/**
 * Whether an English negation governs this prop: before the holding verb (within two words,
 * "do not hold a bag") or between the verb and the prop. "Without dupatta she holds a coffee
 * glass" still requests the drink. Clauses without a verb check everything before the prop.
 */
function propNegated(clause: string, held: { start: number; verbAt: number }, at: number): boolean {
  if (held.verbAt < 0) return PROP_ENGLISH_NEGATION.test(clause.slice(0, held.start + at));
  const beforeVerb = clause.slice(0, held.verbAt).trim().split(/\s+/).slice(-2).join(" ");
  return PROP_ENGLISH_NEGATION.test(beforeVerb) || PROP_ENGLISH_NEGATION.test(clause.slice(held.start, held.start + at));
}

/**
 * Props the product notes explicitly ask the model to hold or carry ("she holds a coffee
 * glass and a hand bag as in the reference image"). Each clause is read on its own: the prop
 * must follow a holding/carrying verb (or sit "in her hand"/"on her shoulder", or appear in a
 * Hinglish holding clause), an English negation before the prop or a Hindi negation in a
 * Hinglish clause cancels it, and a prop word used as a colour, sleeve, shape or garment
 * detail is not a prop. Requested props carry over from the STYLE REFERENCE; every other
 * handheld object stays excluded.
 */
export function requestedHandheldProps(notes: unknown): RequestedHandheldProps {
  const groups = new Set<string>();
  const kept: string[] = [];
  // A list after the verb spans commas ("holding a coffee cup, a tote bag and a phone"):
  // a clause right after a holding clause continues it when it starts like a list item.
  let continuesHold = false;
  for (const rawClause of String(notes ?? "").split(/([.;!?\n]+|,|\bbut\b)/i)) {
    const clause = rawClause.trim();
    if (rawClause === ",") continue;
    if (!clause || /^(?:[.;!?]+|but)$/i.test(clause)) {
      continuesHold = false;
      continue;
    }
    const hinglish = PROP_HINDI_MARKER.test(clause);
    if (hinglish && PROP_HINDI_NEGATION.test(clause)) {
      continuesHold = false;
      continue;
    }
    const own = propWindow(clause);
    const held: { text: string; start: number; hindi: boolean; verbAt: number } | null = own ?? (continuesHold && PROP_LIST_ITEM.test(clause) ? { text: clause, start: 0, hindi: false, verbAt: -1 } : null);
    continuesHold = Boolean(held);
    if (!held) continue;
    let matched = false;
    for (const group of REQUESTABLE_PROP_GROUPS) {
      for (const match of held.text.matchAll(new RegExp(`\\b(?:${group.words})\\b`, "gi"))) {
        const at = match.index ?? 0;
        if (PROP_AS_DESCRIPTOR.test(held.text.slice(at + match[0].length))) continue;
        // "no sunglasses", "do not hold a bag": an English negation before this prop cancels it.
        if (propNegated(clause, held, at)) continue;
        groups.add(group.id);
        matched = true;
        break;
      }
    }
    if (matched) kept.push(clause);
  }
  const ordered = REQUESTABLE_PROP_GROUPS.filter((group) => groups.has(group.id));
  return {
    groups: ordered.map((group) => group.id),
    labels: ordered.map((group) => group.label),
    note: kept.join(". ").replace(/\s+/g, " ").slice(0, 300),
  };
}

/** The words naming a requested group (requestedHandheldProps ids), for prompt rewrites. */
export function requestedPropWords(groups: readonly string[]): string {
  return REQUESTABLE_PROP_GROUPS.filter((group) => groups.includes(group.id)).map((group) => group.words).join("|");
}

// The fixed "never copy handheld props" phrasings used across the image prompt, QA, the
// analysis prompt and reference labels, rewritten to exclude only unrequested props.
// Fixed phrases only: free-form clauses (product truth, absence locks) are never touched.
const GENERIC_PROP_BANS: ReadonlyArray<[RegExp, string]> = [
  [/handheld coffee cups\/totes\/bags/g, "unrequested handheld props"],
  [/handheld coffee\/bags/g, "unrequested handheld props"],
  [/no handheld coffee\/bag\/sunglasses copied from style reference/g, "no unrequested handheld props copied from style reference"],
  [/without copied drinks\/bags\/phones/g, "carrying only the requested props"],
  [/\(coffee cups, mugs, bottles, tote bags, handbags, sunglasses, phones\)/g, "(any prop the product notes did not request)"],
  [/a coffee cup, tote bag, sunglass case, or leaning stance/g, "an unrequested prop or a leaning stance"],
  [/a coffee cup, tote bag, or sunglass case/g, "an unrequested prop"],
  [/coffee cups, or tote bags from the style reference/g, "unrequested props from the style reference"],
  [/\(no leaning posture, cups, totes, or sunglasses\)/g, "(no leaning posture or unrequested props)"],
  [/leaning\/sitting posture, cups, totes, and sunglasses/g, "leaning/sitting posture and unrequested props"],
  [/\((?:cups, totes, sunglasses|cups, totes, phones, sunglasses|cups, totes, sunglasses, bags|sunglasses, coffee cups, or tote bags)\)/g, "(unrequested props)"],
  [/\((?:coffee cup, tote bag, handbag, sunglasses|such as iced coffee cups, drinks, tote bags, purses, phones, or sunglasses)\)/g, "(other than the requested props)"],
  [/coffee cups, tote bags, or accessories/g, "unrequested props, or accessories"],
  [/sunglasses, coffee cup, tote bag, or clothing/g, "unrequested props, or clothing"],
  [/style-reference coffee cups, tote bags, sunglasses, or dead-hanging/g, "unrequested style-reference props, or dead-hanging"],
  [/never copy any coffee cup\/tote bag or objects in the hands/g, "never copy unrequested props"],
  [/style-reference bags, cups, or objects excluded/g, "other style-reference objects excluded"],
  [/holding nothing copied from the style or model photo/g, "holding only the requested props"],
  [/belt, bag, hair ornament or any other accessory this plan does not list/g, "belt, hair ornament or any other accessory this plan or the requested props do not list"],
  [/(?<!unrequested )\b([Oo])bjects (in the hands|held in the style or model photo)\b/g, "$1bjects $2 other than the requested props"],
  [/(?<!unrequested )\bhandheld (props|objects)\b/g, "unrequested handheld $1"],
];

// What may trail a bare prop that continues a negated list: nothing, or a qualifier of the whole list.
const NEGATED_LIST_QUALIFIER = /^(?:\s+(?:is|are))?(?:\s+(?:included|provided|supplied|copied|added|allowed))?(?:\s+(?:with|in|from|by)\s+(?:the\s+)?(?:sku|product|set|style\s+reference|reference))?\s*$/i;

/** Prompt text with the fixed no-props phrasings narrowed to unrequested props. Unchanged when nothing is requested. */
export function withRequestedPropsAllowed(text: string, requested: Pick<RequestedHandheldProps, "groups">): string {
  if (!requested.groups.length) return text;
  let out = text;
  for (const [pattern, replacement] of GENERIC_PROP_BANS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * A styling list ("no tote, no coffee cup, no sunglasses") without the entries that
 * exclude a requested prop. Whole comma/semicolon entries that start with a negation are
 * dropped, and so is a bare prop that continues a negated comma list ("no dupatta, belt, bag
 * included with SKU"): it must follow a kept short entry of that list directly, and only a
 * list-level qualifier ("included with SKU") may trail it, which moves to the entry before.
 * A prop with a placement ("tote bag on shoulder") is never a continuation. Every other
 * entry is kept verbatim.
 */
export function withoutNegatedRequestedProps(text: unknown, requested: Pick<RequestedHandheldProps, "groups">): string {
  const value = String(text ?? "");
  if (!requested.groups.length) return value;
  const words = requestedPropWords(requested.groups);
  // An optional lead-in ("none - no tote") survives on the next kept entry.
  const negated = new RegExp(`^(\\s*(?:none\\s*[-:]\\s*)?)(?:-\\s*)?(?:no|never|without)\\s+(?:[a-z-]+\\s+){0,2}(?:${words})\\b`, "i");
  const startsNegated = /^\s*(?:none\s*[-:]\s*)?(?:-\s*)?(?:no|never|without)\b/i;
  const listedProp = new RegExp(`^\\s*(?:(?:a|an|the|any)\\s+)?(?:${words})(?:\\s+(?:${words}))*\\b(.*)$`, "i");
  const parts = value.split(/([,;])/);
  const kept: string[] = [];
  // The separator before the first dropped entry of a run is the one the next kept entry inherits; ";" outranks ",".
  let pendingSeparator: string | undefined;
  let leadIn = "";
  let negatedList = false;
  let afterNegatedDrop = false;
  for (let index = 0; index < parts.length; index += 2) {
    const separator = parts[index - 1];
    if (separator === ";") negatedList = false;
    const negation = parts[index].match(negated);
    // "no bag-style pocket" or "no coffee brown tones" constrains the garment, not the prop ("no bag of any kind" stays a prop).
    const tail = negation ? parts[index].slice(negation[0].length) : "";
    const dropped = negation && !(PROP_AS_DESCRIPTOR.test(tail) && !/^\s*of\b/i.test(tail)) ? negation : null;
    if (dropped) {
      pendingSeparator = pendingSeparator === ";" || separator === ";" ? ";" : pendingSeparator ?? separator;
      leadIn ||= dropped[1].trim() ? `${dropped[1].trim()} ` : "";
      negatedList = true;
      afterNegatedDrop = true;
      continue;
    }
    const listed = negatedList && !afterNegatedDrop && separator === "," && kept.length ? parts[index].match(listedProp) : null;
    if (listed && NEGATED_LIST_QUALIFIER.test(listed[1])) {
      const rest = listed[1].trimEnd();
      if (rest) kept[kept.length - 1] = `${kept[kept.length - 1].trimEnd()}${rest}`;
      continue;
    }
    afterNegatedDrop = false;
    // A kept positive entry longer than a bare item ("silver bangles on wrist") ends the negated list.
    if (startsNegated.test(parts[index])) negatedList = true;
    else if (parts[index].trim().split(/\s+/).length > 3) negatedList = false;
    const entry = leadIn ? `${kept.length ? " " : ""}${leadIn}${parts[index].trimStart()}` : parts[index];
    const joiner = pendingSeparator === ";" || separator === ";" ? ";" : pendingSeparator ?? separator ?? ",";
    kept.push(kept.length ? `${joiner}${entry}` : entry.trimStart());
    pendingSeparator = undefined;
    leadIn = "";
  }
  // A lead-in with nothing left after it ("none - ") is dropped, so callers can fall back.
  return kept.join("").trim();
}

export function sanitizeHeldObjectText(value: unknown, replacement: string, allowNotes = ""): string {
  const raw = String(value ?? "");
  if (!raw || !FORBIDDEN_HELD_OBJECT_PATTERN.test(raw)) return raw;
  const allowLower = allowNotes.toLowerCase();
  const clauses = raw.split(/(?<=[.!;])\s+/);
  const kept = clauses.filter((clause) => {
    const match = clause.match(FORBIDDEN_HELD_OBJECT_PATTERN);
    if (!match) return true;
    const token = match[0].toLowerCase().trim();
    return Boolean(token && allowLower && allowLower.includes(token));
  });
  return kept.join(" ").trim() || replacement;
}

export function normalizeAnalysis(
  raw: JsonRecord,
  categoryFallback: string,
  options: {
    bottomWearMode?: unknown;
    skuName?: string;
    productDetails?: string;
    modelDirection?: string;
    /** A dedicated bottom-wear reference was uploaded (feeds the Farshi guard like compilePosePrompt). */
    hasBottomReference?: boolean;
    /** FastAPI /api/v1/plan response, merged over the local plan and re-checked against the hard guards. */
    posePlanningOverride?: unknown;
  } = {},
) {
  const product = objectValue(raw.productIdentity ?? raw.product_identity);
  const creative = objectValue(raw.creativeDirection ?? raw.creative_direction);
  const model = objectValue(raw.modelIdentity ?? raw.model_identity);
  const rawPoseValue = raw.posePlan ?? raw.pose_plan;
  const rawPoses = Array.isArray(rawPoseValue) ? (rawPoseValue as unknown[]) : [];
  
  const sareeTruthRaw = objectValue(
    raw.sareeTruth ??
      raw.saree_truth ??
      product.sareeTruth ??
      product.saree_truth,
  );
  const sareeDrapePlanRaw = objectValue(
    raw.sareeDrapePlan ??
      raw.saree_drape_plan ??
      product.sareeDrapePlan ??
      product.saree_drape_plan,
  );
  const sareeTruth = normalizeSareeTruth(sareeTruthRaw);
  const sareeDrapePlan = normalizeSareeDrapePlan(sareeDrapePlanRaw);
  const normalizedGarmentEvidence = garmentEvidence(product);

  const productIdentity: ProductIdentityProfile = {
    garmentFamily: stringValue(product.garmentFamily ?? product.garment_family, "unknown"),
    category: stringValue(product.category, categoryFallback),
    mainColor: stringValue(product.mainColor ?? product.main_color),
    secondaryColors: stringArray(product.secondaryColors ?? product.secondary_colors),
    fabric: stringValue(product.fabric), pattern: stringValue(product.pattern), print: stringValue(product.print),
    patternGeometry: patternGeometry(product),
    embroideryGeometry: embroideryGeometry(product),
    texture: stringValue(product.texture), neckline: stringValue(product.neckline),
    sleeveType: stringValue(product.sleeveType ?? product.sleeve_type), length: stringValue(product.length),
    fit: stringValue(product.fit), silhouette: stringValue(product.silhouette),
    frontConstruction: stringValue(product.frontConstruction ?? product.front_construction),
    backConstruction: stringValue(product.backConstruction ?? product.back_construction),
    buttons: stringValue(product.buttons), zippers: stringValue(product.zippers), pockets: stringValue(product.pockets),
    embroidery: stringValue(product.embroidery), logos: stringValue(product.logos),
    accessoriesIncluded: stringValue(product.accessoriesIncluded ?? product.accessories_included),
    bottomWearDetails: bottomWearDetailsValue(product.bottomWearDetails ?? product.bottom_wear_details),
    footwearDetails: stringValue(product.footwearDetails ?? product.footwear_details),
    detailPlacementMap: sanitizeDetailPlacementMap(product.detailPlacementMap ?? product.detail_placement_map, normalizedGarmentEvidence),
    absenceConstraints: stringArray(product.absenceConstraints ?? product.absence_constraints),
    invariantDetails: stringArray(product.invariantDetails ?? product.invariant_details),
    uncertaintyNotes: stringArray(product.uncertaintyNotes ?? product.uncertainty_notes),
    garmentEvidence: normalizedGarmentEvidence,
    sareeTruth,
    sareeDrapePlan,
  };
  const allowPropNotes = [options.skuName, options.productDetails].filter(Boolean).join(" ");
  const creativeDirection = {
    backgroundStyle: stringValue(creative.backgroundStyle ?? creative.background_style, "Clean premium catalog background"),
    studioEnvironment: stringValue(creative.studioEnvironment ?? creative.studio_environment, "Professional fashion shoot environment"),
    lighting: stringValue(creative.lighting, "Soft commercial fashion lighting"),
    cameraPerspective: stringValue(creative.cameraPerspective ?? creative.camera_perspective, "Eye-level fashion perspective"),
    composition: stringValue(creative.composition, "Product-first balanced composition"),
    framing: stringValue(creative.framing, "3:4 portrait framing"),
    mood: stringValue(creative.mood, "Premium, playful, and youthful Gen-Z energy"),
    colorTreatment: stringValue(creative.colorTreatment ?? creative.color_treatment, "Natural product-accurate color"),
    modelStyling: stringValue(creative.modelStyling ?? creative.model_styling, "Minimal styling that does not obscure the product"),
    photographyStyle: stringValue(creative.photographyStyle ?? creative.photography_style, "Commercial fashion photography"),
    propUsage: sanitizeHeldObjectText(
      stringValue(creative.propUsage ?? creative.prop_usage, "No distracting props"),
      "No handheld props; style-reference bags, cups, or objects excluded",
      allowPropNotes,
    ),
    shadowStyle: stringValue(creative.shadowStyle ?? creative.shadow_style, "Natural contact shadows"),
    editorialCommercialFeel: stringValue(creative.editorialCommercialFeel ?? creative.editorial_commercial_feel, "Premium e-commerce editorial"),
    lensAndCamera: stringValue(creative.lensAndCamera ?? creative.lens_and_camera, "One consistent full-frame fashion-camera perspective and natural lens rendering"),
    setContinuity: stringValue(creative.setContinuity ?? creative.set_continuity, "One real shoot day: identical set, time of day, light direction, white balance, exposure, and color grade"),
    realismRules: stringValue(
      creative.realismRules ?? creative.realism_rules,
      "Natural skin texture with visible pores and subtle micro-imperfections, anatomically correct and naturally shaped eyes and teeth, anatomically correct hands, realistic fabric physics, optical depth, and no synthetic AI artifacts such as waxy/airbrushed skin, doll-like symmetry, or warped features",
    ),
    suggestedAccessories: stringValue(
      creative.suggestedAccessories ?? creative.suggested_accessories,
      "No additional accessory needed - style with only what the product references show",
    ),
    seatedPoseRequired: stylePhotoSittingReason(creative.seatedPoseReason ?? creative.seated_pose_reason)
      ? "no"
      : normalizeYesNoFlag(creative.seatedPoseRequired ?? creative.seated_pose_required, "no"),
    seatedPoseReason: stylePhotoSittingReason(creative.seatedPoseReason ?? creative.seated_pose_reason)
      ? "The style photo's pose is not a sitting request."
      : stringValue(creative.seatedPoseReason ?? creative.seated_pose_reason, ""),
    closeupMode: normalizeCloseupMode(creative.closeupMode ?? creative.closeup_mode),
    closeupHeroDetail: stringValue(creative.closeupHeroDetail ?? creative.closeup_hero_detail, ""),
    showcaseIntent: normalizeShowcaseIntent(creative.showcaseIntent ?? creative.showcase_intent),
    showcasePlan: normalizeShowcasePlan(
      raw.showcasePlan ?? raw.showcase_plan ?? creative.showcasePlan ?? creative.showcase_plan,
    ),
  };
  const requestedCastingFallback = options.modelDirection && String(options.modelDirection).trim()
    ? `${String(options.modelDirection).trim()} adult fashion model with a naturally warm, approachable face and realistic skin texture`
    : "One consistent adult fashion model across every image in the set, reading as a youthful young adult with a naturally pretty, warm, approachable face";
  const modelIdentity = {
    castingDirection: stringValue(model.castingDirection ?? model.casting_direction, requestedCastingFallback),
    face: stringValue(model.face, "Keep the exact same recognizable face across the complete set - identical face shape, eyes, eyebrows, nose, lips, and jawline as established in Pose 1"),
    faceRealism: stringValue(
      model.faceRealism ?? model.face_realism,
      "Photorealistic human face: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry (not mirror-symmetric), eyes as the identity photo shows them, including a cover, and naturally aligned teeth (not uniformly perfect, no extra or missing teeth). Never plastic, waxy, airbrushed, doll-like, or synthetic-looking.",
    ),
    hair: stringValue(model.hair, "Keep one hairstyle across the complete set"),
    makeup: stringValue(model.makeup, "Keep makeup consistent and natural"),
    bodyProportions: stringValue(model.bodyProportions ?? model.body_proportions, "Keep realistic body proportions identical across poses"),
    stylingLock: stringValue(model.stylingLock ?? model.styling_lock, "Keep footwear and accessories identical across every pose"),
  };
  const poses = Array.isArray(rawPoses) ? rawPoses : [];
  // Raw analysis carries referencePose/expressionPlan at the root; a cached
  // normalized payload carries them inside posePlanning (re-checked, idempotent).
  const rawPlanning = objectValue(raw.posePlanning ?? raw.pose_planning);
  const rawReferencePose = raw.referencePose ?? raw.reference_pose ?? rawPlanning.referencePose;
  const rawExpressionPlan = raw.expressionPlan ?? raw.expression_plan ?? rawPlanning.expressionPlan;
  // Analyses from before v36 carry neither field: they keep today's poses and
  // expressions exactly, with no invented plan.
  const planned = Boolean(rawReferencePose || rawExpressionPlan);
  if (planned) {
    // v38: Pose 6 is the product-highlight close-up, resolved against Pose 5 before anything reads the plan.
    const family = poseFamilyFor({
      productIdentity,
      garmentFamily: productIdentity.garmentFamily,
      category: productIdentity.category || categoryFallback,
      skuName: options.skuName,
      productDetails: options.productDetails,
    });
    creativeDirection.showcasePlan = productHighlightPlan({
      plan: creativeDirection.showcasePlan,
      closeupHeroDetail: creativeDirection.closeupHeroDetail,
      productIdentity,
      includesBottomWear: showcaseIncludesBottomWearFor(family, { ...options, productIdentity }),
      isSaree: isSareePoseFamily(family),
    });
  }
  const planningContext = posePlanningContextFor({ productIdentity, creativeDirection }, {
    categoryFallback,
    bottomWearMode: options.bottomWearMode,
    skuName: options.skuName,
    productDetails: options.productDetails,
    hasBottomReference: options.hasBottomReference,
  });
  const localPlanning = planned
    ? normalizePosePlanning({
      ...rawPlanning,
      referencePose: rawReferencePose,
      expressionPlan: rawExpressionPlan,
    }, planningContext, (value) => sanitizeHeldObjectText(value, ""))
    : undefined;
  const posePlanning = localPlanning && options.posePlanningOverride
    ? mergeGraphPosePlanning(localPlanning, options.posePlanningOverride, planningContext)
    : localPlanning;
  const poseContext: PoseSlotContext = {
    productIdentity,
    garmentFamily: productIdentity.garmentFamily,
    category: productIdentity.category || categoryFallback,
    bottomWearMode: options.bottomWearMode,
    showcasePlan: creativeDirection.showcasePlan,
    closeupHeroDetail: creativeDirection.closeupHeroDetail,
    skuName: options.skuName,
    productDetails: options.productDetails,
    posePlanning,
  };
  const poseSlots = getPoseSlots(poseContext);
  const showcaseIncludesBottomWear = showcaseIncludesBottomWearFor(poseFamilyFor(poseContext), {
    ...options,
    productIdentity,
  });
  const posePlan: StudioPose[] = poseSlots.map((fallback, index) => {
    const candidate = objectValue(poses.find((pose) => objectValue(pose).id === fallback.id) ?? poses[index]);
    // An adopted Pose 4/6 takes its body position from the pose plan, so the
    // stored gating and the pose text always agree. Held props stay scrubbed.
    const adopted = adoptedSlot(posePlanning, fallback.id);
    // An adopted Pose 4 is shot as the STYLE REFERENCE is shot, whatever camera the model wrote.
    const referenceCamera = Boolean(adopted && fallback.id === "creative" && posePlanning?.referencePose.cameraAngle);
    return {
      id: fallback.id, title: posePlanning ? fallback.title : stringValue(candidate.title ?? candidate.name, fallback.title),
      description: sanitizeHeldObjectText(stringValue(candidate.description, fallback.description), fallback.description, allowPropNotes),
      cameraAngle: referenceCamera ? fallback.cameraAngle : stringValue(candidate.cameraAngle ?? candidate.camera_angle, fallback.cameraAngle),
      framing: referenceCamera ? fallback.framing : stringValue(candidate.framing, fallback.framing),
      bodyPosition: adopted ? fallback.bodyPosition : stringValue(candidate.bodyPosition ?? candidate.body_position, fallback.bodyPosition),
      handPlacement: sanitizeHeldObjectText(
        stringValue(candidate.handPlacement ?? candidate.hand_placement, fallback.handPlacement),
        fallback.handPlacement,
        allowPropNotes,
      ),
      expression: stringValue(candidate.expression, fallback.expression),
      highlightedDetails: stringArray(candidate.highlightedDetails ?? candidate.highlighted_details, [...fallback.highlightedDetails]),
      productVisibilityRules: stringArray(candidate.productVisibilityRules ?? candidate.product_visibility_rules, [...fallback.productVisibilityRules]),
      primaryReference: stringValue(candidate.primaryReference ?? candidate.primary_reference, fallback.primaryReference),
      purpose: stringValue(candidate.purpose, fallback.purpose),
      consistencyNotes: stringValue(candidate.consistencyNotes ?? candidate.consistency_notes, fallback.consistencyNotes),
      prompt: sanitizeHeldObjectText(stringValue(candidate.prompt, fallback.prompt), fallback.prompt, allowPropNotes),
      enabled: candidate.enabled !== false,
    };
  }).map((pose) => {
    // The model writes the prose for all six frames, but the sixth frame's
    // guarantees come from showcasePlan and the garment's verified details.
    // Its own pose entry may elaborate; it may not quietly drop the chosen
    // subject, the non-duplication rule, the widened framing, or the aesthetic
    // photoshoot direction, which is how it became a hero repeat before.
    if (pose.id !== "showcase") return pose;
    const fallbackShowcase = poseSlots[poseSlots.length - 1];
    const showcaseShot = effectiveShowcaseShot(creativeDirection, { includesBottomWear: showcaseIncludesBottomWear });
    // A bottom-led plan is not valid for this shoot. Discard its pose prose as
    // well as the plan-derived brief so model-supplied palazzo/bottom direction
    // cannot leak back into an explicitly top-only normalization.
    if (creativeDirection.showcasePlan && !showcaseShot) {
      creativeDirection.showcasePlan = null;
      return fallbackShowcase;
    }
    const planRules = fallbackShowcase.productVisibilityRules;
    const mergedRules = [...planRules];
    for (const rule of pose.productVisibilityRules) {
      if (!mergedRules.some((existing) => existing.toLowerCase() === rule.toLowerCase())) mergedRules.push(rule);
    }
    const mergedHighlights = [...fallbackShowcase.highlightedDetails];
    for (const item of pose.highlightedDetails) {
      if (!mergedHighlights.some((existing) => existing.toLowerCase() === item.toLowerCase())) mergedHighlights.push(item);
    }
    if (!creativeDirection.showcasePlan) {
      return {
        ...pose,
        highlightedDetails: mergedHighlights.slice(0, 8),
        productVisibilityRules: mergedRules.slice(0, 12),
        enabled: true,
      };
    }
    if (creativeDirection.showcasePlan.productHighlight) {
      // The model may have written a full-body Pose 6; the close-up brief, crop and prompt always win.
      return {
        ...fallbackShowcase,
        expression: pose.expression,
        highlightedDetails: mergedHighlights.slice(0, 8),
        productVisibilityRules: planRules.slice(0, 12),
        enabled: true,
      };
    }
    const widened = Boolean(showcaseShot?.widenedFromCloseup);
    const heroFeatureLower = creativeDirection.showcasePlan.heroFeature.toLowerCase();
    const nextFraming = widened ? fallbackShowcase.framing : pose.framing;
    const nextCameraAngle = widened ? fallbackShowcase.cameraAngle : pose.cameraAngle;
    const nextBodyPosition = widened ? fallbackShowcase.bodyPosition : pose.bodyPosition;
    const nextDescription = pose.description.toLowerCase().includes(heroFeatureLower)
      ? pose.description
      : `${fallbackShowcase.description} ${pose.description}`.trim();
    const nextPrompt = widened
      ? fallbackShowcase.prompt
      : pose.prompt.toLowerCase().includes(heroFeatureLower)
        ? pose.prompt
        : `${pose.prompt.replace(/\.?\s*$/, ".")} ${fallbackShowcase.prompt}`.trim();
    return {
      ...pose,
      framing: nextFraming,
      cameraAngle: nextCameraAngle,
      bodyPosition: nextBodyPosition,
      description: nextDescription,
      highlightedDetails: mergedHighlights.slice(0, 8),
      productVisibilityRules: mergedRules.slice(0, 12),
      prompt: nextPrompt,
      enabled: true,
    };
  }).map((pose, index) => {
    if (!posePlanning) return pose;
    const adopted = adoptedSlot(posePlanning, pose.id);
    // A product-led Pose 4/6 falls back to its template wherever the model wrote the reference
    // posture. Checked after the showcase merge, so a second normalization changes nothing.
    const productLed = !adopted && (pose.id === "creative" || pose.id === "showcase") &&
      posePlanning.referencePose.posture !== "none";
    const plain = (field: "title" | "description" | "framing" | "bodyPosition" | "prompt") =>
      productLed && REFERENCE_POSTURE_PROSE.test(pose[field]) ? poseSlots[index][field] : pose[field];
    return {
      ...pose,
      title: plain("title"),
      description: plain("description"),
      framing: plain("framing"),
      bodyPosition: plain("bodyPosition"),
      // After the showcase merge: its plan brief may already carry the directive.
      prompt: adopted && !pose.prompt.includes(adopted.directive)
        ? `${pose.prompt.replace(/\.?\s*$/, ".")} ${adopted.directive}`
        : plain("prompt"),
      expression: posePlanning.expressions[pose.id] || pose.expression,
      attitude: posePlanning.expressionPlan.attitude,
      ...(adopted ? { referencePosture: adopted.posture } : {}),
    };
  });
  const stylingPlan = normalizeStylingPlan(raw.stylingPlan ?? raw.styling_plan);
  return { productIdentity, creativeDirection, modelIdentity, stylingPlan, posePlan, ...(posePlanning ? { posePlanning } : {}) };
}

export function buildCombinedAnalysisPrompt(args: {
  skuName: string; productDetails: string; category: string; modelDirection: string; sceneDirection: string;
  referenceManifest: Array<{ number: number; role: string }>; housePreferences?: string; fashionKnowledge?: string;
  analysisLearning?: string; showcaseFeedback?: string; hasModelReference?: boolean; useStyleAsModelFace?: boolean;
  /** When given, the STYLE REFERENCE image is not attached; this cached text profile stands in for it. */
  cachedStyleProfile?: StyleReferenceProfile;
}) {
  const hasExplicitModelRef = Boolean(args.hasModelReference) || args.referenceManifest.some((item) => /^MODEL FACE REFERENCE\b/i.test(item.role) || item.role === "model_identity");
  const useStyleAsModelFace = !hasExplicitModelRef && Boolean(args.useStyleAsModelFace);
  const manifest = args.referenceManifest.map(({ number, role }) => `IMAGE ${number}: ${role}`).join("\n");
  // Bounded: the profile fields are already capped when the profile is built.
  const cachedStyleBlock = args.cachedStyleProfile
    ? `
CACHED STYLE PROFILE - the STYLE REFERENCE image is NOT attached to this request. It was analysed earlier and is summarised below as text. Wherever these instructions mention the STYLE REFERENCE, use this profile and plan exactly as if you were looking at that image. Copy only its creativeDirection fields (backdrop, room, lighting, camera, mood, set continuity) verbatim into your creativeDirection, plan framing, composition and propUsage fresh for THIS product, and copy its referencePose fields verbatim into referencePose; judge suitableForProduct, suitabilityReason, Pose 4, Pose 6 and expressionPlan afresh for THIS product.
${JSON.stringify({
      // Suitability was judged for an earlier product, so it is re-judged here.
      // referencePose leads so the (larger) room fields are what a cap would cut.
      referencePose: { ...args.cachedStyleProfile.referencePose, suitableForProduct: undefined, suitabilityReason: undefined },
      stylingTaste: args.cachedStyleProfile.stylingTaste,
      creativeDirection: args.cachedStyleProfile.creativeDirection,
    }).slice(0, 9000)}
`
    : "";
  const positiveNotes = [
    positiveBottomWearPortion(args.skuName),
    positiveBottomWearPortion(args.productDetails),
  ].filter(Boolean).join(" ");
  const hasExplicitFarshiNotes = /\b(?:farshi|farsi|fasi)\b/i.test(positiveNotes);
  const isFarshiSku = hasExplicitFarshiNotes;
  const analysisPrompt = `You are the visual merchandiser and shoot planner for a fashion e-commerce studio.

Analyze EVERY supplied image before answering.
${manifest}
${cachedStyleBlock}
REFERENCE AUTHORITY (highest to lowest):
1. MODEL FACE REFERENCE (if supplied) - the exact, non-negotiable face and identity for the model. Overrides any face you would otherwise design.
2. Region-specific SAREE PRODUCT references (when supplied) - FULL FRONT DRAPE, REAR/BACK DRAPE, BODY/WEAVE DETAIL, FULLY SPREAD PALLU, BORDER/TASSELS and BLOUSE references are each authoritative for their named physical region. A pallu-spread image is pallu truth, never a generic fabric image.
3. FRONT PRODUCT - legacy authoritative front product design.
4. BACK PRODUCT - legacy authoritative back design; never infer the back from the front.
5. FABRIC / PATTERN DETAIL - legacy high-priority truth for UPPER-garment weave, texture, print, embroidery, stitching, trims, and construction; it does not prove pallu artwork and does not prove bottom-wear print unless the image itself shows the trousers/skirt.
6. MANNEQUIN / FLAT-LAY / DUPATTA SHOT - on a mannequin or dress form, authoritative for worn shape, fit, proportion and drape; laid flat or folded (such as a dupatta, stole, or garment piece), authoritative for piece identity, colour gradient/ombré, border/gota trim, construction, panel layout and length. Inspect this slot carefully for a dupatta, stole, scarf, or shawl packaged with the SKU!
7. BOTTOM WEAR / FARSHI - when supplied, pixel-level authority for the trousers/skirt cut, volume, hem, color and print. Never copy upper-garment embroidery onto this panel.
8. ADDITIONAL PRODUCT - another source of product truth, including supporting bottom-wear or included dupatta/stole evidence.
9. STYLE REFERENCE - creative direction only. From the style reference, take the photoshoot backdrop, wall, floor, and lighting for all six poses. Record that person's body posture in referencePose; it is copied only into Pose 4 as REFERENCE POSE & EXPRESSION PLAN directs, never into Poses 1, 2, 3, 5 or 6. Never copy that photo's framing into creativeDirection, and never copy its handheld props (sunglasses, coffee cups, or tote bags) into any pose or creativeDirection. ${useStyleAsModelFace ? "Because the user uploaded this same image as MODEL FACE REFERENCE, take the model face from this image for all six poses." : "Take the model face from a dedicated MODEL FACE REFERENCE only when one is supplied; when no MODEL FACE REFERENCE is supplied, discard that person's face, hair, and objects in their hands (coffee cup, tote bag, handbag, sunglasses), and cast a fresh photorealistic model matching Requested model direction."} ABSOLUTE PROHIBITION ON COPYING THE PRODUCT FROM THE STYLE REFERENCE: The clothing, outfit, saree, dress, fabric, color, prints, or embroidery worn by the person in the style reference MUST BE 100% DISCARDED. Absolutely DO NOT copy, reproduce, or borrow the style reference's clothing. The product itself must stay based exclusively on uploaded product images and must not be redesigned. Never copy its garment, product color, bottoms, logos, coffee cups, tote bags, or accessories.

Product references are frequently flat-lay, folded, pinned, or shot on a mannequin or dress form. Read the garment through that presentation: infer how each panel, hem, sleeve and closure behaves once it is worn on a live human body, and record that in the profile. The mannequin, dress form, hanger, clips, pins and the flat surface are photography apparatus, never part of the product - never describe them as garment features and never copy a mannequin's stiff straight arms, splayed plastic fingers, strapless bare chest wrap, or neck cutoff onto the human model.

First, determine the garmentFamily from the references: "kurta_or_kurti_set", "saree", "dress", "western_or_casual", or "other".

SKU: ${args.skuName}
Declared category: ${args.category}
User product notes: ${args.productDetails}${(() => {
  const props = requestedHandheldProps(args.productDetails);
  return props.groups.length
    ? `
PROPS REQUESTED IN THE PRODUCT NOTES: "${props.note}". ${args.cachedStyleProfile || args.referenceManifest.some((item) => /STYLE REFERENCE|^style_reference$/i.test(item.role))
      ? `The user wants ${props.labels.join(" and ")} carried over from the STYLE REFERENCE. Name them in stylingPlan.ornaments as that image shows them`
      : `The user wants ${props.labels.join(" and ")}; no style reference is attached, so name them in stylingPlan.ornaments as the notes describe them`}, plan handPlacement so a visible hand holds or carries them in every frame except the Pose 5 craft crop, and never exclude them anywhere in the plan. All other handheld objects stay excluded.`
    : "";
})()}
Requested model direction: ${args.modelDirection || "one consistent professional adult fashion model"}
Requested scene direction: ${args.sceneDirection || "derive one consistent commercial scene from style references"}

PRINT AND EMBROIDERY GEOMETRY - the part that decides whether the output is this SKU or a lookalike. A sentence like "pink bandhani print with gold embroidery" is not enough to rebuild a garment, so measure the geometry from the highest-resolution image available (normally FABRIC / PATTERN DETAIL for the UPPER garment only) and fill patternGeometry and embroideryGeometry concretely:
- patternGeometry.scale: motif size relative to a body landmark, e.g. "each bandhani dot cluster is roughly 8-10 mm, about one fingernail width; the diagonal band repeats about every 4 cm".
- patternGeometry.orientation and repeat: the direction bands or motifs run (vertical, diagonal at roughly 45 degrees, chevron, mirrored at the centre front) and how often the unit repeats.
- patternGeometry.density: how much ground fabric shows between motifs.
- patternGeometry.placementByPanel: one entry per panel - body front, body back, sleeves, yoke, bottom wear, dupatta - stating how the pattern sits on that panel, because sleeves and body frequently differ. FABRIC / PATTERN DETAIL often shows only kurta/upper embroidery or a small swatch - NEVER copy that scale, density, or motif inventory onto the bottom wear. Read bottom-wear print from FRONT, BACK, MANNEQUIN, ADDITIONAL, and BOTTOM WEAR images where the trousers/skirt are actually visible.
- patternGeometry.accentColors: the small secondary colours inside the print that are easy to lose, e.g. "orange and yellow dots inside the pink bandhani field".
- patternGeometry.motifInventory: name each distinct motif shape once.
- embroideryGeometry.geometry and motifStructure: the actual internal construction, e.g. "square yoke panel of nested diamond lattice, each diamond about 2 cm, filled with a single floral sprig, bordered by a double scalloped gold line".
- embroideryGeometry.scaleRelativeToGarment: how far the embroidery extends, e.g. "yoke covers from the neckline to roughly 20 percent of the kurta length, shoulder seam to shoulder seam".
- embroideryGeometry.necklineRelation: exactly how the embroidery meets the neckline and where any tie, drawstring or tassel sits relative to it.
Anything you genuinely cannot measure goes in uncertaintyNotes - never guess a geometry.

BOTTOM WEAR ARCHITECTURE, SILHOUETTE & PRINT (MANDATORY FOR SUITS, SETS, & CO-ORDS):
When the product is a multi-piece outfit (kurti/kurta set, salwar suit, co-ord set, lehenga, Indo-western), the customer buys the complete set and expects the EXACT bottom wear cut, silhouette, color, and pattern shown in the product references. NEVER gloss over bottom wear with generic words like "matching pants". You MUST inspect the bottom wear in FRONT PRODUCT, BACK PRODUCT, MANNEQUIN / FLAT-LAY, ADDITIONAL PRODUCT, and BOTTOM WEAR / FARSHI references (if supplied) and record an exhaustive, specific specification in 'productIdentity.bottomWearDetails'. FABRIC / PATTERN DETAIL is NOT authority for bottoms unless that image itself shows the trousers/skirt.
${isFarshiSku ? `
AUTHORITATIVE FARSHI CUT DIRECTIVE:
This SKU is explicitly classified as a Farshi / Farsi / Fasi Salwar. Use any uploaded bottom-wear reference alongside Farshi structural geometry.
The bottom wear in this SKU is AUTHORITATIVELY CLASSIFIED AS "Farshi / Farshi Pajama / Farshi Pants / Farshi Salwar" (NEVER Palazzo, NEVER generic Salwar).
Record this structure in bottomWearDetails (classification, waistAndPleating, legVolume, and hemline). Print, colour, motif scale, and length still come from the references. Do not replace this construction with a palazzo, a skirt, or a gathered salwar cuff.
${FARSHI_SILHOUETTE_STRUCTURE}
You MUST record 'productIdentity.bottomWearDetails.classification' as "Farshi / Farshi Pajama / Farshi Pants / Farshi Salwar".
You are STRICTLY FORBIDDEN from classifying it as Palazzo or generic Salwar, and you must NEVER write "NOT Farshi".
Under negativeConstraints, explicitly state: "NOT palazzo, NOT tubular straight pants, NOT lehenga, NOT skirt, NOT sharara, NOT gharara, NOT churidar, NOT a gathered salwar poncha, NOT an open palazzo hem".
Do NOT write "NOT tapered" or "NOT gathered into an ankle cuff" for this Farshi. The 4-inch hem taper and the joined 6-inch hem panel are part of the silhouette.
` : ""}
1. EXACT CUT & CLASSIFICATION: Inspect the uploaded BOTTOM WEAR photo carefully from waistband to ankle opening (including horizontal yoke seams, upper pleats, and separate lower hem panels — do not rely on a generic ethnic-wear prior):
   - "Farshi / Farsi / Farshi Pajama / Farshi Pants / Fasi / Farshi Salwar": Two distinct trouser legs with this construction only: ${FARSHI_SILHOUETTE_STRUCTURE} Classify as Farshi when EITHER the SKU/details name farshi/farsi/fasi OR the bottom-wear photo visually exhibits waist/hip-yoke pleats (three vertical pleats per leg below the waistband or an upper horizontal hip yoke seam, plus side-seam fullness) AND/OR a distinct ~5 to 7 inch horizontal bottom hem cuff/panel joined above the ankle by a visible stitch joint, metallic gota line, piping, or lace trim (especially where diagonal/chevron stripes change angle or reverse at the cuff seam — even in flatlay photographs where the 4-inch inward circumference taper appears subtle on the table). Length may be ankle-length (clearing the floor to display footwear) or floor-length as the references show. Hem embellishment (lace, gota, print band, or a plain finish) is whatever the references show on that joined hem panel — do not invent lace. Distinct from palazzo (which hangs unbroken from waist/hip to a wide un-tapered bell hem with NO hip-yoke pleat cluster and NO separate ~6-inch horizontal joined cuff panel), from Sharara (where the flare begins at or below a knee join), and from generic salwar (no gathered poncha cuff). NEVER force Farshi onto a genuine plain unbroken palazzo, sharara, gharara, straight trouser, or skirt.
   - "Palazzo": Unbroken wide-leg straight or softly flared bell trousers hanging continuously from waist/hip to a wide open ankle hem WITHOUT hip-yoke knife pleats and WITHOUT a separate ~5-7 inch horizontal gota/seam-joined cuff band above the ankle. Classify as Palazzo ONLY when both yoke pleats and a separate ~6-inch joined cuff panel are genuinely absent in the BOTTOM WEAR photo!
   - "Straight Trousers / Cigarette Pants": Narrow straight tailored cut ending at the ankle, with side slits or plain hem.
   - "Sharara": Fitted from waist to knee, flaring out dramatically from the knee down.
   - "Gharara": Ruched/gathered below the knee with decorative gote/piping, flaring out below.
   - "Patiala / Salwar": Traditional pleated volume draped into narrow ankle cuff (poncha).
   - "Churidar": Fitted closely to calf and ankle with fabric gathers/rings (churis) at the ankle.
   - "Skirt / Lehenga": Full-length circular or pleated flare with NO separate trouser legs.
2. WAIST & PLEATING ARCHITECTURE: Document pleat structure: e.g., "deep front inverted box pleats running vertically down each leg", "dense gathers from a fitted waistband", "knife pleats", or "gather-free tailored waist". When the cut is Farshi/Farsi, record three waist pleats on each side plus one large pleat on each side at the side-seam joint.
3. LEG VOLUME & SILHOUETTE: Describe the leg profile from hip to hem, including whether fabric trails/pools or clears the floor at the ankles. Farshi must be described with the structure lock above (soft structured drape, two visible legs), not as "wide-leg pants".
4. HEMLINE & BORDER FINISH: Document the hem finish actually visible: e.g., "broad 3 to 4 inch horizontal hem band", "sequin lace trim above hem", "plain turned hem", "metallic zari border". Do not invent a hem band or lace. When the cut is Farshi/Farsi, the hemline field must state the 6-inch panel joined to the leg and the 4-inch taper from the upper edge of that panel to its lower edge.
5. FABRIC, COLOR & MOTIF GEOMETRY: Record bottom-wear fabric, base color, sheen, AND print/patterns as its own geometry - motif shape inventory, physical scale relative to the leg (e.g. "each gold floral is roughly palm-sized, scattered not micro-dotted", or "bold dark chocolate-brown chevron / zigzag print on beige ground stacked vertically across each leg"), density, metallic color, orientation, and hem embellishments (e.g. sequin lace band or contrast border). Example: "dark chocolate-brown on beige ground with bold large-scale chevron zigzag print running across both legs, finished with gold sequin lace above the hem; NOT solid; NOT micro-dots; NOT upper kurta floral". If the kurta is floral and the bottoms have a chevron zigzag or floral boota, those are TWO different treatments - never merge them.
6. EXPLICIT NEGATIVE CONSTRAINTS (WHAT IT IS NOT):
   - For Farshi / Farsi / Fasi pajama / Farshi pants / Farshi salwar: Explicitly state "NOT palazzo, NOT plain wide-leg, NOT lehenga, NOT tubular straight pants, NOT skirt, NOT dhoti pants, NOT tulip pants, NOT balloon/harem pants, NOT churidar, NOT a gathered salwar poncha, NOT an open straight hem". Do NOT state "NOT tapered at ankle" or "NOT gathered into an ankle cuff" — the Farshi hem is the joined 6-inch panel with the 4-inch taper. Also state "NOT solid/undecorated" when motifs are visible, and "NOT micro-dot/speckle print" when motifs or chevron prints are bold.
   - For Palazzo: Explicitly state "NOT lehenga, NOT dhoti pants, NOT tulip pants, NOT tapered at ankle". NEVER state "NOT Farshi" when an image is labeled BOTTOM WEAR / FARSHI.
   - For Straight Pants: Explicitly state "NOT palazzo, NOT flared, NOT dhoti pants, NOT salwar".
If the SKU is a standalone upper garment (e.g. single kurti, standalone dress, saree), explicitly state "none - standalone garment".

Build a precise Product Identity Profile. Perform a rigorous geographic evidence audit for construction, closures and decoration placement. Break the garment into specific physical regions. For stitched garments use (e.g. front neckline, front chest/yoke, front body, front hem, center back, back neckline, back body, back hem, left side construction, right side construction, left sleeve/armhole, right sleeve/armhole, waist, bottom wear front, bottom wear back, bottom wear hem). For sarees use (e.g. inner pallu, outer pallu, pallu border, body upper border, body lower border, chest drape, front pleats, waist tuck, unstitched blouse piece).
  For each region, record its evidence in garmentEvidence:
  - region: the physical location.
  - sourceRole: the exact product role from the manifest that proves this observation (for example "front", "back", "bottom", "saree_back_drape", "fabric_pattern", or "saree_pallu_spread"). Never leave it blank for a confirmed observation. Never use STYLE REFERENCE, MODEL FACE REFERENCE, or APPROVED POSE as sourceRole: those images are not product truth, and a detail visible only there is unknown.
  - state: "confirmed" (clearly visible in an authoritative reference), "confirmed_absent" (clearly proven to not exist there), or "unknown" (not visually proven either way).
- visibleConstruction: explicitly what construction (seams, slits, folds) is proven there.
- visibleDecoration: explicitly what trim, lace, embroidery, or print is proven there.
- closures: any buttons, ties, zippers.
- explicitlyAbsent: what is explicitly proven NOT to be there.
- uncertainty: what cannot be seen or is ambiguous.

Crucial Evidence Rules:
  - UNKNOWN DOES NOT MEAN INFER. If left/right side construction cannot be established, record state as "unknown" and state explicitly in uncertainty that it is unproven.
  - Do not use words like "probably", "likely", "usually", "typically", "symmetrical", or "same as the other side". If it is not proven, it is unknown.
  - Do not extrapolate decoration. If gold lace is confirmed at the front hem, but the side seam is unknown, do not assume the lace continues. Record the side seam as unknown.
  - When a BACK PRODUCT or REAR/BACK DRAPE reference is supplied, include separate back neckline, back body, and back hem entries sourced from that direct back role. If a rear region is hidden or unresolved, record it as unknown with that sourceRole; do not fill it from the front image.
  - A rear/back entry in detailPlacementMap is allowed only when the matching rear region is "confirmed" and the named decoration/construction is explicitly visible in a direct BACK PRODUCT, REAR/BACK DRAPE, or matching BLOUSE BACK reference. Do not copy front lace, trim, borders, closures, or motifs into a rear placement lock.
  Fill detailPlacementMap with only source-supported region-specific hard locks and absenceConstraints with negative product facts as well for backward compatibility.

SCENE AUTHORITY: when a STYLE REFERENCE image is supplied, that image defines the shoot. Describe what it actually shows - wall colour and finish, floor or ground surface, set dressing that stays in the room, plant or furniture presence, light direction and quality, camera height and distance, depth of field, colour grade - concretely enough to rebuild that set from the description alone. Do not record the pose (it belongs in referencePose only), foreground pillar-leaning placement, or objects in the hands (such as iced coffee cups, drinks, tote bags, purses, phones, or sunglasses) as set dressing or propUsage. Keep the main standing zones open and unobstructed so full-length silhouettes have breathing room away from foreground columns. Never replace it with a generic "clean premium studio backdrop": a plain seamless-paper description when the reference shows a styled set is a failure of this analysis. A requested scene direction refines mood, styling and props on top of the referenced set; it does not replace the referenced backdrop. Only when no style reference is supplied does the requested scene direction define the scene by itself.
PRODUCT vs STYLE DIVISION: Product references are garment/SKU truth only (cut, colour, print, embroidery, construction). The STYLE REFERENCE is the sole authority for photoshoot backdrop, room architecture, flooring, lighting, camera, mood, AND jewellery/ornament taste when those pieces are not already part of the product. THE CLOTHING WORN IN THE STYLE REFERENCE MUST BE 100% DISCARDED; NEVER DRESS THE MODEL IN THE STYLE REFERENCE'S CLOTHING OR BORROW ITS PRINTS/COLORS. Never mix a product-photo wall, arch, urn, pot, plant, or courtyard into creativeDirection.
CRITICAL NEGATIVE RULE FOR SCENE & BACKGROUND: Product reference images (FRONT, BACK, BOTTOM, FABRIC, MANNEQUIN) frequently show the garment in an existing pre-shoot studio, outdoor location, archway, courtyard, terracotta pots/urns, plants, or furniture. You are STRICTLY FORBIDDEN from describing, extracting, or incorporating ANY background elements, walls, arches, urns, pots, plants, or furniture from the PRODUCT reference images into creativeDirection or backgroundStyle! The photoshoot scene MUST BE DERIVED 100% FROM THE STYLE REFERENCE (if supplied), or from the requested scene direction (if no style reference is supplied), or designed as a fresh, clean, elegant, neutral fashion studio.

Build a Creative Direction Profile from style references, but never allow style to alter the product. Lock one lens family, camera height, perspective, exposure, white balance, color grade, light direction, shadow behavior, set geometry, and time-of-day so the results read as contact sheets from one real professional shoot. In realismRules, explicitly require natural skin texture with visible pores, strictly exactly two arms and two hands with soft relaxed human fingers (zero mannequin splayed hands, zero hands poking through fake garment/pleat slits, zero extra or duplicate limbs), anatomically correct and naturally shaped eyes and teeth, and no synthetic AI artifacts.

Define one Model Identity Profile with concrete, specific facial detail - not generic filler. Describe visible appearance attributes only; never identify, name, or infer personal attributes of anyone depicted.
CASTING BRIEF: an adult fashion model who reads as a youthful young adult matching Requested model direction (for example "${args.modelDirection || "South Asian - Female"}") - with a naturally warm, approachable, photorealistic face and genuine living composure rather than a severe or synthetic look. Record this in modelIdentity.castingDirection. ${hasExplicitModelRef || useStyleAsModelFace ? `A MODEL FACE identity image IS active in the manifest (${hasExplicitModelRef ? "MODEL FACE REFERENCE" : "STYLE REFERENCE duplicated as MODEL FACE REFERENCE"}): that exact face governs completely and must not be restyled, aged, slimmed, lightened, or replaced. Describe the visible face shape, eyebrow shape, nose, lips, and jawline in modelIdentity.face so every frame preserves that exact person - features only, never a gaze direction, smile, expression or head angle (those change per frame). If the eyes are covered, record the cover and do not invent eye color.` : `NO MODEL FACE REFERENCE image is attached: design a fresh, original, believable adult fashion model consistent with Requested model direction, with concrete repeatable jawline, eyebrow, nose, lip, skin-tone, and hairstyle notes locked from Pose 1 across all six poses. Strictly DO NOT copy the STYLE REFERENCE model's face, hair, sunglasses, coffee cup, tote bag, or clothing.`} In modelIdentity.faceRealism, lock the photorealism bar for every pose: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry, eyes kept naturally realistic (or covered when the explicit model-identity reference hides the eyes), and naturally aligned teeth (not uniformly perfect, no extra or missing teeth) - never a plastic, waxy, airbrushed, or symmetric "AI face". Lock skin tone, hair, makeup, body proportions, accessories and footwear the same way across all six images.

Overall pose energy: every one of the six poses should look like a real marketplace catalog photograph of one person in one room - relaxed, natural, and believable, never stiff, robotic, frozen mid-stride, or a wide stock-photo grin.
MODEL EXPRESSIONS & SMILES: Model expressions and smiles must look natural, relaxed, and realistic with soft lips, relaxed facial muscles, and subtle warmth, or calm composed poise. NEVER artificial, forced, stiff, wide, or frozen stock catalog smiles, and never a toothy grin. expressionPlan sets the shoot's mood (attitude, energy, smile level). Each face-visible pose then gets its OWN expression: a different gaze target, head angle and mouth - Pose 1 meets the lens, Pose 2 looks just past it over the turn, Pose 4 looks away into the set or carries the STYLE REFERENCE person's expression and gaze, Pose 5 turns a quarter and looks back to the lens, Pose 6 looks toward the featured garment area. Never write the same 'soft smile, eyes to camera' for every frame, and never both arms hanging straight in every frame.

REFERENCE POSE & EXPRESSION PLAN - fill referencePose and expressionPlan at the JSON root:
- referencePose records the STYLE REFERENCE person's body posture: posture (standing, seated, leaning, kneeling, crouching, reclining, walking, other, or none when it shows no person), description of the body position only (torso, legs, arms, head angle), seatOrSupport (what the body rests on, or ""), distinctiveness ("signature" when the pose or styling is unusual or is that photo's signature, such as a floor sit with one knee raised, a doorway lean, or a crossed-ankle perch; otherwise "generic"), signatureDescription (what makes it unusual, "" when generic), attitude (that person's attitude as a style cue), cameraAngle (how the photo is shot: height, angle and distance, e.g. 'eye-level, slightly three-quarter, full length'), expression (mouth and mood, e.g. 'soft closed-lip smile, dreamy'), gaze (eye direction and head angle, e.g. 'eyes lowered to the left, head tilted down'), and hands (the gesture, e.g. 'hands loosely clasped at the waist'). Record body position and look only: never the clothing, face identity, hair, jewellery, or anything in the hands.
- suitableForProduct records the risk for THIS product: "no" when the posture would fold, bunch, hide, or distort the garment's front design, hem, pleats, pallu, or bottom-wear silhouette, otherwise "yes", with a one-line suitabilityReason. It does not stop Pose 4 from matching the reference: write Pose 4 so that risk never hides the print or changes the garment.
- expressionPlan: the shoot's mood - one attitude, energy, and smile level that suits BOTH the style reference's attitude and this product, with a one-line rationale; gaze is the Pose 1 gaze (each other frame varies it). Natural and relaxed, never a forced or toothy grin.
- POSE 4 MATCHES THE REFERENCE POSTURE: whenever the STYLE REFERENCE shows a person, write Pose 4 (creative) as the signature reference frame - that person's posture or signature styling, standing, seated, leaning or any other, resting only on furniture that already belongs to the set, shot at the reference cameraAngle and framing, with the reference hand gesture, gaze and mood - dressed in OUR garment. Poses 1, 2 and 3 already show the full silhouette and the back, so Pose 4 does not need to. Keep the garment's front design, print and colours exactly as the product photos show; a seated pose may let the hem rest naturally but never hides the print or changes the garment. A walking or mid-stride reference becomes a grounded weight shift with both feet on the floor, in the reference's direction, camera angle and framing. Pose 4 stays product-led only when the product notes demand sitting and the reference person is not seated, when the bottom wear is Farshi and the posture is folded (seated, kneeling, crouching, reclining), or when a saree would recline.
- Pose 6 (showcase) never copies the reference posture: it is the PRODUCT HIGHLIGHT close-up described under showcase.
- Poses 1, 2, 3, 5, and 6 never copy the reference posture. The reference outfit, face, hair, and anything in the hands stay quarantined in every frame; jewellery follows the stylingPlan.

STYLING PLAN - decide what this model wears alongside the garment, and fill stylingPlan. Read ALL sources before choosing: scan EVERY uploaded product slot (front, back, mannequin/flat-lay, bottom, additional_product) to detect whether a dupatta, stole, scarf, or accessory ships with the SKU — never ignore a folded or laid-out dupatta in mannequin or additional_product! If a dupatta/stole appears in ANY product photo, record it in productIdentity.accessoriesIncluded AND in stylingPlan.ornaments (exact colour/ombré, fabric, border/gota lace trim, and natural multi-pose drape: gracefully over one shoulder/forearm in front/angled poses leaving neckline/butti work clear, and draped forward over both arms/elbows on pose 3 back so the rear neckline/ties stay 100% unobstructed); never write "no dupatta" when one is uploaded! For style reference inputs: read the footwear, earrings/jhumkas, bangles, belt, and editorial mood from STYLE REFERENCE when those items are not already part of the product. State each choice specifically enough that a stylist could pull it from a shelf and repeat it identically in every frame - "gold chandbalis with tiny pearls and a delicate stack of thin gold bangles on the right wrist" is usable, "ethnic jewellery" is not.
- footwear: one specific pair - style (e.g. flat juttis, mojaris, block-heel mules), heel height (flat / low / mid), overall colour & finish (e.g. antique-gold or champagne-beige ethnic flat juttis) - that suits the garment length and hem (harmonizing with the style reference's editorial footwear mood when appropriate). Say if the product references already show footwear that must be kept instead. When footwear is a styling addition (not uploaded in the product references), describe it by silhouette, heel height, and general metallic/neutral colour rather than over-specifying micro-ornamentation density (avoid phrases like "minimal tonal embroidery only").
- jewellery: PRODUCT FIRST, STYLE REFERENCE SECOND. If the product already includes jewellery, keep those pieces. Otherwise, inspect the STYLE REFERENCE head-to-wrist carefully (earlobes, forehead/bindi, wrists, neck, fingers) and record EVERY visible ornament in stylingPlan.jewellery / ornaments / makeup so QA expects what the scene naturally carries (for example, if the style reference wears slim red and green bangles plus small stud/jhumka earrings and a tiny red bindi, list ALL of those explicitly instead of omitting earrings or bindi). Pick the metal and family deliberately - oxidised silver, temple or antique gold, polished gold, kundan or polki, pearl, contemporary minimal - and name each piece worn (earrings, neckpiece, bangles, rings, maang tikka, nose ring). Never invent a second competing jewellery story on top of the style-reference pieces, and never add a heavy neckpiece over an embroidered neckline/yoke/strap detail unless the style reference clearly uses that AND the neckline stays readable. If the style reference is jewellery-free, keep jewellery minimal or none.
- ornaments: ALL product-included accessories (especially any uploaded dupatta/stole/scarf from mannequin or additional_product, with exact colour, border/gota trim, and forward/back drape rules) PLUS any complementary style-reference ornaments (belt, potli/bag, waist chain, hair pin). Use "none" only when NEITHER the product references NOR the style reference shows any dupatta, stole, or ornament.
- makeup and hair: one look each, held across all six frames.
- stylingNotes: the rule a stylist would need to avoid mistakes on this specific product, for example "keep the right wrist bare so the sleeve embroidery stays visible" or "no neckpiece over the embroidered yoke".
- themeInterpretation: one sentence naming the aesthetic you read from the style reference and why this styling serves it.
${args.housePreferences ? `HOUSE STYLING PREFERENCE - drawn from styling plans this team has actually approved for this category, showing where they rewrote an earlier proposal:
${args.housePreferences}
Treat this as the house taste and start from it. It ranks below product truth and below the style reference: if this product or this reference genuinely calls for something else, choose what the images support and say why in stylingNotes. Never let it override a detail the product references show.
` : ""}${args.fashionKnowledge ? `FASHION KNOWLEDGE (SEEDED CUT/PRINT GUIDANCE, SUBORDINATE TO PRODUCT REFERENCES):
${args.fashionKnowledge}
Use this only to name and measure what the current product images actually show. If the references show a different bottom cut or print, follow the images. Never use this guidance to invent farshi volume or motifs that are not visible.
` : ""}${args.analysisLearning ? `SUCCESSFUL HOUSE PATTERNS (POSE/SCENE LANGUAGE TO REUSE, SUBORDINATE TO PRODUCT REFERENCES):
${args.analysisLearning}
Reuse this language for pose energy, scene continuity, and styling so you do not re-derive a six-pose system from scratch. Product references still outrank these patterns. Never let a pattern change bottom-wear cut, print, or construction.
` : ""}${args.showcaseFeedback ? `SIXTH-FRAME FEEDBACK (WHAT THIS TEAM KEPT AND WHAT THEY THREW AWAY):
${args.showcaseFeedback}
This records how earlier sixth frames for this category were received - which subjects and framings operators approved, and which they rejected or sent back for regeneration. Use it to break ties between comparably strong features, and to avoid a framing this team keeps rejecting. It is house taste, not product truth: if these product references clearly make a different feature the strongest one, choose that feature and ignore this.
` : ""}Every choice is a styling addition only: it must never be treated as part of the garment, must never hide, replace or contradict a detail from the product references, and must never contradict detailPlacementMap or absenceConstraints. When the product references already show footwear or accessories that ship with the product, keep those and say so rather than replacing them.

Accessory styling suggestion: look at what footwear and accessories (if any) the product references actually show. If the product's own footwear/bag/accessories are missing, incomplete, or would not read well on camera, propose ONE tasteful, trend-right, Gen-Z-appropriate addition (for example a specific footwear style or a small bag) in creativeDirection.suggestedAccessories, described specifically enough for a stylist to execute identically across all six poses. Only suggest an addition when it genuinely fits the pose plan and category - if the product references already show adequate footwear/accessories, or nothing suits the shot, leave creativeDirection.suggestedAccessories empty. This is a styling addition only: it must never be treated as part of the garment, and it must never contradict detailPlacementMap or absenceConstraints.

GARMENT-SPECIFIC POSE GRAMMAR - match every pose to what this garment actually is. Record the family you read in productIdentity.garmentFamily and let it drive body language in every pose prompt:
- BENGALI SAREE (tant, taant, jamdani, dhakai, garad, korial, baluchari, swarnachari, kantha, lal-paar/red-and-white, shantipuri, begumpuri, or an aatpoure/Bengali drape): elegant, upright, serene living-human posture centered in an open floor zone with level shoulders and small, deliberate movement. The pallu/aanchal must be placed exactly as recorded - correct shoulder, correct fall direction, correct visible length - and stay open and readable. Front pleats flat, evenly stacked and vertical; upper and lower borders continuous and identical in width; hem border level. Strictly exterior relaxed hands only — hands never emerge through a slit inside pleats and never cross pallu artwork or border. If saree references show a strapless knotted mannequin wrap without a stitched blouse, pair with a plain undecorated solid modest half/elbow-sleeve blouse with zero invented embroidery or ties.
- ETHNIC / TRADITIONAL & GEN-Z CONTEMPORARY SAREE (any regional, festive, or modern Gen-Z saree): choose graceful, current Gen-Z-aligned editorial poise centered cleanly in an open unobstructed bay of the set (never squished behind or leaning on a foreground stone column) while giving Poses 1, 2, 4, and 6 clearly distinct camera proximity, torso turn, and composition (full centered hero, shifted 40-degree drape turn, true rear blouse/pallu view, closer knees-up editorial border/shoulder showcase, tight weave/border macro, pallu or border product-highlight close-up — zero stiffness, zero mannequin splayed fingers, zero phantom hands poking out of pleats, and zero trousers). If references show a blouseless strapless mannequin wrap, pair with a plain undecorated solid fitted half/elbow-sleeve blouse locked across all six frames without inventing motifs, borders, cutouts, or back ties. The pallu stays one continuous placed panel, never duplicated into extra loose cloth.
- KURTI / KURTA SET (top + bottom, and dupatta whenever present in any reference): poses must vary torso turn, studio position, and camera distance across Poses 1, 2, 4, and 6 so Poses 1, 2, and 4 never repeat the exact same static frontal step/tile. Keep the top's full length and straps/sleeves readable, keep bottom wear visible waistband-to-hem preserving exact cut (apply the Farshi narrow-from-waist + 6-inch joined hem + 4-inch taper rule ONLY when cut is Farshi; keep palazzo, sharara, gharara, straight, and salwar pure to their own geometry), keep arms relaxed outside the kurta/dupatta perimeter (never poking a hand through a fake front slit or gripping the opposite forearm), and drape any uploaded dupatta gracefully so front neckline/butti work and bottom silhouette remain readable (and swept forward over forearms on back pose!).
- SHORT KURTI / TOP-ONLY: frame Pose 1, Pose 2 (knees-up 40° turn), Pose 4 (waist-up/mid-thigh closer editorial), Pose 5 (macro craft detail with hands clear), and Pose 6 (product-highlight detail close-up) tightly enough that the top fills the frame cleanly as the star — NEVER shrink a short top into 5 identical distant full-body pavement/shoe shots. Keep understated neutral bottoms clearly secondary.
- STANDALONE LONG KURTI: keep bottomWearDetails explicitly "none - standalone garment". Pair only with quiet, understated neutral styling bottoms in stylingPlan; poses prove top fall, true hem length, neckline, sleeves, side slits, and craftsmanship across distinct front, 40-degree turn, true rear, knees-up editorial contrapposto, craft close-up, and product-highlight detail close-up frames without ever inventing a matching bottom piece. Never hitch, tuck, or gather the hem.
- LEHENGA: show choli, dupatta and the complete skirt flare with the hem in frame and the skirt volume never flattened.
- DRESS / GOWN / WESTERN-CASUAL: relaxed, current body language showing distinct camera angles/distances while keeping silhouette and hem level and intact.
In every family the pose may only change body position, angle, framing, studio floor placement, and natural expression — AND Poses 1, 2, 4, 5, and 6 must be visually distinct in torso turn, camera distance, and natural arm choreography (never copy style-reference coffee cups, tote bags, sunglasses, or dead-hanging mannequin arms!). It must never change the garment's design, print, motif scale, colour, fit, construction or bottom-wear silhouette.

Create exactly six product-specific camera setups in one coherent commercial coverage sequence with MANDATORY PHYSICAL VARIATION across all 6 slots, in this order and with these ids: full_front, angled, back, creative, closeup, showcase. They are NOT repeats of each other. Every pose must specify exact framing, body position, hand placement, expression, product visibility rules, reference authority, highlighted details, purpose, consistency note, and a self-contained prompt that repeats the relevant location locks and absence constraints. Every individual prompt must (1) describe THIS product's exact colour, fabric, construction and selling details from the product references, and (2) direct the model's stance, angle, action, relaxed continuous natural hands, and calm expression, while creativeDirection must rebuild the photoshoot backdrop, wall, floor, lighting and furniture from the STYLE REFERENCE only.

- full_front: straight-on (shoulders and hips facing forward) positioned in an open floor zone with clean margins around the silhouette (never pinched against a foreground pillar), matching the requested output aspect ratio (tailored closer full/mid-thigh hero for short_kurti_top, head-to-toe for sets/kurtis/sarees; never describe framing itself as "square" unless 1:1 output is requested); establishes face/hair/styling/footwear/scene/lighting anchor with relaxed weight shift, asymmetric natural living hands clear of embroidery/pleat slits, and natural warm composure.
- angled: mandatory 35 to 45 degree intentional turn of torso and hips from a visibly shifted perspective, with both feet planted and close (knees-up three-quarter framing for short_kurti_top so sleeves and fit shine up close; full-length for sarees/sets), clearly revealing side construction, garment depth, side seam/slit, and sleeve silhouette. Never a walking stride or lifted foot, never a flat frontal repeat, and never copy poses or handheld props (cups, totes, sunglasses, bags) from the style photo.
- back: true full rear view, shoulders and hips fully away; uploaded BACK is the sole rear-construction authority, or rear drape for sarees. For outfits with a dupatta or shawl, the dupatta must be draped forward over arms or front so the rear garment (neckline, back panel, embroidery, hem) is 100% unobstructed and visible. Hair swept forward or in an updo. The studio set, backdrop wall, lighting, and model identity must strictly match the other poses.
- creative:
  * SEATED POSE LOCK: creativeDirection.seatedPoseRequired is the user's explicit sit request. Set it to "yes" only when the user product notes explicitly demand sitting, and seatedPoseReason to a one-line quote of the note. A person sitting in the STYLE REFERENCE, the MODEL FACE photo, a product photo, or APPROVED POSE 1 is not a request to sit: set seatedPoseRequired to "no" (the style-reference posture belongs in referencePose) and never copy any coffee cup/tote bag or objects in the hands. When the notes demand sitting, this 4th pose is an elegant seated editorial on furniture that already belongs to the set, with the garment, bottom wear, hemline, and footwear fully visible. Otherwise, when the STYLE REFERENCE shows a person, write Pose 4 in that matched posture, camera angle and framing as REFERENCE POSE & EXPRESSION PLAN directs, with the garment's front design, print and colours exact. Otherwise (no person in the reference, a Farshi folded posture, or a reclining saree) design a distinctly closer/different natural editorial stance that clearly diverges from Pose 1's tile and camera distance — full-length head-to-toe with feet grounded and close for Farshi bottom sets, OR a closer knees-up / waist-up three-quarter editorial contrapposto for sarees, short tops, standalone long kurtis, and non-Farshi sets (matching framing, description, bodyPosition, and prompt 100% consistently so "feet grounded" never appears inside an above-ankle crop). Keep both hands anatomically continuous outside garment pleats/seams with zero awkward forearm gripping. Expression is calm and genuine.
- closeup: THIS POSE SELLS PRODUCT DETAIL. First choose the single most important real selling detail from the PRIMARY UPLOADED PRODUCT GARMENT (e.g. kurti butti work, chest/yoke embroidery, neckline craftsmanship, handwork, sleeve craft, or weave) and record it in creativeDirection.closeupHeroDetail. CRITICAL: Pose 5 MUST highlight the primary garment's key signature detail (for example, if the kurti has butti work, Pose 5 must clearly showcase that work). It is STRICTLY FORBIDDEN to focus on or crop in on a secondary accessory like a dupatta, stole, or scarf when the primary garment has butti work, embroidery, or signature craft to showcase! (Only focus on a dupatta if the uploaded product is purely a standalone dupatta). Then choose framing and record it in creativeDirection.closeupMode:
  * "face_and_detail" when that detail sits at neckline/chest/yoke and stays LARGE beside the face: genuine zoomed-in face-to-chest or face-to-waist crop. Face is the locked identity with a calm natural expression (relaxed eyes, never a forced grin) AND the product detail occupies a large, catalog-readable portion of the frame - never a tiny hint of embroidery under a beauty close-up.
  * "product_detail" when a full face would shrink that selling detail below readable catalog size: crop to the product detail so it fills most of the frame. Face may be partial at the edge or omitted. Never a full-body hero repeat, and never a face-only beauty crop.
  The closeup pose prompt, framing, highlightedDetails, and productVisibilityRules MUST match that choice. highlightedDetails must lead with the product detail, not the face, when closeupMode is "product_detail".
- showcase: THE SIXTH FRAME IS THE PRODUCT HIGHLIGHT - a tight, accurate DETAIL CLOSE-UP of this product's most distinctive feature, on the worn garment, in the same set and light. It never copies the reference posture and is never a full-body or three-quarter frame.
  Look at the product references and decide what a buyer would actually zoom in on or ask about: a back closure or lace-up with its bow, a sleeve or cuff treatment, a dupatta's border or print, a hem or border finish, embroidery, the print's scale and repeat, the fabric's texture, a saree's pallu or border, or any other genuinely distinguishing detail. Choose the single strongest one.
  It must NOT re-shoot pose 5's subject. You have already recorded creativeDirection.closeupHeroDetail for pose 5; if the strongest feature is that same detail (for example the neckline or front yoke), pick the next most distinctive feature - sleeves or cuffs, a back closure, the hem, a dupatta, or the fabric or print - and say so in distinctFrom.
  The close-up framing follows where the feature sits: a back closure is a back-detail crop with the model facing away, from the shoulder blades to the waist, showing every lace crossing, the bow and its hanging ends; sleeves are a forearm-and-cuff crop; a dupatta is a drape-detail crop; print or embroidery is a torso crop. The face may be outside the crop.
  Then fill showcasePlan at the JSON root:
  - heroFeature: that feature, named concretely enough to shoot it - "criss-cross black lace-up down the centre back ending in a bow", not "back".
  - featureRegion: one of back_detail, neckline, embroidery, print, sleeve, hem_border, dupatta, pallu, drape, blouse, bottom_wear, other.
  - shotType: macro_detail (fill the frame with the feature) or half_body_detail (crop to the body section it sits on).
  - whyItSells: one line on why this is the feature a buyer judges this product by.
  - evidenceReference: the manifest role that shows it best (BACK for a back detail, FABRIC / PATTERN for print or embroidery, MANNEQUIN or ADDITIONAL for sleeves when supplied).
  - framing, cameraAngle, bodyPosition, handPlacement, expression: concrete close-up direction for that crop, with strictly two natural hands clear of the feature.
  - distinctFrom: one line stating how this close-up differs from pose 5 and from the full-body poses 1-3.
  - visibilityRules: what must stay unobstructed for this feature and its exact garment specifications (colour, fabric, motif/embroidery geometry, closure construction) to read.
  This frame reuses the identical model, styling, footwear, set, backdrop and lighting - only the camera moves in close on the feature.

If the garmentFamily is "saree", you MUST also generate sareeTruth and sareeDrapePlan inside the JSON root.
sareeTruth: Record exact base and secondary colours; fabric family; weave/lattice geometry; texture, shine and transparency; every peacock/floral/other motif with its scale, orientation, repeat, density and placement by body/pallu/border; separate upper/lower border widths, construction and colours; the exact region where the pallu starts plus its artwork, motif density and orientation; tassel colour, construction and spacing; blouse colour/fabric/front/back/neckline/sleeves/ties/closures; and fabric weight, stiffness, fluidity and expected fall. Add regionEvidence entries with region, sourceRole, confirmed/confirmed_absent/unknown state and the same evidence fields as garmentEvidence. Unknown must stay unknown: never mirror or extrapolate decoration into an unproven region.
sareeDrapePlan: Choose a baseDrapeFamily (e.g., "shoulder-side/open-pallu" or "shoulder-side/pleated-pallu"), frontPleatTreatment, palluShoulderPlacement, handInteraction, borderVisibility, and poseSpecificDrapeState (e.g. how the angled pose shows the pallu fall).

posePlan: Design 6 distinct poses (full_front, angled, back, creative, closeup, showcase). For each, specify the cameraAngle, framing, bodyPosition, handPlacement, expression, and write a detailed photorealistic 'prompt' that combines these elements with the product and model identity.
CRITICAL: Every individual 'prompt' MUST be completely self-contained. The image generator does not see the other poses. You MUST explicitly describe the model's exact face, hair, skin tone, makeup, styling, bottom wear (exact cut, leg volume, two-leg vs skirt structure, pleating, hem, color, AND print/motif scale), and footwear inside EVERY SINGLE 'prompt' string. When the bottom is Farshi/Farsi, every prompt must repeat the Farshi structure: soft structured drape, three waist pleats on each side, one large pleat on each side joint, and a 6-inch hem panel joined to the leg with a 4-inch taper from the upper hem edge to the lower hem edge. Never describe that Farshi as untapered or cuff-less. NEVER use phrases like "consistent with previous poses", "same as full_front", or "locked scene" inside the 'prompt' string itself.
SCENE IS SHARED, NOT PER POSE: do NOT describe the background, set, walls, floor, location, props or lighting inside any pose 'prompt'. Describe the set once, concretely, in creativeDirection (backgroundStyle, studioEnvironment, propUsage, lighting, setContinuity); the generator applies that one description to all six frames. Six separate backdrop descriptions are how frames drift onto different sets - for example a back view on a different wall. The back, close-up, creative and showcase frames are the same room from another camera position.

Across all six, ONLY pose, angle, framing, and expression may change.
LOCKED DETAILS ACROSS ALL SIX IMAGES:
Lock and remember all important details across all 6 images to avoid consistency mistakes:
- Photoshoot backdrop: Exact same room architecture, wall finish, flooring, lighting, shadows, and furniture from the style reference / Pose 1.
- Footwear: Exact same pair, style, heel, finish, and color across all 6 frames.
- Ornaments & jewellery: Exact same pieces, metal type, count, and placement across all 6 frames.
- Accessories & styling: Exact same bag, belt, dupatta drape treatment, hair, and makeup across all 6 frames.
- Product layout & product design: Garment construction, cuts, seams, trims, embroidery geometry, pattern repeat, and bottom-wear architecture remain locked across all 6 frames.
REFERENCE IMAGE SCOPE: ${hasExplicitModelRef || useStyleAsModelFace ? "Model face comes from the active MODEL FACE identity photo (or the duplicated STYLE REFERENCE image explicitly uploaded as MODEL FACE)." : "NO MODEL FACE REFERENCE is attached: Pose 1 casts a fresh photorealistic adult model matching Requested model direction and locks that face across poses 2-6; do NOT copy the STYLE REFERENCE person's face, hair, or handheld props."} Backdrop, wall, floor, furniture, and lighting come from the STYLE REFERENCE on all six poses. Clothing comes only from the uploaded product photos. Discard the style-reference outfit, and discard every face and background inside the product photos. Copy that photo's posture only into Pose 4 as referencePose and the pose plan allow, never into Poses 1, 2, 3, 5, or 6, and never copy objects in the hands.

Return STRICT JSON only:
{"productIdentity":{"garmentFamily":"","category":"","mainColor":"","secondaryColors":[],"fabric":"","pattern":"","print":"","patternGeometry":{"type":"","scale":"","orientation":"","density":"","repeat":"","placementByPanel":[],"accentColors":[],"motifInventory":[]},"embroideryGeometry":{"placement":"","geometry":"","motifStructure":"","scaleRelativeToGarment":"","colorsAndMaterial":"","borders":"","necklineRelation":""},"texture":"","neckline":"","sleeveType":"","length":"","fit":"","silhouette":"","frontConstruction":"","backConstruction":"","buttons":"","zippers":"","pockets":"","embroidery":"","logos":"","accessoriesIncluded":"","bottomWearDetails":"","footwearDetails":"","detailPlacementMap":[],"absenceConstraints":[],"invariantDetails":[],"uncertaintyNotes":[],"garmentEvidence":[{"region":"","state":"unknown","visibleConstruction":"","visibleDecoration":"","closures":"","explicitlyAbsent":[],"uncertainty":""}]},"sareeTruth":{"body":{"mainFabric":"","weave":"","weaveGeometry":"","texture":"","transparency":"","shine":"","baseColor":"","secondaryColors":[],"pattern":"","motifInventory":[],"motifScale":"","motifOrientation":"","motifRepeat":"","motifDensity":"","motifPlacement":"","embellishment":"","bodyOrientation":""},"borders":{"upperBorder":"","lowerBorder":"","borderWidth":"","upperBorderWidth":"","lowerBorderWidth":"","borderColors":"","construction":"","motifGeometry":"","edgeTreatment":"","continuityRules":"","tasselColor":"","tasselConstruction":"","tasselSpacing":""},"pallu":{"hasDistinctPallu":false,"startingRegion":"","baseColor":"","motifInventory":[],"motifScale":"","motifOrientation":"","motifRepeat":"","motifDensity":"","borders":"","artwork":"","zari":"","embroidery":"","tassels":"","edgeTreatment":"","visualOrientation":"","evidenceReferences":"","uncertainty":""},"pleatZone":{"patternBehavior":"","borderBehavior":"","embellishmentBehavior":"","hasSpecialPanel":false},"blouse":{"hasBlouse":false,"color":"","fabric":"","frontConstruction":"","backConstruction":"","neckline":"","sleeves":"","ties":"","closure":"","embroidery":"","border":"","pattern":"","fit":"","isUnstitchedPiece":false},"physics":{"weight":"","stiffness":"","fluidity":"","transparency":"","shine":"","creaseBehavior":"","expectedFall":""},"regionEvidence":[{"region":"","state":"unknown","visibleConstruction":"","visibleDecoration":"","closures":"","explicitlyAbsent":[],"uncertainty":""}]},"sareeDrapePlan":{"baseDrapeFamily":"","shoulderSide":"","waistTuck":"","frontPleatTreatment":"","palluShoulderPlacement":"","openOrPleatedPallu":"","palluSpread":"","palluFallDirection":"","palluVisibleLength":"","handInteraction":"","movementAmount":"","pinningBehavior":"","borderVisibility":"","blouseVisibility":"","coverageConstraints":"","poseSpecificDrapeState":""},"creativeDirection":{"backgroundStyle":"","studioEnvironment":"","lighting":"","cameraPerspective":"","composition":"","framing":"","mood":"","colorTreatment":"","modelStyling":"","photographyStyle":"","propUsage":"","shadowStyle":"","editorialCommercialFeel":"","lensAndCamera":"","setContinuity":"","realismRules":"","suggestedAccessories":"","seatedPoseRequired":"no","seatedPoseReason":"","closeupMode":"face_and_detail","closeupHeroDetail":""},"showcasePlan":{"heroFeature":"","featureRegion":"","shotType":"","whyItSells":"","evidenceReference":"","framing":"","cameraAngle":"","bodyPosition":"","handPlacement":"","expression":"","distinctFrom":"","visibilityRules":[]},"referencePose":{"posture":"standing|seated|leaning|kneeling|crouching|reclining|walking|other|none","description":"body position only (torso, legs, arms, head) — no clothing, face, jewellery, props","seatOrSupport":"what the body rests on, or ''","distinctiveness":"generic|signature","signatureDescription":"what makes it unusual, '' if generic","attitude":"the reference person's attitude as a style cue","cameraAngle":"height, angle and distance of the shot","expression":"mouth and mood","gaze":"eye direction and head angle","hands":"hand gesture, never objects","suitableForProduct":"yes|no","suitabilityReason":"short reason"},"expressionPlan":{"attitude":"...","energy":"serene|calm|warm|playful|confident|dramatic","gaze":"...","smile":"none|soft|warm|open","rationale":"why this suits both the style reference and the product"},"modelIdentity":{"castingDirection":"","face":"","faceRealism":"","hair":"","makeup":"","bodyProportions":"","stylingLock":""},"stylingPlan":{"footwear":"","jewellery":"","ornaments":"","makeup":"","hair":"","stylingNotes":"","themeInterpretation":""},"posePlan":[{"id":"full_front","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"angled","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"back","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"creative","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"closeup","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"showcase","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""}]}  `;
  // Props the notes ask for narrow the fixed no-props phrasings here too.
  return withRequestedPropsAllowed(analysisPrompt, requestedHandheldProps(args.productDetails));
}

export const CONSISTENCY_RULES = [
  "Original product references always outrank generated images and style references; never reproduce pre-shoot backgrounds or props from product photos.",
  "Model face comes from MODEL FACE REFERENCE when attached; otherwise Pose 1 casts one original photorealistic adult model matching the casting direction and anchors Poses 2-6 without copying the style-reference face.",
  "Style references control backdrop, lighting, and mood across all six poses — never the outfit, face, hair, or handheld props (cups, totes, phones, sunglasses); the reference posture is copied only into Poses 4 and 6 when the pose plan adopts it.",
  "Lock identical backdrop, lighting, footwear, jewellery/ornaments, makeup, hair, and product construction across all six frames without adding unreferenced props.",
  "Execute 6 physically distinct poses across camera distance, studio floor position, and torso angle: open-floor hero front, 35-45 deg turn, unobstructed true rear (hair & dupatta forward), closer contrapposto/seated editorial, primary-garment macro craft (hands clear, never hijacked by dupatta), and showcase feature.",
  "Living-human realism: strictly two continuous exterior arms and relaxed hands (zero fake slit hands, forearm clawing, or stiff mannequin fingers), visible skin micro-texture, natural eyes, and calm genuine expressions.",
  "Preserve exact garment colors, fabric, weave, print geometry, embroidery, necklines, sleeves, length, and bottom-wear silhouette (never swap farshi/palazzo/salwar/lehenga or drop bold motifs).",
  "Treat detailPlacementMap, absenceConstraints, and suggestedAccessories as hard locks; never invent a competing jewellery story, text, or unreferenced elements.",
];

// Bumping this invalidates cached/stored analyses (Studio's analysis_cache and each
// catalog variant's stored ai_analysis) so prompt/schema changes here (the playful Gen-Z
// pose plan, the accessory-suggestion field, the face/photorealism locks, the
// model-face-reference support, and the corrected zoomed-IN pose 5) take effect on the
// next analysis run instead of quietly reusing a pre-change cache hit.
// v15 adds source-role provenance to regional evidence. Analyses made before it
// can say that a rear detail exists without proving that the back image showed
// it, so cache reuse would reintroduce front-to-back hallucinations.
// v16 ensures unobstructed rear garment visibility (dupatta forward drape) and strict backdrop continuity.
// v17 adds dedicated bottom-wear architecture and silhouette fidelity locks (preventing farshi/palazzo from falling back to dhoti/salwar).
// v18 separates farshi from palazzo/lehenga, locks bottom-wear print transfer off the upper-garment fabric close-up, and adds an optional dedicated bottom reference role.
// v19 enforces style reference backdrop authority, prohibits pre-shoot backgrounds from product images, and adds conditional sitting pose for pose 4.
// v20 records seatedPoseRequired from style-reference sitting, locks style-reference jewellery/ornaments, and lets pose 5 crop to product detail when a face would hide craftsmanship.
// v21 adds the sixth garment-led "showcase" frame, garment-family pose grammar
// (Bengali saree pallu placement, ethnic saree drape, kurti fit/length/sleeve,
// playful short-kurti/top framing) and the configurable bottom-wear
// presentation, so a cached v20 plan would still be a five-pose plan.
// v23 expands Farshi bottom wear definition to include ankle-length/floor-clearing
// flared volume, vertical pleats/gathers, and chevron geometric prints without palazzo flattening.
// v24 locks the Farshi/Farsi silhouette structure only: soft structured drape,
// three waist pleats on each side, one large pleat at each side joint, and a
// 6-inch hem panel joined to the leg with a 4-inch taper. Cached v23 analyses
// still forbid that hem, so they must be re-read.
// v25 keeps that Farshi hem and replaces frozen walking / mid-laugh poses with
// natural catalog stances. It also splits identity from the set: model face
// from the model-face reference (or the style-reference face when none was
// uploaded), backdrop from the style reference on all six poses, garment DNA
// only from the product photos. Cached v24 plans still ask for a mid-step walk.
// v26 keeps the three-quarter turn with both feet planted, so a cached v25
// plan cannot still ask for a stepped-forward walk that opens a joined hem.
// v27 stops the planner from taking pose inspiration from the style photo, so a
// cached plan cannot still copy that photo's stance or handheld props. It also
// refuses garment evidence sourced from the style photo, the model photo, or
// an approved pose.
// v28 keeps the identity photo's face when the eyes are covered, and uses the
// style-reference face when no separate model photo was uploaded.
// v29 stops treating the style photo's composition and handheld objects as
// part of the set, and stops demanding catchlights when the identity photo
// covers the eyes. Cached v28 plans can still name those objects as props.
// v30 stops treating a seated style photo as a request for pose 4 to sit.
// Cached v29 plans can still set seatedPoseRequired because the style model is sitting.
// v32 encodes the Farshi narrow-from-waist + 4-inch inward taper rule strictly for Farshi
// bottoms, keeps non-Farshi bottoms isolated, scans mannequin/additional slots for
// dupattas, and refines Gen-Z saree, top-only kurti, and kurti-set pose plans.
// v34 aligns cropped editorial Pose 4 framing with posture text (eliminating
// knees-up vs grounded-feet contradictions) and refreshes saree/back QA gates.
// v35 quarantines STYLE REFERENCE face/posture/props when Face Lock is empty,
// expands held-prop scrubbing (coffee cups, totes, sunglasses, bags), bans
// mannequin splayed fingers and fake slit hands, anchors Pose 1 open-floor
// placement, and tailors 6-pose framing/proximity per garment family.
// v36 records referencePose and expressionPlan: Pose 4 and Pose 6 may copy a
// suitable style-reference posture (posePlanning), frames 1, 2, 3 and 5 never do.
// Cached v35 plans have no referencePose, so they would always stay product-led.
// v37 records the reference person's camera angle, expression, gaze and hand gesture,
// keeps gaze and smile out of modelIdentity.face, and asks for a distinct look per frame.
// v38 makes Pose 4 the signature reference frame (adopted whenever the reference shows a
// person, past the soft suitability verdict) and Pose 6 the product-highlight detail
// close-up (showcasePlan.productHighlight, never a reference posture). Cached v37 plans
// keep a product-led Pose 4 and a full-body Pose 6.
export const ANALYSIS_VERSION = "generation-session-v38-signature-reference-product-highlight";

export function smallHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildColorwayAnalysisPrompt(args: {
  skuName: string;
  garmentFamily: string;
  referenceManifest: Array<{ number: number; role: string }>;
  baseMainColor?: string;
  baseSecondaryColors?: string[];
}) {
  const manifest = args.referenceManifest.map(({ number, role }) => `IMAGE ${number}: ${role}`).join("\n");
  return `You are a fashion catalog colorist and merchandiser.
This product SKU is a colorway variant of an already-analyzed catalog collection of garment style "${args.garmentFamily}".
The structural garment cut, pattern geometry, styling plan, and pose plan are already established.
Analyze the supplied reference image(s) to identify ONLY the colorway details for this SKU:

SKU: ${args.skuName}
${manifest}

FIRST, check that assumption against the image. This shortcut reuses the
collection's existing garment truth and only repaints it, so if this SKU differs
from the collection in ANY way other than colour - a different print or motif
layout, a different border, neckline, sleeve or hem, a different silhouette, a
different bottom-wear cut, or an added or removed dupatta - say so, because the
reused truth would then describe a garment this SKU is not.
Report colour differences as a match: a recoloured version of the same design is
exactly what this path is for.

Return JSON with this exact schema:
{
  "structureMatchesBase": true or false — false if anything but the colours differs from the established style,
  "structureDifferences": ["each non-colour difference you can see, empty when structureMatchesBase is true"],
  "mainColor": "exact primary dominant color name (e.g. Royal Blue, Crimson Red, Mustard Yellow)",
  "secondaryColors": ["secondary accent color", "border/trim color", "underlying tone"],
  "accentColors": ["small secondary accent colors in motifs or embroidery"],
  "bottomWearColor": "exact color of bottom wear if present in this variant (e.g. Matching Royal Blue, Off-white, Gold, Fuchsia Pink) or empty if no bottom wear"
}`;
}

/**
 * Whether the colorway shortcut may be used for this variant at all.
 *
 * The shortcut reuses the base SKU's garment truth and repaints it, so it is
 * only correct when the variant really is the same garment in another colour.
 * A variant that differs in print, border, neckline or cut would otherwise be
 * generated as the base garment wearing the variant's colours - the product's
 * own reference images never having been looked at for anything but colour.
 * Absent or unparseable fields fail closed, so an older model that does not
 * answer the question gets the full analysis rather than a silent reuse.
 */
export function colorwayDeltaIsSafe(colorResult: JsonRecord): {
  safe: boolean;
  differences: string[];
} {
  const raw = colorResult.structureMatchesBase ?? colorResult.structure_matches_base;
  const differencesRaw = (colorResult.structureDifferences || colorResult.structure_differences) as unknown[];
  const differences = Array.isArray(differencesRaw)
    ? differencesRaw.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const matches = raw === true || String(raw).trim().toLowerCase() === "true";
  return { safe: matches && differences.length === 0, differences };
}

export function mergeVariantColorways(
  baseAnalysis: ReturnType<typeof normalizeAnalysis>,
  colorResult: JsonRecord,
  _variantSkuName?: string
): ReturnType<typeof normalizeAnalysis> {
  const mainColor = String(colorResult.mainColor || colorResult.primaryColor || colorResult.main_color || "").trim();
  const secondary = (colorResult.secondaryColors || colorResult.secondary_colors) as unknown[];
  const secondaryColors = Array.isArray(secondary)
    ? secondary.map((c) => String(c || "").trim()).filter(Boolean)
    : [];
  const accents = (colorResult.accentColors || colorResult.accent_colors) as unknown[];
  const accentColors = Array.isArray(accents)
    ? accents.map((c) => String(c || "").trim()).filter(Boolean)
    : [];
  const bottomWearColor = String(colorResult.bottomWearColor || colorResult.bottom_wear_color || "").trim();
  const baseMainColor = String(baseAnalysis.productIdentity?.mainColor || "").trim();
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const colorTokenPattern = (color: string, flags = "iu") => {
    const normalized = color.trim();
    if (!normalized) return null;
    return new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(normalized)}(?![\\p{L}\\p{N}_])`,
      flags,
    );
  };
  const replaceColor = (input: string, oldColor: string, newColor: string) => {
    if (!input || !newColor || oldColor.toLowerCase() === newColor.toLowerCase()) return input;
    // Match the complete colour token/phrase, not the same letters inside a
    // construction word (for example the "red" in embroidered or gathered).
    return input.replace(colorTokenPattern(oldColor, "giu") ?? /$^/g, newColor);
  };
  const replaceBaseColor = (input: string) => replaceColor(input, baseMainColor, mainColor);
  const colorModifier = "(?:light|dark|deep|bright|pale|soft|muted|rich|warm|cool|dusty|pastel|vivid|royal|emerald|ruby|sapphire|navy|midnight|sky|powder|steel|forest|bottle|olive|sage|mint|lime|sea|teal|turquoise|mustard|gold|golden|coral|peach|fuchsia|magenta|blush|rose|hot|lavender|lilac|mauve|plum|chocolate|coffee|camel|charcoal|ivory|cream|beige|wine|blood|cherry|burnt)";
  const colorBase = "(?:off-white|off\\s+white|chocolate-brown|ivory|white|ecru|cream|beige|black|blue|navy|red|ruby|maroon|burgundy|wine|green|emerald|olive|sage|mint|teal|turquoise|yellow|mustard|gold|golden|orange|rust|coral|peach|pink|fuchsia|magenta|purple|violet|lavender|lilac|mauve|plum|brown|chocolate|coffee|tan|camel|grey|gray|silver|charcoal)";
  const bottomColorPhrase = `(?:${colorModifier}(?:-[a-z]+)?\\s+){0,2}${colorBase}`;
  const bottomGarment = "(?:farshi|farsi|fasi|pajama|pyjama|palazzo|trousers?|pants?|sharara|gharara|salwar|patiala|churidar|skirt|lehenga|leggings?|dhoti|culottes?|shorts?|bottoms?|bottom\\s+wear)";
  const bottomFabric = "(?:crepe|silk|cotton|chanderi|organza|georgette|satin|linen|rayon|viscose|muslin|velvet|chiffon|net|tulle|denim|khadi|cambric|lawn|poplin|brocade|jacquard|modal|tencel|polyester)";
  const hasDominantBottomColor = (input: string, color: string) => {
    const normalized = color.trim();
    if (!normalized) return false;
    const token = escapeRegExp(normalized);
    // A border/trim mention is not proof that the dominant fabric was updated.
    return new RegExp(`(?<![\\p{L}\\p{N}_])${token}(?=\\s+${bottomGarment}\\b)`, "iu").test(input) ||
      new RegExp(`\\b(?:in|of)\\s+${token}(?=\\s+${bottomFabric}\\b)`, "iu").test(input);
  };
  const recordedBottomColors = (details: string) => {
    const leading = details.match(new RegExp(`^\\s*(${bottomColorPhrase})(?=\\s+${bottomGarment}\\b)`, "i"));
    const inFabric = details.match(new RegExp(`\\b(?:in|of)\\s+(${bottomColorPhrase})(?=\\s+${bottomFabric}\\b)`, "i"));
    return [...new Map(
      [leading?.[1], inFabric?.[1]]
        .filter((color): color is string => Boolean(color))
        .map((color) => [color.toLowerCase(), color.trim()] as const),
    ).values()];
  };

  const cloned = structuredClone(baseAnalysis);
  const currentBottom = cloned.productIdentity.bottomWearDetails;
  const baseBottomColors = recordedBottomColors(currentBottom.replace(/\s*\(Variant Colorway:\s*[^)]*\)/gi, "").trim());
  const replaceDirectionColor = (input: string) => {
    let updated = replaceBaseColor(input);
    if (bottomWearColor) {
      for (const oldColor of baseBottomColors) {
        // The main-colour pass has already changed a shared old token to mainColor.
        // Repaint only bottom-anchored occurrences so same-coloured upper craft
        // and embroidery remain untouched.
        const directionOldColor = oldColor.toLowerCase() === baseMainColor.toLowerCase() ? mainColor : oldColor;
        if (!directionOldColor) continue;
        const token = escapeRegExp(directionOldColor);
        updated = updated
          .replace(new RegExp(`(?<![\\p{L}\\p{N}_])${token}(?=\\s+${bottomGarment}\\b)`, "giu"), bottomWearColor)
          .replace(new RegExp(`(\\b(?:in|of)\\s+)${token}(?=\\s+${bottomFabric}\\b)`, "giu"), `$1${bottomWearColor}`);
      }
    }
    return updated;
  };
  // Product identity is generation-visible garment truth, but provenance and
  // canonical classifiers are not prose to repaint. Bottom wear needs its own
  // colour below because it may differ from the upper garment's colourway.
  const protectedProductFields = new Set([
    "garmentFamily", "category", "type", "state", "sourceRole", "source_role",
    "evidenceRole", "evidence_role", "referenceRole", "reference_role",
    "evidenceReferences", "evidence_references", "bottomWearDetails",
  ]);
  const recolorProductValue = (value: unknown): unknown => {
    if (typeof value === "string") return replaceBaseColor(value);
    if (Array.isArray(value)) return value.map(recolorProductValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      protectedProductFields.has(key) ? child : recolorProductValue(child),
    ]));
  };
  cloned.productIdentity = recolorProductValue(cloned.productIdentity) as typeof cloned.productIdentity;

  if (mainColor) cloned.productIdentity.mainColor = mainColor;
  if (secondaryColors.length) cloned.productIdentity.secondaryColors = secondaryColors;
  if (cloned.productIdentity.patternGeometry && accentColors.length) {
    cloned.productIdentity.patternGeometry.accentColors = accentColors;
  }

  if (currentBottom) {
    if (bottomWearColor) {
      // Replace the previous dominant bottom colour in its recorded position;
      // cut, pleats, print, hem and differently coloured accent prose survive.
      const withoutOldVariantSuffix = currentBottom.replace(/\s*\(Variant Colorway:\s*[^)]*\)/gi, "").trim();
      let updatedBottom = replaceColor(withoutOldVariantSuffix, baseMainColor, bottomWearColor);
      for (const oldColor of recordedBottomColors(withoutOldVariantSuffix)) {
        updatedBottom = replaceColor(updatedBottom, oldColor, bottomWearColor);
      }
      if (!hasDominantBottomColor(updatedBottom, bottomWearColor)) {
        updatedBottom = `${updatedBottom}${updatedBottom ? " " : ""}(Variant Colorway: ${bottomWearColor})`;
      }
      cloned.productIdentity.bottomWearDetails = updatedBottom;
    } else {
      cloned.productIdentity.bottomWearDetails = replaceBaseColor(currentBottom);
    }
  }

  if (cloned.productIdentity.sareeTruth) {
    if (mainColor) {
      cloned.productIdentity.sareeTruth.body.baseColor = mainColor;
      cloned.productIdentity.sareeTruth.borders.borderColors = secondaryColors.length ? secondaryColors.join(", ") : mainColor;
      cloned.productIdentity.sareeTruth.pallu.baseColor = mainColor;
    }
    if (secondaryColors.length) cloned.productIdentity.sareeTruth.body.secondaryColors = secondaryColors;
  }

  if (cloned.creativeDirection && mainColor) {
    cloned.creativeDirection.closeupHeroDetail = replaceBaseColor(cloned.creativeDirection.closeupHeroDetail);
  }
  if (cloned.creativeDirection?.showcasePlan && mainColor) {
    cloned.creativeDirection.showcasePlan = {
      ...cloned.creativeDirection.showcasePlan,
      heroFeature: replaceDirectionColor(cloned.creativeDirection.showcasePlan.heroFeature),
      whyItSells: replaceDirectionColor(cloned.creativeDirection.showcasePlan.whyItSells),
      framing: replaceDirectionColor(cloned.creativeDirection.showcasePlan.framing),
      cameraAngle: replaceDirectionColor(cloned.creativeDirection.showcasePlan.cameraAngle),
      bodyPosition: replaceDirectionColor(cloned.creativeDirection.showcasePlan.bodyPosition),
      handPlacement: replaceDirectionColor(cloned.creativeDirection.showcasePlan.handPlacement),
      expression: replaceDirectionColor(cloned.creativeDirection.showcasePlan.expression),
      distinctFrom: replaceDirectionColor(cloned.creativeDirection.showcasePlan.distinctFrom),
      visibilityRules: cloned.creativeDirection.showcasePlan.visibilityRules.map(replaceDirectionColor),
    };
  }

  if (Array.isArray(cloned.posePlan) && mainColor) {
    cloned.posePlan = cloned.posePlan.map((pose) => ({
      ...pose,
      title: replaceDirectionColor(pose.title),
      description: replaceDirectionColor(pose.description),
      cameraAngle: replaceDirectionColor(pose.cameraAngle),
      framing: replaceDirectionColor(pose.framing),
      bodyPosition: replaceDirectionColor(pose.bodyPosition),
      handPlacement: replaceDirectionColor(pose.handPlacement),
      expression: replaceDirectionColor(pose.expression),
      purpose: replaceDirectionColor(pose.purpose),
      consistencyNotes: replaceDirectionColor(pose.consistencyNotes),
      prompt: replaceDirectionColor(pose.prompt),
      highlightedDetails: pose.highlightedDetails.map(replaceDirectionColor),
      productVisibilityRules: pose.productVisibilityRules.map(replaceDirectionColor),
    }));
  }

  return cloned;
}

const VALID_ASPECT_RATIOS = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"]);

/**
 * Normalize an output aspect ratio string into a supported catalog ratio (defaulting to "3:4").
 */
export function resolveAspectRatioLabel(aspectRatio?: unknown): string {
  const cleaned = String(aspectRatio || "").trim();
  return VALID_ASPECT_RATIOS.has(cleaned) ? cleaned : "3:4";
}

export type AspectRatioOrientation = "square" | "portrait" | "landscape";

/**
 * Determine whether a supported aspect ratio represents square, portrait, or landscape framing,
 * matching the dimensions selected by `normalizeImageSize`.
 */
export function resolveAspectRatioOrientation(aspectRatio?: unknown): AspectRatioOrientation {
  const ratio = resolveAspectRatioLabel(aspectRatio);
  const [wStr, hStr] = ratio.split(":");
  const w = Number(wStr);
  const h = Number(hStr);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    if (w === h) return "square";
    return w > h ? "landscape" : "portrait";
  }
  return "portrait";
}

/**
 * Rewrite framing/orientation uses of "square" into aspect-safe phrasing when
 * generating non-1:1 portrait/landscape outputs, without ever altering garment
 * construction phrases like "square neckline" or "square yoke".
 */
export function normalizePoseAspectText(text: string, aspectRatio?: unknown): string {
  const value = String(text || "");
  if (!value) return value;
  const ratio = resolveAspectRatioLabel(aspectRatio);
  const orientation = resolveAspectRatioOrientation(ratio);
  if (orientation === "square") return value;
  return value
    .replace(/^\s*square\.?\s*$/i, `${ratio} ${orientation}, head-to-toe.`)
    .replace(/\bSquare,\s*(unobstructed\b)/g, "Straight-on, $1")
    .replace(/\bsquare,\s*(unobstructed\b)/g, "straight-on, $1")
    .replace(/\b(Photorealistic|Studio|Editorial|Full-body|Catalog)\s+square\s+(head-to-toe|full[- ]front|portrait|hero)\b/gi, `$1 ${ratio} ${orientation} $2`)
    .replace(/\bSquare,?\s+(head-to-toe|full[- ]front)\b/g, "Straight-on $1")
    .replace(/\bsquare,?\s+(head-to-toe|full[- ]front)\b/g, "straight-on $1")
    .replace(/\bSquare-on\b/g, "Straight-on")
    .replace(/\bsquare-on\b/g, "straight-on")
    .replace(/\bSquare\s+to\s+camera\b/g, "Straight-on toward camera")
    .replace(/\bsquare\s+to\s+camera\b/g, "straight-on toward camera")
    .replace(/\bSquare\s+front\s+hero\b/g, "Straight-on front hero")
    .replace(/\bsquare\s+front\s+hero\b/g, "straight-on front hero")
    .replace(/\bsquare\s+framing\b/gi, `${ratio} ${orientation} framing`);
}

/**
 * Return a shallow copy of a pose direction object with aspect-contradictory
 * "square" framing/pose phrasing normalized for the requested output aspect ratio.
 */
export function sanitizePoseDirectionForAspectRatio<T>(pose: T, aspectRatio?: unknown): T {
  if (!pose || typeof pose !== "object") return pose;
  const ratio = resolveAspectRatioLabel(aspectRatio);
  if (ratio === "1:1") return pose;
  const record = pose as Record<string, unknown>;
  const fields = ["framing", "bodyPosition", "description", "prompt", "title", "purpose"] as const;
  let next: Record<string, unknown> | null = null;
  for (const field of fields) {
    const raw = record[field];
    if (typeof raw !== "string" || !raw) continue;
    const normalized = normalizePoseAspectText(raw, ratio);
    if (normalized !== raw) {
      if (!next) next = { ...record };
      next[field] = normalized;
    }
  }
  return (next as T) ?? pose;
}

const FULL_LENGTH_FRAMING_PATTERN = /\b(?:full[-_ ]body|full[-_ ]length|head[- ]to[- ]toe|head[- ]to[- ]hem|head[- ]to[- ]feet)\b/i;
const NEGATED_FULL_LENGTH_PATTERN = /\b(?:never|no|not|avoid|without|do\s+not|don't)\b[^.;,\n]{0,25}?\b(?:full[-_ ]body|full[-_ ]length|head[- ]to[- ]toe|head[- ]to[- ]hem|head[- ]to[- ]feet)\b/gi;
const ABOVE_ANKLE_CROP_TERM = "(?:knees?-up|knee-up|mid-?calf|below-?knee|mid-?thigh|thigh-up|waist-up|hip-up|bust-up|half-?body|upper-?body|editorial\\s+waist\\s+crop|(?:three-quarter|3\\/4)\\s+(?:body\\s+)?crop)";
const NEGATABLE_CROP_TERM = `(?:${ABOVE_ANKLE_CROP_TERM}(?:\\s+crop(?:ped|s)?)?|macro(?:[-_ ]?detail)?(?:\\s+(?:crops?|shots?))?|close[-_ ]?ups?(?:\\s+(?:crops?|shots?))?|half[-_ ]?body[-_ ]?detail|crop(?:ped|s)?)`;
const NEGATED_CROP_CLAUSE_PATTERN = new RegExp(
  `\\b(?:never|no|not|avoid|without|do\\s+not|don't|rather\\s+than|instead\\s+of)\\b[^.;,\\n]{0,40}?\\b${NEGATABLE_CROP_TERM}(?:\\s*(?:,|/|\\bor\\b|\\band\\b)\\s*(?:a\\s+|an\\s+)?\\b${NEGATABLE_CROP_TERM})*\\b`,
  "gi",
);
const ABOVE_ANKLE_CROP_PATTERN = new RegExp(`\\b${ABOVE_ANKLE_CROP_TERM}\\b`, "i");
const TIGHT_CROP_PATTERN = /\b(?:macro(?:[-_ ]?detail)?|close[-_ ]?up|bust[-_ ]?up|waist[-_ ]?up|half[-_ ]?body(?:[-_ ]?detail)?|upper[-_ ]?body)\b/i;
const FEET_GROUNDED_CLAUSE_PATTERN = /(?:\bwith\s+)?\b(?:both\s+)?feet\s+(?:stay\s+)?(?:grounded|planted)(?:\s+and\s+close)?\b/gi;

function stripNegatedCropClauses(value: unknown): string {
  return String(value ?? "").replace(NEGATED_CROP_CLAUSE_PATTERN, " ");
}

function matchesPlannedFramingPattern(pose: unknown, pattern: RegExp): boolean {
  if (!pose || typeof pose !== "object") return false;
  const record = pose as Record<string, unknown>;
  const framing = stripNegatedCropClauses(record.framing);
  if (pattern.test(framing)) return true;
  if (FULL_LENGTH_FRAMING_PATTERN.test(framing.replace(NEGATED_FULL_LENGTH_PATTERN, " "))) return false;
  const combined = `${framing} ${stripNegatedCropClauses(record.description)} ${stripNegatedCropClauses(record.prompt)}`;
  return pattern.test(combined);
}

/** Return true when a pose's planned framing intentionally crops above the ankles. */
export function isAboveAnkleCropFraming(pose: unknown): boolean {
  return matchesPlannedFramingPattern(pose, ABOVE_ANKLE_CROP_PATTERN);
}

/** Return true when a pose's planned framing is a tight macro or upper-body crop. */
export function isTightCropFraming(pose: unknown): boolean {
  return matchesPlannedFramingPattern(pose, TIGHT_CROP_PATTERN);
}

/** Strip contradictory grounded-feet clauses from pose copy framed above the ankles. */
export function stripGroundedFeetForCroppedFrame(text: string): string {
  return text
    .replace(FEET_GROUNDED_CLAUSE_PATTERN, "")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/[,;]\s*([.])/g, "$1")
    .replace(/\.\s*\./g, ".")
    .replace(/^[\s,;:.–—-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}


