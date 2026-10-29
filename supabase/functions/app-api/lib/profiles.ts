export type JsonRecord = Record<string, unknown>;

import {
  effectiveShowcaseShot,
  normalizeShowcasePlan,
  showcaseAestheticDirection,
  type ShowcasePlan,
  showcaseShotDirection,
  type ShowcaseShotType,
} from "./showcaseFeature.ts";
import {
  classifyBottomCut,
  detectGarmentPoseFamily,
  FARSHI_SILHOUETTE_STRUCTURE,
  type GarmentPoseFamily,
  hasBottomWearInAnalysis,
  isSareePoseFamily,
  normalizeBottomWearMode,
  recordedBottomWearText,
  resolveBottomWearPresentation,
} from "./garmentPoses.ts";
import { isNonProductEvidenceRole } from "./referencePolicy.ts";

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

function joinedCreativeText(creative: JsonRecord | undefined) {
  if (!creative) return "";
  return Object.values(creative)
    .filter((value) => typeof value === "string" || typeof value === "boolean" || typeof value === "number")
    .map((value) => String(value))
    .join(" ");
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
  const recorded = args.creative?.seatedPoseRequired ?? args.creative?.seated_pose_required;
  if (isYesDirectionFlag(recorded)) return true;
  // User notes can still demand sitting even when analysis recorded "no".
  if (SITTING_POSE_RE.test(String(args.productDetails ?? ""))) return true;
  // An explicit "no" must win over leftover "seated" wording in seatedPoseReason or styling notes.
  if (String(recorded ?? "").trim() && normalizeYesNoFlag(recorded) === "no") return false;
  if (SITTING_POSE_RE.test(joinedPoseText(args.pose))) return true;
  if (SITTING_POSE_RE.test(String(args.stylingNotes ?? ""))) return true;
  const creative = args.creative && typeof args.creative === "object" ? { ...args.creative } : {};
  delete creative.seatedPoseRequired;
  delete creative.seated_pose_required;
  delete creative.seatedPoseReason;
  delete creative.seated_pose_reason;
  return SITTING_POSE_RE.test(joinedCreativeText(creative));
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
    description: `A frame built around ${feature}${plan.whyItSells ? ` - ${plan.whyItSells}` : ""}${
      garmentDetails.summary ? ` (${garmentDetails.summary})` : ""
    }. ${aestheticDirection}`,
    highlightedDetails: [feature, plan.featureRegion.replace(/_/g, " "), ...garmentDetails.highlights].slice(0, 6),
    primaryReference: plan.evidenceReference || (isSareePoseFamily(family) ? "saree_front_drape" : "front"),
    purpose: plan.whyItSells || "Sell the detail that makes this product worth buying",
    prompt: `Create a catalog frame built entirely around ${feature}. ${shotDirection} ${aestheticDirection} ${
      garmentDetails.summary ? `Verified garment details to render with 100% fidelity: ${garmentDetails.summary}. ` : ""
    }${
      shot.widenedFromCloseup
        ? "Shoot it at this wider distance so it reads on the worn garment rather than as a repeat of the detail crop. "
        : ""
    }${
      plan.distinctFrom ? `It must differ from the other frames: ${plan.distinctFrom} ` : ""
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
  const frontBottomRule = farshiBottom
    ? "exact Farshi structure: three waist pleats each side, one large side-joint pleat each side, 6-inch joined hem with a 4-inch taper; never palazzo, lehenga, skirt, or a gathered salwar cuff; motifs stay at recorded scale"
    : "exact authentic bottom wear cut, volume, and print strictly preserved (farshi must never flatten into palazzo/lehenga/skirt; large motifs must never become solid or dots)";
  const angledBottomRule = farshiBottom
    ? "Farshi structure stays readable from the side: soft structured drape, three waist pleats each side, one large pleat at each side joint, and the 6-inch joined hem with its 4-inch taper; never a palazzo, lehenga, or dhoti"
    : "authentic bottom wear cut, leg volume, and print strictly preserved - never flattened into palazzo/lehenga or tapered into dhoti";
  const rearBottomRule = farshiBottom
    ? "Farshi from the rear keeps two legs, three waist pleats each side, one large pleat at each side joint, and the 6-inch joined hem with its 4-inch taper; never a skirt, open palazzo hem, or gathered salwar cuff"
    : "exact bottom wear cut, volume, and print visible from rear - never flattened, never a skirt, never gathered into cuffs";

  return [
    {
      id: "full_front",
      title: "Full Front Product View",
      framing: "3:4 portrait, head-to-toe with footwear and garment hem fully inside frame",
      bodyPosition: "Square to camera with balanced weight and a natural, relaxed catalog stance establishing full outfit silhouette from head to hem; feet naturally spaced, arms relaxed, never stiff or robotic",
      handPlacement: "Hands relaxed beside the body without covering neckline, waist, pockets, or trims",
      expression: "Natural, warm, approachable expression with a soft, genuine smile or calm composed glance; never a forced, stiff, or artificial toothy smile",
      productVisibilityRules: [
        "front construction unobstructed",
        frontBottomRule,
        "complete bottom wear visible from waist to hem",
        "no garment detail hidden by hands or hair",
      ],
      consistencyNotes: "Establish the model, face, hair, accessories, footwear, scene, lighting, and color-treatment anchor for poses 2-5",
      description: "Straight-on full-body hero view with the complete product readable from head to hem.",
      cameraAngle: "Eye-level straight-on full-body",
      highlightedDetails: ["front construction", "overall silhouette", "complete outfit"],
      primaryReference: "front",
      purpose: "Primary e-commerce listing image",
      prompt: "Create a straight-on full-body front hero image. Show the complete outfit, preserving the authentic bottom wear silhouette (exact cut, volume, two distinct legs, pleating, and hem) plus the exact bottom-wear print and footwear, with a natural, effortless, composed catalog stance and a realistic, natural expression (not a forced or artificial smile).",
      enabled: true,
    },
    {
      id: "angled",
      title: isSaree ? "Professional Drape & Fall View" : "Professional Side / 3/4 View",
      framing: "3:4 portrait, full-body with clear side silhouette and no crop at hem or footwear",
      bodyPosition: "Rotate torso and hips together 35 to 45 degrees into an intentional three-quarter angle, both feet planted and close, clearly displaying the side silhouette, garment depth, side seam, and sleeve drape without a walking stride or a lifted foot; do not stand flat-on to the camera",
      handPlacement: "Keep hands away from the side seam, sleeve shape, pockets, waist treatment, and drape being demonstrated",
      expression: "Same recognizable face and styling, with a relaxed, natural, and effortless glance following the three-quarter angle; authentic soft smile or composed editorial look, never an exaggerated or frozen stock smile",
      productVisibilityRules: isSaree
        ? ["drape depth and pallu fall clearly visible", "silhouette is not compressed", "bottom wear remains unchanged and visible"]
        : [
          "front and side construction remain readable",
          "silhouette is not compressed",
          angledBottomRule,
          "bottom wear remains unchanged and visible",
        ],
      consistencyNotes: "Use Pose 1 only as the model and shoot anchor; preserve the original product references as garment truth",
      description: isSaree ? "A professional three-quarter or side view that reveals the drape depth, pleat structure, and pallu fall." : "A professional three-quarter or side view that reveals depth, drape, fit, and side construction.",
      cameraAngle: "Eye-level 35-50 degree three-quarter view",
      highlightedDetails: isSaree ? ["drape depth", "pallu fall", "pleats"] : ["side silhouette", "fit", "drape and construction"],
      primaryReference: "front",
      purpose: "Show garment depth and fit",
      prompt: "Create an intentional 35-to-45 degree three-quarter fashion pose that is visibly and physically turned from the hero pose, with both feet planted and close so a joined hem stays closed. Reveal side silhouette, drape depth, and sleeve shape while keeping the full outfit readable and preserving authentic bottom wear. Never a walking stride or a lifted foot. Model has a relaxed, natural glance and realistic, effortless expression — never a stiff stance or artificial smile.",
      enabled: true,
    },
    {
      id: "back",
      title: "Full Back View",
      framing: "3:4 portrait, head-to-toe true rear view with the full back and hem visible",
      bodyPosition: "Model faces fully away from camera with shoulders and hips square, weight relaxed and natural; no three-quarter cheat",
      handPlacement: "Hands placed naturally where they do not cover the back neckline, closure, embroidery, waist, or rear silhouette",
      expression: "Face is not forced toward camera; preserve identity through hair, body, and styling continuity; if glancing back, face and profile must match identity anchor with a natural, effortless look",
      productVisibilityRules: isSaree
        ? ["uploaded back image is the sole back-design authority", "rear drape and pallu fall visible", "exact same backdrop wall, floor, and lighting from Pose 1 - zero new props"]
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
      prompt: "Turn the model fully away from camera to capture the authentic rear garment design from the uploaded back reference. For outfits with a dupatta, shawl, or stole, drape it forward over the arms or front so the back panel, neckline, embroidery, seams, and fit remain 100% unobstructed and clearly visible. Preserve the exact model identity, styling, and the identical studio set, wall color, and lighting established in Pose 1.",
      enabled: true,
    },
    {
      id: "creative",
      title: "Natural Editorial Pose",
      framing: "3:4 portrait with a garment-appropriate full or three-quarter body editorial crop",
      bodyPosition: "Relaxed editorial stance that is clearly not the hero pose: contrapposto or a soft three-quarter lean, both feet grounded and close so hems and pleats stay intact, or an elegant seated posture on a low studio bench/step when the style reference is seated; never a frozen walking stride or a wide leg split",
      handPlacement: "Relaxed and intentional; hands must not cover the garment's key selling features or change its apparent shape",
      expression: "Calm, natural warmth — a small genuine smile or an easy glance; never a frozen laugh or an artificial grin",
      productVisibilityRules: isSaree
        ? ["product remains the visual subject", "creative movement highlights fabric fluidity and pallu", "no prop or limb hides key drape features", "if seated, drape and pleats remain clean and readable"]
        : [
          "product remains the visual subject",
          "no prop or limb hides key construction",
          "creative movement does not alter bottom wear cut, leg volume, fit, or silhouette",
          "if seated on a bench or architectural step, both trouser legs and footwear remain visible, unbunched, and fully displayed",
        ],
      consistencyNotes: "Borrow only art direction, backdrop, and jewellery/ornament taste from style references; garment, bottom wear, footwear, accessories that ship with the product, model, and shoot continuity remain locked",
      description: "A natural editorial pose that follows the selected creative direction (relaxed standing stance, or seated when the style reference is seated) without hiding the garment.",
      cameraAngle: "Product-appropriate editorial angle",
      highlightedDetails: isSaree ? ["fabric movement", "fluidity", "creative direction"] : ["movement", "silhouette", "creative direction"],
      primaryReference: "front",
      purpose: "Campaign and social-commerce storytelling",
      prompt: "Create a natural editorial catalog frame that is clearly not the hero pose — a relaxed contrapposto or soft three-quarter lean with both feet grounded and close, so hems and pleats stay intact (or an elegant seated pose on a minimal studio bench/step if the style reference shows a sitting pose). Never a frozen walking stride, a spin, or a wide leg split. Use a calm, natural expression. Preserve the complete product, bottom wear silhouette, and footwear. Rebuild the photoshoot backdrop, wall, floor, lighting, and jewellery from the style reference only - never from product-photo backgrounds.",
      enabled: true,
    },
    {
      id: "closeup",
      title: "Zoomed-In Product Detail Highlight",
      framing: "3:4 portrait, genuinely zoomed in - either a face-to-chest/face-to-waist crop with a LARGE readable product detail, or a tighter product-detail crop when a full face would make that detail too small - never a repeat of the full-body hero",
      bodyPosition: "Natural, relaxed upper-body or detail-crop angle that keeps the chosen selling detail large and sharp; include the face only when that still leaves the detail catalog-readable",
      handPlacement: "Hands relaxed and natural - resting near the highlighted detail without covering it, or away from frame if the detail is elsewhere",
      expression: "When the face is in frame: a soft, beautiful, natural expression with authentic warmth, gentle lips, and relaxed eyes; never a forced or exaggerated smile. When the crop is product-detail-first: expression is optional because the face may be partial or omitted",
      productVisibilityRules: [
        "the named product selling detail is large, sharp, and unobstructed - this is the subject of the frame",
        "never a full-body or wide hero repeat",
        "include a sharp face-to-chest or face-to-waist pairing only when that crop still makes the detail readable",
        "if embroidery, neckline craft, print scale, pallu/border, or fabric texture would be too small beside a full face, crop to the product detail instead of the face",
      ],
      consistencyNotes: "Keep the same identity, hair, makeup, jewellery, footwear, scene, lighting, and product truth from Pose 1; only the crop tightens around the selling detail",
      description: "A zoomed-in shot that sells the product's most important real detail, with the face included only when it does not shrink that detail.",
      cameraAngle: "Eye-level, zoomed in to a product-detail crop or a face-to-chest/face-to-waist crop that still leaves the detail large",
      highlightedDetails: ["key product detail", "craftsmanship", "optional face"],
      primaryReference: "fabric_pattern",
      purpose: "Social-first product-detail shot that can also include the face when the craftsmanship stays readable",
      prompt: "Create a genuinely zoomed-in product-detail photograph - clearly tighter than the full-body hero, never a repeat of it. Lead with one sharp, large, catalog-readable highlight of the product's most important real detail (embroidery, neckline, drape, print scale, or fabric texture). If the face is in frame it must be the locked model identity with a calm natural expression, in a face-to-chest or face-to-waist crop only when that still leaves the detail large. If a full face would make the selling detail too small, crop to the product detail and let the face be partial or omitted.",
      enabled: true,
    },
    showcaseShot
      ? showcaseSlotFromPlan(showcaseShot.plan, family, showcaseShot, context.productIdentity, hasBottoms)
      : showcaseSlot(family, hasBottoms, context.productIdentity),
  ];
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

export function parseJsonResponse(text: string): JsonRecord {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
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

export function normalizeAnalysis(raw: JsonRecord, categoryFallback: string, options: { bottomWearMode?: unknown } = {}) {
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
    propUsage: stringValue(creative.propUsage ?? creative.prop_usage, "No distracting props"),
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
    seatedPoseRequired: normalizeYesNoFlag(creative.seatedPoseRequired ?? creative.seated_pose_required, "no"),
    seatedPoseReason: stringValue(creative.seatedPoseReason ?? creative.seated_pose_reason, ""),
    closeupMode: normalizeCloseupMode(creative.closeupMode ?? creative.closeup_mode),
    closeupHeroDetail: stringValue(creative.closeupHeroDetail ?? creative.closeup_hero_detail, ""),
    showcaseIntent: normalizeShowcaseIntent(creative.showcaseIntent ?? creative.showcase_intent),
    showcasePlan: normalizeShowcasePlan(
      raw.showcasePlan ?? raw.showcase_plan ?? creative.showcasePlan ?? creative.showcase_plan,
    ),
  };
  const modelIdentity = {
    castingDirection: stringValue(model.castingDirection ?? model.casting_direction, "One consistent adult fashion model across every image in the set, reading as a youthful young adult with a naturally pretty, warm, approachable face"),
    face: stringValue(model.face, "Keep the exact same recognizable face across the complete set - identical face shape, eyes, eyebrows, nose, lips, and jawline as established in Pose 1"),
    faceRealism: stringValue(
      model.faceRealism ?? model.face_realism,
      "Photorealistic human face: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry (not mirror-symmetric), anatomically correct eyes with realistic catchlights and correctly aligned gaze, and naturally aligned teeth (not uniformly perfect, no extra or missing teeth). Never plastic, waxy, airbrushed, doll-like, or synthetic-looking.",
    ),
    hair: stringValue(model.hair, "Keep one hairstyle across the complete set"),
    makeup: stringValue(model.makeup, "Keep makeup consistent and natural"),
    bodyProportions: stringValue(model.bodyProportions ?? model.body_proportions, "Keep realistic body proportions identical across poses"),
    stylingLock: stringValue(model.stylingLock ?? model.styling_lock, "Keep footwear and accessories identical across every pose"),
  };
  const poses = Array.isArray(rawPoses) ? rawPoses : [];
  const poseContext = {
    productIdentity,
    garmentFamily: productIdentity.garmentFamily,
    category: productIdentity.category || categoryFallback,
    bottomWearMode: options.bottomWearMode,
    showcasePlan: creativeDirection.showcasePlan,
    closeupHeroDetail: creativeDirection.closeupHeroDetail,
  };
  const poseSlots = getPoseSlots(poseContext);
  const showcaseFamily = poseFamilyFor(poseContext);
  const showcaseBottomPresentation = resolveBottomWearPresentation({
    mode: options.bottomWearMode,
    productIdentity,
  });
  const showcaseIncludesBottomWear = showcaseBottomPresentation.includesBottomWear || (
    normalizeBottomWearMode(options.bottomWearMode) !== "top_only" &&
    (showcaseFamily === "kurta_set" || showcaseFamily === "lehenga")
  );
  const posePlan: StudioPose[] = poseSlots.map((fallback, index) => {
    const candidate = objectValue(poses.find((pose) => objectValue(pose).id === fallback.id) ?? poses[index]);
    return {
      id: fallback.id, title: stringValue(candidate.title ?? candidate.name, fallback.title),
      description: stringValue(candidate.description, fallback.description),
      cameraAngle: stringValue(candidate.cameraAngle ?? candidate.camera_angle, fallback.cameraAngle),
      framing: stringValue(candidate.framing, fallback.framing),
      bodyPosition: stringValue(candidate.bodyPosition ?? candidate.body_position, fallback.bodyPosition),
      handPlacement: stringValue(candidate.handPlacement ?? candidate.hand_placement, fallback.handPlacement),
      expression: stringValue(candidate.expression, fallback.expression),
      highlightedDetails: stringArray(candidate.highlightedDetails ?? candidate.highlighted_details, [...fallback.highlightedDetails]),
      productVisibilityRules: stringArray(candidate.productVisibilityRules ?? candidate.product_visibility_rules, [...fallback.productVisibilityRules]),
      primaryReference: stringValue(candidate.primaryReference ?? candidate.primary_reference, fallback.primaryReference),
      purpose: stringValue(candidate.purpose, fallback.purpose),
      consistencyNotes: stringValue(candidate.consistencyNotes ?? candidate.consistency_notes, fallback.consistencyNotes),
      prompt: stringValue(candidate.prompt, fallback.prompt), enabled: candidate.enabled !== false,
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
  });
  const stylingPlan = normalizeStylingPlan(raw.stylingPlan ?? raw.styling_plan);
  return { productIdentity, creativeDirection, modelIdentity, stylingPlan, posePlan };
}

export function buildCombinedAnalysisPrompt(args: {
  skuName: string; productDetails: string; category: string; modelDirection: string; sceneDirection: string;
  referenceManifest: Array<{ number: number; role: string }>; housePreferences?: string; fashionKnowledge?: string;
  analysisLearning?: string; showcaseFeedback?: string;
}) {
  const manifest = args.referenceManifest.map(({ number, role }) => `IMAGE ${number}: ${role}`).join("\n");
  const hasBottomRef = args.referenceManifest.some((m) => m.role === "bottom" || /bottom/i.test(m.role));
  const isFarshiSku = hasBottomRef || /farshi|farsi/i.test(`${args.skuName} ${args.productDetails}`);
  return `You are the visual merchandiser and shoot planner for a fashion e-commerce studio.

Analyze EVERY supplied image before answering.
${manifest}

REFERENCE AUTHORITY (highest to lowest):
1. MODEL FACE REFERENCE (if supplied) - the exact, non-negotiable face and identity for the model. Overrides any face you would otherwise design.
2. Region-specific SAREE PRODUCT references (when supplied) - FULL FRONT DRAPE, REAR/BACK DRAPE, BODY/WEAVE DETAIL, FULLY SPREAD PALLU, BORDER/TASSELS and BLOUSE references are each authoritative for their named physical region. A pallu-spread image is pallu truth, never a generic fabric image.
3. FRONT PRODUCT - legacy authoritative front product design.
4. BACK PRODUCT - legacy authoritative back design; never infer the back from the front.
5. FABRIC / PATTERN DETAIL - legacy high-priority truth for UPPER-garment weave, texture, print, embroidery, stitching, trims, and construction; it does not prove pallu artwork and does not prove bottom-wear print unless the image itself shows the trousers/skirt.
6. MANNEQUIN / FLAT-LAY SHOT - on a mannequin or dress form, authoritative for worn shape, fit, proportion and drape; laid flat, authoritative for outline, construction, panel layout and length only, since flat cloth shows no worn drape.
7. BOTTOM WEAR / FARSHI - when supplied, pixel-level authority for the trousers/skirt cut, volume, hem, color and print. Never copy upper-garment embroidery onto this panel.
8. ADDITIONAL PRODUCT - another source of product truth, including supporting bottom-wear evidence.
9. STYLE REFERENCE - creative direction only. From the style reference, take the photoshoot background/backdrop, framing, and lighting for all six poses. Do not copy that photo's pose, stance, or handheld props into any pose. Take the model face from that image only when no MODEL FACE REFERENCE is supplied; when a MODEL FACE REFERENCE is supplied, discard the style-reference face, hair, and body. ABSOLUTE PROHIBITION ON COPYING THE PRODUCT FROM THE STYLE REFERENCE: The clothing, outfit, saree, dress, fabric, color, prints, or embroidery worn by the person in the style reference MUST BE 100% DISCARDED. Absolutely DO NOT copy, reproduce, or borrow the style reference's clothing. The product itself must stay based exclusively on uploaded product images and must not be redesigned. Never copy its garment, product color, bottoms, logos, or accessories.

Product references are frequently flat-lay, folded, pinned, or shot on a mannequin or dress form. Read the garment through that presentation: infer how each panel, hem, sleeve and closure behaves once it is worn on a live human body, and record that in the profile. The mannequin, dress form, hanger, clips, pins and the flat surface are photography apparatus, never part of the product - never describe them as garment features and never let them appear in the pose plan.

First, determine the garmentFamily from the references: "kurta_or_kurti_set", "saree", "dress", "western_or_casual", or "other".

SKU: ${args.skuName}
Declared category: ${args.category}
User product notes: ${args.productDetails}
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
A dedicated "BOTTOM WEAR / FARSHI" reference is present in the manifest (or this SKU is designated Farshi).
The bottom wear in this SKU is AUTHORITATIVELY CLASSIFIED AS "Farshi / Farshi Pajama / Farshi Pants" (NEVER Palazzo).
Record this structure in bottomWearDetails (classification, waistAndPleating, legVolume, and hemline). Print, colour, motif scale, and length still come from the references. Do not replace this construction with a palazzo, a skirt, or a gathered salwar cuff.
${FARSHI_SILHOUETTE_STRUCTURE}
You MUST record 'productIdentity.bottomWearDetails.classification' as "Farshi / Farshi Pajama / Farshi Pants".
You are STRICTLY FORBIDDEN from classifying it as Palazzo, and you must NEVER write "NOT Farshi".
Under negativeConstraints, explicitly state: "NOT palazzo, NOT tubular straight pants, NOT lehenga, NOT skirt, NOT sharara, NOT gharara, NOT churidar, NOT a gathered salwar poncha, NOT an open palazzo hem".
Do NOT write "NOT tapered" or "NOT gathered into an ankle cuff" for this Farshi. The 4-inch hem taper and the joined 6-inch hem panel are part of the silhouette.
` : ""}
1. EXACT CUT & CLASSIFICATION: Explicitly classify the cut from the worn silhouette in the references, not from a generic ethnic-wear prior:
   - "Farshi / Farsi / Farshi Pajama / Farshi Pants": Two distinct trouser legs with this construction only: ${FARSHI_SILHOUETTE_STRUCTURE} Length may be ankle-length (clearing the floor to display footwear) or floor-length as the references show. Hem embellishment (lace, print band, or a plain finish) is whatever the references show on that joined hem panel — do not invent lace. Distinct from palazzo (no three-per-side waist pleats and no joined tapered hem panel) and from Sharara (where the flare begins at or below a knee join). When a dedicated BOTTOM WEAR / FARSHI reference is supplied, or the trousers show this pleated waist and joined hem, classify as Farshi / Farshi Pajama / Farshi Pants, NOT palazzo.
   - "Palazzo": Simple standard-width straight or softly flared wide-leg trousers without farshi flared volume, gathers, or architectural flair. If a BOTTOM WEAR / FARSHI reference is attached or flared volume/lace is present, DO NOT classify as Palazzo.
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
   - For Farshi / Farsi pajama / Farshi pants: Explicitly state "NOT palazzo, NOT plain wide-leg, NOT lehenga, NOT tubular straight pants, NOT skirt, NOT dhoti pants, NOT tulip pants, NOT balloon/harem pants, NOT churidar, NOT a gathered salwar poncha, NOT an open straight hem". Do NOT state "NOT tapered at ankle" or "NOT gathered into an ankle cuff" — the Farshi hem is the joined 6-inch panel with the 4-inch taper. Also state "NOT solid/undecorated" when motifs are visible, and "NOT micro-dot/speckle print" when motifs or chevron prints are bold.
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

SCENE AUTHORITY: when a STYLE REFERENCE image is supplied, that image defines the shoot. Describe what it actually shows - wall colour and finish, floor or ground surface, every prop and its placement, plant or furniture presence, light direction and quality, camera height and distance, depth of field, colour grade - concretely enough to rebuild that set from the description alone. Never replace it with a generic "clean premium studio backdrop": a plain seamless-paper description when the reference shows a styled set is a failure of this analysis. A requested scene direction refines mood, styling and props on top of the referenced set; it does not replace the referenced backdrop. Only when no style reference is supplied does the requested scene direction define the scene by itself.
PRODUCT vs STYLE DIVISION: Product references are garment/SKU truth only (cut, colour, print, embroidery, construction). The STYLE REFERENCE is the sole authority for photoshoot backdrop, room architecture, flooring, lighting, camera, mood, AND jewellery/ornament taste when those pieces are not already part of the product. THE CLOTHING WORN IN THE STYLE REFERENCE MUST BE 100% DISCARDED; NEVER DRESS THE MODEL IN THE STYLE REFERENCE'S CLOTHING OR BORROW ITS PRINTS/COLORS. Never mix a product-photo wall, arch, urn, pot, plant, or courtyard into creativeDirection.
CRITICAL NEGATIVE RULE FOR SCENE & BACKGROUND: Product reference images (FRONT, BACK, BOTTOM, FABRIC, MANNEQUIN) frequently show the garment in an existing pre-shoot studio, outdoor location, archway, courtyard, terracotta pots/urns, plants, or furniture. You are STRICTLY FORBIDDEN from describing, extracting, or incorporating ANY background elements, walls, arches, urns, pots, plants, or furniture from the PRODUCT reference images into creativeDirection or backgroundStyle! The photoshoot scene MUST BE DERIVED 100% FROM THE STYLE REFERENCE (if supplied), or from the requested scene direction (if no style reference is supplied), or designed as a fresh, clean, elegant, neutral fashion studio.

Build a Creative Direction Profile from style references, but never allow style to alter the product. Lock one lens family, camera height, perspective, exposure, white balance, color grade, light direction, shadow behavior, set geometry, and time-of-day so the results read as contact sheets from one real professional shoot. In realismRules, explicitly require natural skin texture with visible pores, strictly exactly two arms and two hands with zero extra or duplicate limbs, anatomically correct and naturally shaped eyes and teeth, and no synthetic AI artifacts.

Define one Model Identity Profile with concrete, specific facial detail - not generic filler. Describe visible appearance attributes only; never identify, name, or infer personal attributes of anyone depicted.
CASTING BRIEF: an adult fashion model who reads as a youthful young adult - late teens to early twenties in appearance - with a naturally pretty, warm, approachable face and a genuine friendly expression rather than a severe or corporate look. Record this in modelIdentity.castingDirection. This brief describes the casting look only: when a MODEL FACE REFERENCE image is supplied, that face governs completely and must not be restyled, aged, slimmed, lightened or "improved" to fit the brief. If a MODEL FACE REFERENCE image is present in the manifest above, describe the face shape, eye shape and color, eyebrow shape, nose, lips, and jawline visible in that image in modelIdentity.face - do not design a different face, and note in modelIdentity.face that these attributes must match the reference image exactly. If no MODEL FACE REFERENCE was supplied, design one specific face and describe it with the same level of concrete detail, specific enough that the exact same person is recognizable in every pose. In modelIdentity.faceRealism, lock the photorealism bar for every pose: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry, anatomically correct eyes with realistic catchlights and correctly aligned gaze, and naturally aligned teeth (not uniformly perfect, no extra or missing teeth) - never a plastic, waxy, airbrushed, or symmetric "AI face". Lock skin tone, hair, makeup, body proportions, accessories and footwear the same way across all six images.

Overall pose energy: every one of the six poses should look like a real marketplace catalog photograph of one person in one room - relaxed, natural, and believable, never stiff, robotic, frozen mid-stride, or a wide stock-photo grin.
MODEL EXPRESSIONS & SMILES: Model expressions and smiles must look natural, relaxed, and realistic with soft lips, relaxed facial muscles, and subtle warmth, or calm composed poise. NEVER artificial, forced, stiff, wide, or frozen stock catalog smiles.

STYLING PLAN - decide what this model wears alongside the garment, and fill stylingPlan. Read both sources before choosing: the product references decide what the garment already includes, and the style reference decides the aesthetic the shoot is aiming at. State each choice specifically enough that a stylist could pull it from a shelf and repeat it identically in every frame - "oxidised silver jhumkas roughly 4 cm with a small matching cuff on the right wrist" is usable, "ethnic jewellery" is not.
- footwear: one specific pair - style, heel height, colour, finish - that suits the garment length and hem. Say if the product references already show footwear that must be kept instead.
- jewellery: PRODUCT FIRST, STYLE REFERENCE SECOND. If the product already includes jewellery, keep those pieces. Otherwise, if the STYLE REFERENCE shows jewellery/ornaments the vision analysis considers complementary (metal, count, placement) and they do not hide neckline/embroidery, lock those exact pieces into stylingPlan.jewellery. Pick the metal and family deliberately - oxidised silver, temple or antique gold, polished gold, kundan or polki, pearl, contemporary minimal - and name each piece worn (earrings, neckpiece, bangles, rings, maang tikka, nose ring). Never invent a second competing jewellery story on top of the style-reference pieces, and never add a heavy neckpiece over an embroidered yoke unless the style reference clearly uses that AND the yoke remains readable. If the style reference is jewellery-free, do not add statement jewellery.
- ornaments: any remaining accessory decisions copied from the style reference when they complement this product - belt, potli or bag, dupatta drape treatment, waist chain, hair ornament - or an explicit "none" so nothing is invented later.
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
- BENGALI SAREE (tant, taant, jamdani, dhakai, garad, korial, baluchari, swarnachari, kantha, lal-paar/red-and-white, shantipuri, begumpuri, or an aatpoure/Bengali drape): elegant, upright, serene posture with level shoulders and small, deliberate movement. The pallu/aanchal must be placed exactly as recorded - correct shoulder, correct fall direction, correct visible length - and stay open and readable. Front pleats flat, evenly stacked and vertical; upper and lower borders continuous and identical in width; hem border level. Hands never cross the pallu artwork or the border.
- ETHNIC / TRADITIONAL SAREE (any other regional or occasion saree): graceful, poised, unhurried posture that never disturbs the drape. Same pallu, pleat and border discipline as above, following sareeDrapePlan exactly. Movement is controlled; the pallu is one continuous placed panel, never duplicated into extra loose cloth.
- KURTI / KURTA SET (with trousers, palazzo, sharara, gharara, salwar, churidar, skirt or any other bottom): poses must prove fit, true length, sleeve shape and the complete set. Keep the top's full length and both sleeves readable, keep the bottom wear visible waistband-to-hem, and keep any dupatta off the yoke, placket, side slit and bottom wear.
- STANDALONE LONG KURTI / KURTA: poses prove fall, fit and hem length. Never hitch, tuck or gather the hem; side seams hang straight and the hem stays level.
- SHORT KURTI / TOP / CROP: playful, natural, lively body language that interacts with the backdrop this shoot has established, while the hem line, neckline, sleeve shape, fit and print stay unobstructed.
- LEHENGA: show choli, dupatta and the complete skirt flare with the hem in frame and the skirt volume never flattened.
- DRESS / GOWN / WESTERN-CASUAL: relaxed, current body language showing the complete silhouette from shoulder to hem, hem level and inside the frame.
In every family the pose may only change body position, angle, framing and expression. It must never change the garment's design, print, motif scale, colour, fit, construction or bottom-wear silhouette.

Create exactly six product-specific camera setups in one coherent commercial coverage sequence with MANDATORY PHYSICAL VARIATION across all 6 slots, in this order and with these ids: full_front, angled, back, creative, closeup, showcase. They are NOT repeats of each other. Every pose must specify exact framing, body position, hand placement, expression, product visibility rules, reference authority, highlighted details, purpose, consistency note, and a self-contained prompt that repeats the relevant location locks and absence constraints. Every individual prompt must (1) describe THIS product's exact colour, fabric, construction and selling details from the product references, and (2) direct the model's stance, angle, action, and expression, while creativeDirection must rebuild the photoshoot backdrop, wall, floor, lighting and props from the STYLE REFERENCE only.

- full_front: square, unobstructed head-to-toe hero; establishes face/hair/styling/footwear/scene/lighting anchor with balanced weight, natural catalog composure, and an authentic gentle smile or relaxed glance (never a stiff stance or artificial smile).
- angled: mandatory 35 to 45 degree intentional turn of torso and hips with both feet planted and close, clearly revealing side construction, garment depth, side seam, and sleeve silhouette. Never a walking stride or a lifted foot, and never open a joined Farshi hem. Must be visibly turned away from flat frontal — NEVER a static frontal standing repeat! Natural, effortless glance following the angle with an authentic soft smile or composed editorial look (never an exaggerated or frozen stock smile). Do not copy the pose or the handheld props from the style or model-face photo.
- back: true head-to-toe rear view, shoulders and hips fully away; uploaded BACK is the sole rear-construction authority, or rear drape for sarees. For outfits with a dupatta or shawl, the dupatta must be draped forward over arms or front so the rear garment (neckline, back panel, embroidery, hem) is 100% unobstructed and visible. Hair swept forward or in an updo. The studio set, backdrop wall, lighting, and model identity must strictly match the other poses.
- creative:
  * SEATED POSE LOCK: Inspect the STYLE REFERENCE image first. Also inspect any other uploaded image that shows a model pose, plus the user product notes. If ANY of those show a sitting/seated person, or the notes demand sitting, set creativeDirection.seatedPoseRequired to "yes" and seatedPoseReason to a one-line evidence note (for example "style reference model is seated on a stone plinth"). Then this 4th pose MUST be an elegant seated editorial pose (minimal studio bench, architectural plinth/step, or a clean prop that already belongs to the style-reference set). Keep the garment, bottom wear, hemline, and footwear completely visible and beautifully arranged, never crumpled or hidden. Do not seat poses 1-3 or 5 just because pose 4 sits.
  * OTHERWISE (seatedPoseRequired "no"): design this 4th pose as a natural editorial stance that is clearly not the hero pose - relaxed contrapposto or a soft three-quarter lean, both feet grounded and close so hems, pleats, and a joined Farshi hem stay intact. Never a frozen walking stride, a spin, or a wide leg split. Expression is calm and genuine - a small smile or an easy glance, never a frozen laugh.
- closeup: THIS POSE SELLS PRODUCT DETAIL. First choose the single most important real selling detail from the PRIMARY UPLOADED PRODUCT GARMENT (e.g. kurti butti work, chest/yoke embroidery, neckline craftsmanship, handwork, sleeve craft, or weave) and record it in creativeDirection.closeupHeroDetail. CRITICAL: Pose 5 MUST highlight the primary garment's key signature detail (for example, if the kurti has butti work, Pose 5 must clearly showcase that work). It is STRICTLY FORBIDDEN to focus on or crop in on a secondary accessory like a dupatta, stole, or scarf when the primary garment has butti work, embroidery, or signature craft to showcase! (Only focus on a dupatta if the uploaded product is purely a standalone dupatta). Then choose framing and record it in creativeDirection.closeupMode:
  * "face_and_detail" when that detail sits at neckline/chest/yoke and stays LARGE beside the face: genuine zoomed-in face-to-chest or face-to-waist crop. Face is the locked identity with a calm natural expression (relaxed eyes, never a forced grin) AND the product detail occupies a large, catalog-readable portion of the frame - never a tiny hint of embroidery under a beauty close-up.
  * "product_detail" when a full face would shrink that selling detail below readable catalog size: crop to the product detail so it fills most of the frame. Face may be partial at the edge or omitted. Never a full-body hero repeat, and never a face-only beauty crop.
  The closeup pose prompt, framing, highlightedDetails, and productVisibilityRules MUST match that choice. highlightedDetails must lead with the product detail, not the face, when closeupMode is "product_detail".
- showcase: THE SIXTH FRAME IS DECIDED BY YOU, FROM THESE IMAGES. It must complement the other five images while showing a distinct pose from the first five, keeping the uploaded product, model, background set, and overall styling 100% consistent across all six images. It has no fixed subject. Its only job is to sell the ONE thing that makes THIS product worth buying, and it must add coverage the other five frames do not already give.
  Look at the product references and decide what a buyer would actually zoom in on or ask about. It may be an embroidered or sequinned yoke, a neckline construction, a sleeve treatment, a print's scale and repeat, the cut and flare of the bottom wear, a hem or border, a dupatta's print/border/length/drape, a saree's pallu, drape style, border or blouse, or any other genuinely distinguishing feature. Choose the single strongest one.
  Then fill showcasePlan at the JSON root:
  - heroFeature: that feature, named concretely enough to shoot it - "gold sequin square-neck yoke with scalloped edge", not "embroidery".
  - featureRegion: one of neckline, embroidery, print, sleeve, upper_garment, bottom_wear, hem_border, dupatta, pallu, drape, blouse, silhouette, complete_set, other.
  - shotType: one of macro_detail (fill the frame with the feature), half_body_detail (crop to the body section it sits on), full_body_feature (needs the whole garment - flare, length, fall), drape_feature (a held or spread panel), movement_feature (fall/flare shown in motion).
  - whyItSells: one line on why this is the feature a buyer judges this product by.
  - evidenceReference: the manifest role that proves it.
  - framing, cameraAngle, bodyPosition, handPlacement, expression: concrete aesthetic editorial photoshoot direction for that shot (include camera perspective, directional studio lighting interplay on fabric texture/embroidery, graceful posture, and strictly two-hand coordination clear of the hero feature).
  - distinctFrom: one line stating how this frame differs from BOTH pose 1 and pose 5.
  - visibilityRules: what must stay unobstructed for this feature and its exact garment specifications (colour, fabric, motif/embroidery geometry, cut/hem) to read.
  MANDATORY NON-DUPLICATION. This frame is wasted if it repeats another:
  * It must NOT be a second full-body hero. If your chosen shotType is full_body_feature, the angle, distance, stance and composition must be visibly different from pose 1, and the named feature must be unmistakably the subject rather than the whole outfit.
  * It must NOT re-shoot pose 5's subject. You have already recorded creativeDirection.closeupHeroDetail for pose 5; if the strongest feature is that same detail, either pick the next strongest feature for this frame, or keep the feature and change the distance (for example pose 5 macro on the yoke, pose 6 showing the same embroidery running across the full garment in a drape or movement frame). Say which you did in distinctFrom.
  * "Complete set", "full outfit" or "hero repeat" is only a valid heroFeature when the product genuinely has no distinguishing component - that is rare, and a coordinated set's bottom wear, dupatta or border is almost always the stronger choice.
  This frame reuses the identical model, styling, footwear, set, backdrop and lighting - only the subject, stance and framing change.

If the garmentFamily is "saree", you MUST also generate sareeTruth and sareeDrapePlan inside the JSON root.
sareeTruth: Record exact base and secondary colours; fabric family; weave/lattice geometry; texture, shine and transparency; every peacock/floral/other motif with its scale, orientation, repeat, density and placement by body/pallu/border; separate upper/lower border widths, construction and colours; the exact region where the pallu starts plus its artwork, motif density and orientation; tassel colour, construction and spacing; blouse colour/fabric/front/back/neckline/sleeves/ties/closures; and fabric weight, stiffness, fluidity and expected fall. Add regionEvidence entries with region, sourceRole, confirmed/confirmed_absent/unknown state and the same evidence fields as garmentEvidence. Unknown must stay unknown: never mirror or extrapolate decoration into an unproven region.
sareeDrapePlan: Choose a baseDrapeFamily (e.g., "shoulder-side/open-pallu" or "shoulder-side/pleated-pallu"), frontPleatTreatment, palluShoulderPlacement, handInteraction, borderVisibility, and poseSpecificDrapeState (e.g. how the angled pose shows the pallu fall).

posePlan: Design 6 distinct poses (full_front, angled, back, creative, closeup, showcase). For each, specify the cameraAngle, framing, bodyPosition, handPlacement, expression, and write a detailed photorealistic 'prompt' that combines these elements with the product and model identity.
CRITICAL: Every individual 'prompt' MUST be completely self-contained. The image generator does not see the other poses. You MUST explicitly describe the model's exact face, hair, skin tone, makeup, styling, bottom wear (exact cut, leg volume, two-leg vs skirt structure, pleating, hem, color, AND print/motif scale), and footwear inside EVERY SINGLE 'prompt' string. When the bottom is Farshi/Farsi, every prompt must repeat the Farshi structure: soft structured drape, three waist pleats on each side, one large pleat on each side joint, and a 6-inch hem panel joined to the leg with a 4-inch taper from the upper hem edge to the lower hem edge. Never describe that Farshi as untapered or cuff-less. NEVER use phrases like "consistent with previous poses", "same as full_front", or "locked scene" inside the 'prompt' string itself.
SCENE IS SHARED, NOT PER POSE: do NOT describe the background, set, walls, floor, location, props or lighting inside any pose 'prompt'. Describe the set once, concretely, in creativeDirection (backgroundStyle, studioEnvironment, propUsage, lighting, setContinuity); the generator applies that one description to all six frames. Six separate backdrop descriptions are how frames drift onto different sets - for example a back view on a different wall. The back, close-up, creative and showcase frames are the same room from another camera position.

Across all six, ONLY pose, angle, framing, and expression may change.
LOCKED DETAILS ACROSS ALL SIX IMAGES:
Lock and remember all important details across all 6 images to avoid consistency mistakes:
- Photoshoot backdrop: Exact same room architecture, wall finish, flooring, lighting, shadows, and set props from the style reference / Pose 1.
- Footwear: Exact same pair, style, heel, finish, and color across all 6 frames.
- Ornaments & jewellery: Exact same pieces, metal type, count, and placement across all 6 frames.
- Accessories & styling: Exact same bag, belt, dupatta drape treatment, hair, and makeup across all 6 frames.
- Product layout & product design: Garment construction, cuts, seams, trims, embroidery geometry, pattern repeat, and bottom-wear architecture remain locked across all 6 frames.
REFERENCE IMAGE SCOPE: Model face comes from the MODEL FACE REFERENCE when one is attached; otherwise it comes from the STYLE REFERENCE face. Backdrop, wall, floor, props, and lighting come from the STYLE REFERENCE on all six poses. Clothing comes only from the uploaded product photos. Discard the style-reference outfit, and discard every face and background inside the product photos.

Return STRICT JSON only:
{"productIdentity":{"garmentFamily":"","category":"","mainColor":"","secondaryColors":[],"fabric":"","pattern":"","print":"","patternGeometry":{"type":"","scale":"","orientation":"","density":"","repeat":"","placementByPanel":[],"accentColors":[],"motifInventory":[]},"embroideryGeometry":{"placement":"","geometry":"","motifStructure":"","scaleRelativeToGarment":"","colorsAndMaterial":"","borders":"","necklineRelation":""},"texture":"","neckline":"","sleeveType":"","length":"","fit":"","silhouette":"","frontConstruction":"","backConstruction":"","buttons":"","zippers":"","pockets":"","embroidery":"","logos":"","accessoriesIncluded":"","bottomWearDetails":"","footwearDetails":"","detailPlacementMap":[],"absenceConstraints":[],"invariantDetails":[],"uncertaintyNotes":[],"garmentEvidence":[{"region":"","state":"unknown","visibleConstruction":"","visibleDecoration":"","closures":"","explicitlyAbsent":[],"uncertainty":""}]},"sareeTruth":{"body":{"mainFabric":"","weave":"","weaveGeometry":"","texture":"","transparency":"","shine":"","baseColor":"","secondaryColors":[],"pattern":"","motifInventory":[],"motifScale":"","motifOrientation":"","motifRepeat":"","motifDensity":"","motifPlacement":"","embellishment":"","bodyOrientation":""},"borders":{"upperBorder":"","lowerBorder":"","borderWidth":"","upperBorderWidth":"","lowerBorderWidth":"","borderColors":"","construction":"","motifGeometry":"","edgeTreatment":"","continuityRules":"","tasselColor":"","tasselConstruction":"","tasselSpacing":""},"pallu":{"hasDistinctPallu":false,"startingRegion":"","baseColor":"","motifInventory":[],"motifScale":"","motifOrientation":"","motifRepeat":"","motifDensity":"","borders":"","artwork":"","zari":"","embroidery":"","tassels":"","edgeTreatment":"","visualOrientation":"","evidenceReferences":"","uncertainty":""},"pleatZone":{"patternBehavior":"","borderBehavior":"","embellishmentBehavior":"","hasSpecialPanel":false},"blouse":{"hasBlouse":false,"color":"","fabric":"","frontConstruction":"","backConstruction":"","neckline":"","sleeves":"","ties":"","closure":"","embroidery":"","border":"","pattern":"","fit":"","isUnstitchedPiece":false},"physics":{"weight":"","stiffness":"","fluidity":"","transparency":"","shine":"","creaseBehavior":"","expectedFall":""},"regionEvidence":[{"region":"","state":"unknown","visibleConstruction":"","visibleDecoration":"","closures":"","explicitlyAbsent":[],"uncertainty":""}]},"sareeDrapePlan":{"baseDrapeFamily":"","shoulderSide":"","waistTuck":"","frontPleatTreatment":"","palluShoulderPlacement":"","openOrPleatedPallu":"","palluSpread":"","palluFallDirection":"","palluVisibleLength":"","handInteraction":"","movementAmount":"","pinningBehavior":"","borderVisibility":"","blouseVisibility":"","coverageConstraints":"","poseSpecificDrapeState":""},"creativeDirection":{"backgroundStyle":"","studioEnvironment":"","lighting":"","cameraPerspective":"","composition":"","framing":"","mood":"","colorTreatment":"","modelStyling":"","photographyStyle":"","propUsage":"","shadowStyle":"","editorialCommercialFeel":"","lensAndCamera":"","setContinuity":"","realismRules":"","suggestedAccessories":"","seatedPoseRequired":"no","seatedPoseReason":"","closeupMode":"face_and_detail","closeupHeroDetail":""},"showcasePlan":{"heroFeature":"","featureRegion":"","shotType":"","whyItSells":"","evidenceReference":"","framing":"","cameraAngle":"","bodyPosition":"","handPlacement":"","expression":"","distinctFrom":"","visibilityRules":[]},"modelIdentity":{"castingDirection":"","face":"","faceRealism":"","hair":"","makeup":"","bodyProportions":"","stylingLock":""},"stylingPlan":{"footwear":"","jewellery":"","ornaments":"","makeup":"","hair":"","stylingNotes":"","themeInterpretation":""},"posePlan":[{"id":"full_front","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"angled","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"back","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"creative","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"closeup","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""},{"id":"showcase","title":"","description":"","cameraAngle":"","framing":"","bodyPosition":"","handPlacement":"","expression":"","highlightedDetails":[],"productVisibilityRules":[],"purpose":"","consistencyNotes":"","prompt":""}]}  `;
}

export const CONSISTENCY_RULES = [
  "Original product references always outrank generated images and style references.",
  "Model face comes from the MODEL FACE REFERENCE when one is attached, otherwise from the STYLE REFERENCE face. Backdrop and lighting come from the STYLE REFERENCE on all six poses. The product itself stays based on uploaded product images and must not be redesigned.",
  "Lock and hold identical photoshoot backdrop, wall finish, flooring, lighting, footwear, jewellery, ornaments, accessories, styling, makeup, hair, product layout, and product design across all six images.",
  "Every shoot must execute a distinct 6-pose plan with clear physical variation across all 6 slots: natural full-front hero, 35-to-45 degree turn (never flat frontal), true rear view (hair and dupatta forward), a relaxed editorial stance or seated pose (never a frozen walking stride), tight product-detail close-up, and unique feature showcase.",
  "Model expressions and smiles must look natural, relaxed, and realistic with soft lips and calm warmth — strictly avoid artificial, forced, stiff, or frozen stock catalog smiles.",
  "If a MODEL FACE REFERENCE image was supplied, it is the exact, non-negotiable face and identity for the model in every pose, including pose 1 - reproduce it as closely as photographically possible and never substitute, average, or beautify a different face.",
  "Keep the same model face, skin tone, hair, body proportions, makeup, accessories, and footwear across all six poses.",
  "Every face must be photorealistic and anatomically correct: natural skin texture with visible pores, correctly shaped and aligned eyes with realistic catchlights, and naturally aligned teeth. Never render a distorted, warped, blurred, or plastic/waxy/mirror-symmetric \"AI face\".",
  "Keep exact garment colors, fabric, texture, pattern scale and placement, print, embroidery, logos, stitching, trims, buttons, zippers, pockets, fit, silhouette, and length.",
  "Keep the exact bottom wear cut, silhouette, volume, pleats, hem, fabric, color, and print shown in product references across all poses. Never substitute farshi/farsi pajama with palazzo, lehenga/skirt, dhoti, or salwar, and never drop or miniaturize the bottom-wear motifs.",
  "Use the back product image as the sole authority for the back pose.",
  "Style references control backdrop, lighting, and camera mood, not the pose, handheld props, or garment. When a style reference is provided, it is the sole authority for the photoshoot backdrop.",
  "Product reference images are for the garment only: never copy or reproduce pre-shoot background walls, arches, urns, pots, plants, or furniture from product references into the generated images.",
  "When a style reference shows jewellery or ornaments that complement this product, keep those exact pieces unless the product itself already includes jewellery; never invent a competing jewellery story.",
  "Pose 5 must be a tight product-detail close-up, never a full-body hero repeat. Include a sharp face only when that crop still leaves the selling detail large and readable; otherwise crop to the product detail.",
  "Never add text, random logos, extra layers, duplicate people, or unreferenced garment elements.",
  "Treat detailPlacementMap and absenceConstraints as hard locks: never relocate, mirror, extend, add, or remove a garment detail.",
  "Keep the identical studio backdrop wall color, texture, flooring, and lighting established in Pose 1 across all poses 2-6 without adding new props (no brass urlis, urns, flower petals, or altered staircases).",
  "In back poses, dupattas or shawls must be draped over the arms or in front so the entire back of the garment is 100% visible and unobstructed.",
  "The optional stylist accessory suggestion (creativeDirection.suggestedAccessories) may be added only when present, and must stay identical and product-appropriate across every pose - never invent a second, different accessory and never let it hide or replace any garment detail, bottom wear, or footwear shown in the product references.",
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
export const ANALYSIS_VERSION = "generation-session-v27-style-pose-quarantine";

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
  const bottomGarment = "(?:farshi|farsi|pajama|pyjama|palazzo|trousers?|pants?|sharara|gharara|salwar|patiala|churidar|skirt|lehenga|leggings?|dhoti|culottes?|shorts?|bottoms?|bottom\\s+wear)";
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

