/**
 * The sixth frame's subject, and the feedback loop that improves how it is chosen.
 *
 * Frames 1-5 are fixed catalog coverage. The sixth exists to sell whatever makes
 * THIS product worth buying, which differs per SKU: a sequin yoke on one kurti,
 * the flare and border of a farshi on the next, a dupatta's pallu on a third.
 * A fixed formula turned it into a second hero shot, so the choice belongs to
 * the vision analysis, and this module carries that choice plus the record of
 * how earlier choices were received.
 *
 * Imports nothing from profiles.ts or generationPrompt.ts: both depend on it.
 */

import { canonicalProductReferenceRole } from "./referencePolicy.ts";

type JsonRecord = Record<string, unknown>;

/** The garment component the sixth frame is built around. */
export const SHOWCASE_FEATURE_REGIONS = [
  "neckline",
  "embroidery",
  "print",
  "sleeve",
  "upper_garment",
  "bottom_wear",
  "hem_border",
  "dupatta",
  "pallu",
  "drape",
  "blouse",
  "silhouette",
  "complete_set",
  /** Back closures, ties, lace-ups, back neck or back yoke (analysis v38+). */
  "back_detail",
  "other",
] as const;
export type ShowcaseFeatureRegion = typeof SHOWCASE_FEATURE_REGIONS[number];

/** How tightly that component is framed. */
export const SHOWCASE_SHOT_TYPES = [
  "macro_detail",
  "half_body_detail",
  "full_body_feature",
  "drape_feature",
  "movement_feature",
] as const;
export type ShowcaseShotType = typeof SHOWCASE_SHOT_TYPES[number];

/** Shot types that crop in far enough to collide with the pose 5 close-up. */
const TIGHT_SHOT_TYPES: readonly ShowcaseShotType[] = ["macro_detail", "half_body_detail"];

export type ShowcasePlan = {
  heroFeature: string;
  featureRegion: ShowcaseFeatureRegion;
  shotType: ShowcaseShotType;
  whyItSells: string;
  evidenceReference: string;
  framing: string;
  cameraAngle: string;
  bodyPosition: string;
  handPlacement: string;
  expression: string;
  distinctFrom: string;
  visibilityRules: string[];
  /** Analysis v38+: Pose 6 is a tight detail close-up of this feature (productHighlightPlan), never widened. */
  productHighlight?: true;
};

export const MAX_SHOWCASE_FEEDBACK_ROWS = 3;
export const MAX_SHOWCASE_FEEDBACK_CHARS = 620;

export type ShowcaseOutcome = "selected" | "rejected" | "regenerated" | "qa_failed";

export type ShowcaseFeatureOutcomeRow = {
  [key: string]: unknown;
  id?: unknown;
  organization_id?: unknown;
  product_category?: unknown;
  garment_family?: unknown;
  feature_region?: unknown;
  shot_type?: unknown;
  selected_count?: unknown;
  rejected_count?: unknown;
  regenerated_count?: unknown;
  qa_failed_count?: unknown;
  avg_quality?: unknown;
  created_at?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function comparable(value: unknown) {
  return text(value).toLocaleLowerCase();
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]+", "g");

function bounded(value: unknown, maxChars: number) {
  const normalized = text(value).replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  const suffix = " [truncated]";
  if (maxChars <= suffix.length) return normalized.slice(0, maxChars).trimEnd();
  return `${normalized.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

const SHOWCASE_REGION_SYNONYMS: Record<string, ShowcaseFeatureRegion> = {
  neck: "neckline",
  yoke: "neckline",
  collar: "neckline",
  placket: "neckline",
  neckline_yoke: "neckline",
  embroidered_yoke: "embroidery",
  handwork: "embroidery",
  zari: "embroidery",
  butti: "embroidery",
  mirror_work: "embroidery",
  gota_patti: "embroidery",
  motif: "print",
  pattern: "print",
  floral_print: "print",
  block_print: "print",
  sleeves: "sleeve",
  cuff: "sleeve",
  cuffs: "sleeve",
  sleeve_cuff: "sleeve",
  kurti: "upper_garment",
  kurta: "upper_garment",
  top: "upper_garment",
  bodice: "upper_garment",
  trousers: "bottom_wear",
  pants: "bottom_wear",
  bottom: "bottom_wear",
  bottoms: "bottom_wear",
  farshi: "bottom_wear",
  farsi: "bottom_wear",
  farshi_pajama: "bottom_wear",
  fasi: "bottom_wear",
  fasi_pajama: "bottom_wear",
  farshi_salwar: "bottom_wear",
  farsi_salwar: "bottom_wear",
  fasi_salwar: "bottom_wear",
  palazzo: "bottom_wear",
  sharara: "bottom_wear",
  gharara: "bottom_wear",
  salwar: "bottom_wear",
  churidar: "bottom_wear",
  patiala: "bottom_wear",
  border: "hem_border",
  borders: "hem_border",
  hem: "hem_border",
  hemline: "hem_border",
  lace_border: "hem_border",
  tassels: "hem_border",
  stole: "dupatta",
  shawl: "dupatta",
  aanchal: "pallu",
  pallu_spread: "pallu",
  pallu_border: "pallu",
  pleats: "drape",
  pleat_drape: "drape",
  saree_drape: "drape",
  choli: "blouse",
  skirt: "silhouette",
  skirt_flare: "silhouette",
  flare: "silhouette",
  lehenga_skirt: "silhouette",
  full_set: "complete_set",
  coord_set: "complete_set",
  two_piece_set: "complete_set",
  back: "back_detail",
  back_closure: "back_detail",
  back_neck: "back_detail",
  back_neckline: "back_detail",
  back_tie: "back_detail",
  tie_back: "back_detail",
  lace_up: "back_detail",
  closure: "back_detail",
  fabric: "print",
  texture: "print",
  weave: "print",
};

export function normalizeShowcaseFeatureRegion(value: unknown): ShowcaseFeatureRegion | "" {
  const normalized = comparable(value).replace(/[\s-]+/g, "_");
  if ((SHOWCASE_FEATURE_REGIONS as readonly string[]).includes(normalized)) {
    return normalized as ShowcaseFeatureRegion;
  }
  return SHOWCASE_REGION_SYNONYMS[normalized] ?? "";
}

export function normalizeShowcaseShotType(value: unknown): ShowcaseShotType | "" {
  const normalized = comparable(value).replace(/[\s-]+/g, "_");
  return (SHOWCASE_SHOT_TYPES as readonly string[]).includes(normalized)
    ? normalized as ShowcaseShotType
    : "";
}

function defaultShotTypeFor(region: ShowcaseFeatureRegion): ShowcaseShotType {
  if (["neckline", "embroidery", "sleeve", "hem_border"].includes(region)) return "macro_detail";
  if (["pallu", "dupatta", "drape"].includes(region)) return "drape_feature";
  if (["bottom_wear", "silhouette", "complete_set"].includes(region)) return "full_body_feature";
  return "half_body_detail";
}

/**
 * A plan is usable only when the analysis actually named a feature and a region.
 * Everything else can be filled from the garment; the subject cannot, and
 * guessing it is exactly the fixed-formula behaviour this replaces.
 */
export function normalizeShowcasePlan(value: unknown): ShowcasePlan | null {
  const raw = objectValue(value);
  const heroFeature = bounded(raw.heroFeature ?? raw.hero_feature, 240);
  const featureRegion = normalizeShowcaseFeatureRegion(raw.featureRegion ?? raw.feature_region);
  if (!heroFeature || !featureRegion) return null;
  const shotType = normalizeShowcaseShotType(raw.shotType ?? raw.shot_type) ||
    defaultShotTypeFor(featureRegion);
  const rules = raw.visibilityRules ?? raw.visibility_rules;
  return {
    heroFeature,
    featureRegion,
    shotType,
    whyItSells: bounded(raw.whyItSells ?? raw.why_it_sells, 220),
    evidenceReference: bounded(canonicalProductReferenceRole(raw.evidenceReference ?? raw.evidence_reference), 120),
    framing: bounded(raw.framing, 320),
    cameraAngle: bounded(raw.cameraAngle ?? raw.camera_angle, 220),
    bodyPosition: bounded(raw.bodyPosition ?? raw.body_position, 320),
    handPlacement: bounded(raw.handPlacement ?? raw.hand_placement, 260),
    expression: bounded(raw.expression, 220),
    distinctFrom: bounded(raw.distinctFrom ?? raw.distinct_from, 240),
    visibilityRules: (Array.isArray(rules) ? rules : [])
      .map((entry) => bounded(entry, 200))
      .filter(Boolean)
      .slice(0, 8),
    ...(raw.productHighlight === true ? { productHighlight: true as const } : {}),
  };
}

/**
 * Pose 5 already sells one detail in a tight crop. When the analysis picks the
 * same subject at the same distance for pose 6, widen it rather than shipping
 * two versions of one frame - the sixth frame's whole job is added coverage.
 */
export function resolveShowcaseShotType(
  plan: ShowcasePlan,
  closeup: { heroDetail?: string },
): { shotType: ShowcaseShotType; widenedFromCloseup: boolean } {
  if (!TIGHT_SHOT_TYPES.includes(plan.shotType)) {
    return { shotType: plan.shotType, widenedFromCloseup: false };
  }
  const heroDetail = comparable(closeup.heroDetail);
  if (!heroDetail) return { shotType: plan.shotType, widenedFromCloseup: false };
  const region = plan.featureRegion.replace(/_/g, " ");
  const collides = heroDetail.includes(region) ||
    comparable(plan.heroFeature).split(/\s+/)
      .filter((word) => word.length > 4)
      .some((word) => heroDetail.includes(word));
  if (!collides) return { shotType: plan.shotType, widenedFromCloseup: false };
  return {
    shotType: ["pallu", "dupatta", "drape"].includes(plan.featureRegion) ? "drape_feature" : "full_body_feature",
    widenedFromCloseup: true,
  };
}

/**
 * The frame this shoot will actually produce, resolved from a creativeDirection.
 *
 * Every consumer must agree on this: the pose slot writes it into the brief, the
 * generation prompt writes the matching hard rule, the shoot memory records it,
 * and the feedback row is keyed by it. Resolving it separately per consumer is
 * how a widened frame ends up scored as the tight one that was never generated.
 */
export function effectiveShowcaseShot(
  creativeDirection: unknown,
  options?: { includesBottomWear?: boolean },
): {
  plan: ShowcasePlan;
  shotType: ShowcaseShotType;
  widenedFromCloseup: boolean;
} | null {
  const creative = objectValue(creativeDirection);
  const plan = normalizeShowcasePlan(creative.showcasePlan ?? creative.showcase_plan);
  if (!plan) return null;
  if (
    options?.includesBottomWear === false &&
    (plan.featureRegion === "bottom_wear" || plan.featureRegion === "complete_set")
  ) {
    return null;
  }
  // A product highlight was resolved against Pose 5 when it was planned: it stays the close-up.
  if (plan.productHighlight) return { plan, shotType: plan.shotType, widenedFromCloseup: false };
  const heroDetail = text(creative.closeupHeroDetail ?? creative.closeup_hero_detail);
  const resolved = resolveShowcaseShotType(plan, { heroDetail });
  return { plan, shotType: resolved.shotType, widenedFromCloseup: resolved.widenedFromCloseup };
}

/** Where on the body each product-highlight region is cropped (analysis v38+). */
const HIGHLIGHT_FRAMES: Record<ShowcaseFeatureRegion, { shotType: ShowcaseShotType; crop: string; body: string; camera: string }> = (() => {
  const torso = {
    shotType: "half_body_detail" as const,
    crop: "Torso crop from just below the chin to the hip, so the feature fills most of the frame at its true scale and placement.",
    body: "Torso turned a few degrees off camera with relaxed shoulders, so the feature lies flat and open to the lens",
    camera: "Eye-level, close detail distance centred on the feature",
  };
  const drape = {
    shotType: "half_body_detail" as const,
    crop: "Drape-detail crop of the shoulder-to-hip section where the panel falls, so its border, print and edge finish read large, flat and uncreased.",
    body: "Shoulder turned toward the camera so the draped panel falls open and flat across the frame",
    camera: "Eye-level, close detail distance centred on the drape",
  };
  return {
    neckline: { ...torso, crop: "Chest crop from the chin to the bust line, so the neckline construction fills most of the frame." },
    embroidery: torso,
    print: torso,
    upper_garment: torso,
    blouse: torso,
    other: torso,
    silhouette: torso,
    complete_set: torso,
    sleeve: {
      shotType: "macro_detail",
      crop: "Forearm and cuff crop from the elbow to the fingertips, so the sleeve shape, flare and cuff trim fill most of the frame.",
      body: "One arm relaxed slightly away from the body with the forearm turned so the sleeve and cuff face the lens",
      camera: "Eye-level, close detail distance centred on the sleeve and cuff",
    },
    dupatta: drape,
    pallu: drape,
    drape,
    hem_border: {
      shotType: "half_body_detail",
      crop: "Hem-detail crop from the hip to just below the hem, so the hem finish, border, trim or tassels fill most of the frame.",
      body: "Standing with a soft weight shift, feet close, so the hem hangs straight and its finish faces the lens",
      camera: "Slightly low, close detail distance centred on the hem",
    },
    bottom_wear: {
      shotType: "half_body_detail",
      crop: "Bottom-wear detail crop from the waist to the feet, so the bottom-wear cut, print and hem construction fill most of the frame.",
      body: "Standing with a soft weight shift, feet close, so the bottom-wear cut, print and hem face the lens",
      camera: "Slightly low, close detail distance centred on the bottom wear",
    },
    back_detail: {
      shotType: "half_body_detail",
      crop: "Back-detail crop: the model faces fully away and the frame runs from the shoulder line to just past where the back detail ends (shoulder blades to waist for a back closure), so every closure, tie, lace crossing, bow and hanging end reads large and sharp.",
      body: "Model turned fully away from the camera, shoulders square, hair swept forward off the back, arms eased slightly away from the sides so the whole back detail is clear",
      camera: "Eye-level from directly behind, close detail distance centred on the back detail",
    },
  };
})();

export function productHighlightFrame(region: ShowcaseFeatureRegion) {
  return HIGHLIGHT_FRAMES[region];
}

/** The product photo that best shows each region; the analysis's own pick is kept when it is one of these. */
function highlightEvidence(region: ShowcaseFeatureRegion, isSaree: boolean, picked: string): string {
  const allowed: string[] = isSaree
    ? ({
      back_detail: ["saree_back_drape", "saree_blouse_back_piece", "back"],
      pallu: ["saree_pallu_spread"],
      dupatta: ["saree_pallu_spread"],
      drape: ["saree_front_drape", "saree_pallu_spread"],
      hem_border: ["saree_border_tassels"],
      blouse: ["saree_blouse_front", "saree_blouse_back_piece"],
    } as Partial<Record<ShowcaseFeatureRegion, string[]>>)[region] ?? ["saree_body_detail", "fabric_pattern"]
    : ({
      back_detail: ["back"],
      sleeve: ["mannequin", "additional_product"],
      dupatta: ["additional_product", "mannequin"],
      hem_border: ["front", "mannequin"],
      bottom_wear: ["bottom", "front"],
    } as Partial<Record<ShowcaseFeatureRegion, string[]>>)[region] ?? ["fabric_pattern"];
  return allowed.includes(picked) ? picked : allowed[0];
}

const BACK_LOCATION = /\b(?:back|rear|backless)\b|\btie[- ]?back\b/i;
/** Not a detail a close-up can sell on its own; Pose 6 then takes the next distinctive feature. */
const VAGUE_REGIONS: readonly ShowcaseFeatureRegion[] = ["upper_garment", "other", "silhouette", "complete_set"];
/** Torso regions a "back ..." feature moves to the back-detail crop (a sleeve or hem keeps its own crop). */
const BACK_CAPABLE_REGIONS: readonly ShowcaseFeatureRegion[] = [...VAGUE_REGIONS, "neckline", "embroidery", "print", "blouse", "back_detail"];
/** Regions a text names, most specific first. */
const REGION_WORDS: Array<[ShowcaseFeatureRegion, RegExp]> = [
  ["back_detail", BACK_LOCATION],
  ["sleeve", /\bsleeves?\b|\bcuffs?\b/i],
  ["pallu", /\bpallu\b|\baanchal\b/i],
  ["dupatta", /\bdupatta\b|\bstole\b|\bchunni\b|\bodhani\b/i],
  ["hem_border", /\bhem(?:line)?s?\b|\bborders?\b|\btassels?\b/i],
  ["blouse", /\bblouse\b/i],
  ["neckline", /\bneck(?:line)?\b|\byoke\b|\bcollar\b|\bplacket\b/i],
  ["embroidery", /embroider|\bbutti\b|\bzari\b|mirror[- ]?work|\bgota\b|\bsequin|zardozi|\bchikan|handwork/i],
  ["print", /\bprint(?:ed)?\b|\bmotifs?\b|\bpattern\b/i],
];

function regionsIn(value: string): ShowcaseFeatureRegion[] {
  return REGION_WORDS.filter(([, pattern]) => pattern.test(value)).map(([region]) => region);
}

/** A recorded field that names real construction: never "none" or a negation, and never "plain" unless `detail` matches. */
function distinctive(value: unknown, detail?: RegExp): string {
  const cleaned = bounded(value, 240);
  if (!cleaned || cleaned === "-" || /^(?:not visible|unknown|n\/a|none|no|without)\b/i.test(cleaned)) return "";
  // "plain back panel with no ties or closure": only an affirmed detail counts, never a negated one.
  if (detail) return detail.test(cleaned.replace(/\b(?:no|without|not|never|lacks?|free of)\b[^,.;]*/gi, " ")) ? cleaned : "";
  return /^(?:plain|simple|solid)\b/i.test(cleaned) ? "" : cleaned;
}

const BACK_DETAIL_WORDS = /lace|\bties?\b|\bbow\b|dori|tassel|latkan|button|hook|\bzip|keyhole|cut[- ]?out|closure|knot|embroider|yoke|smock|drawstring|criss[- ]?cross/i;
const SLEEVE_DETAIL_WORDS = /lace|trim|cuff|\bbell\b|flare|puff|ruffle|frill|embroider|tassel|scallop|balloon|bishop|button|pleat|gather|\bbow\b|\btie\b/i;
const HEM_DETAIL_WORDS = /lace|trim|border|tassel|scallop|embroider|piping|fringe|latkan/i;

/** Distinctive features recorded in productIdentity, in the order Pose 6 falls back to them. */
function highlightCandidates(productIdentity: unknown, includesBottomWear: boolean, isSaree: boolean): Array<[ShowcaseFeatureRegion, string]> {
  const product = objectValue(productIdentity);
  const mainColor = bounded(product.mainColor ?? product.main_color, 60);
  const fabric = distinctive(product.fabric);
  const texture: [ShowcaseFeatureRegion, string] = ["print", fabric ? `${mainColor ? `${mainColor} ` : ""}${fabric} fabric texture and weave` : ""];
  if (isSaree) {
    const saree = objectValue(product.sareeTruth);
    return [
      ["pallu", distinctive(objectValue(saree.pallu).artwork)],
      ["hem_border", distinctive(objectValue(saree.borders).lowerBorder)],
      ["back_detail", distinctive(objectValue(saree.blouse).backConstruction, BACK_DETAIL_WORDS)],
      ["print", distinctive(objectValue(saree.body).pattern)],
      texture,
    ];
  }
  const placement = (Array.isArray(product.detailPlacementMap) ? product.detailPlacementMap : []).map((entry) => String(entry ?? ""));
  const hem = placement.find((entry) => /\bhem|\bborder/i.test(entry) && HEM_DETAIL_WORDS.test(entry) && !/\b(?:no|without|none)\b/i.test(entry));
  const dupatta = distinctive(product.accessoriesIncluded ?? product.accessories_included);
  return [
    ["back_detail", distinctive(product.backConstruction ?? product.back_construction, BACK_DETAIL_WORDS)],
    ["sleeve", distinctive(product.sleeveType ?? product.sleeve_type, SLEEVE_DETAIL_WORDS)],
    ["dupatta", /\b(?:dupatta|stole|chunni|odhani)\b/i.test(dupatta) && !/\b(?:no|without)\b/i.test(dupatta) ? dupatta : ""],
    ["hem_border", distinctive(hem)],
    ["bottom_wear", includesBottomWear ? distinctive(product.bottomWearDetails ?? product.bottom_wear_details) : ""],
    ["embroidery", distinctive(product.embroidery)],
    ["print", distinctive(product.pattern ?? product.print)],
    texture,
    ["neckline", distinctive(product.neckline)],
  ];
}

/**
 * Analysis v38+: Pose 6 is the PRODUCT HIGHLIGHT - a tight, accurate detail close-up of the
 * product's most distinctive feature on the worn garment, never a full-body frame and never
 * Pose 5's subject. It starts from the feature the analysis chose (showcasePlan); a feature on
 * the back is cropped from behind. When that choice is not a detail (silhouette, complete set),
 * is missing, or is what Pose 5 already shows, the next distinctive feature recorded in
 * productIdentity takes its place. Idempotent: a resolved plan is returned unchanged.
 */
export function productHighlightPlan(args: {
  plan: ShowcasePlan | null;
  closeupHeroDetail: string;
  productIdentity: unknown;
  includesBottomWear: boolean;
  isSaree: boolean;
}): ShowcasePlan | null {
  if (args.plan?.productHighlight) return args.plan;
  // Pose 5 frames the chest by default, so an unrecorded Pose 5 subject counts as the neckline.
  const closeupRegions = regionsIn(args.closeupHeroDetail);
  const taken = new Set<ShowcaseFeatureRegion>(closeupRegions.length ? closeupRegions : ["neckline"]);
  const usable = (region: ShowcaseFeatureRegion) =>
    !VAGUE_REGIONS.includes(region) && !taken.has(region) && (args.includesBottomWear || region !== "bottom_wear");
  const distinctFrom = (feature: string) =>
    `A tight detail close-up of ${feature}${args.closeupHeroDetail ? `, not Pose 5's ${args.closeupHeroDetail}` : ""}, and never a full-body frame like Poses 1-3.`;
  const build = (base: ShowcasePlan, region: ShowcaseFeatureRegion): ShowcasePlan => ({
    ...base,
    featureRegion: region,
    shotType: HIGHLIGHT_FRAMES[region].shotType,
    evidenceReference: highlightEvidence(region, args.isSaree, base.evidenceReference),
    // The analysis wrote these for its own distance; the close-up framing comes from the region.
    framing: "",
    cameraAngle: "",
    bodyPosition: "",
    distinctFrom: distinctFrom(base.heroFeature),
    productHighlight: true,
  });
  if (args.plan) {
    const named = regionsIn(args.plan.heroFeature);
    // A torso feature on the back is shot from behind; a vague region takes the one its feature names.
    const region = named[0] === "back_detail" && BACK_CAPABLE_REGIONS.includes(args.plan.featureRegion)
      ? "back_detail"
      : VAGUE_REGIONS.includes(args.plan.featureRegion) && named.length
      ? named[0]
      : args.plan.featureRegion;
    if (usable(region)) return build(args.plan, region);
  }
  for (const [region, feature] of highlightCandidates(args.productIdentity, args.includesBottomWear, args.isSaree)) {
    if (!feature || !usable(region)) continue;
    return build({
      heroFeature: feature,
      featureRegion: region,
      shotType: HIGHLIGHT_FRAMES[region].shotType,
      whyItSells: "",
      evidenceReference: "",
      framing: "",
      cameraAngle: "",
      bodyPosition: "",
      handPlacement: "",
      expression: "",
      distinctFrom: "",
      visibilityRules: [],
    }, region);
  }
  // Nothing recorded is distinct from Pose 5: still a marked close-up (never widened to a full-body
  // frame), on the region that overlaps Pose 5 least.
  const fallback = (["print", "hem_border", "sleeve", "embroidery"] as ShowcaseFeatureRegion[]).find(usable) ?? "print";
  const fallbackFeature: Partial<Record<ShowcaseFeatureRegion, string>> = {
    print: "the allover print and fabric finish",
    hem_border: "the hem finish",
    sleeve: "the sleeve and cuff finish",
    embroidery: "the embroidery detail",
  };
  return build({
    heroFeature: fallbackFeature[fallback] || "the fabric and finishing",
    featureRegion: fallback,
    shotType: HIGHLIGHT_FRAMES[fallback].shotType,
    whyItSells: args.plan?.whyItSells || "",
    evidenceReference: "",
    framing: "",
    cameraAngle: "",
    bodyPosition: "",
    handPlacement: "",
    expression: "",
    distinctFrom: "",
    visibilityRules: args.plan?.visibilityRules || [],
  }, fallback);
}

export function showcaseShotDirection(shotType: ShowcaseShotType) {
  return {
    macro_detail:
      "Fill the frame with the named feature so its construction, stitch, motif scale and material read at catalog resolution. The face may be partial at the edge or absent entirely. Never a full-body or hero repeat.",
    half_body_detail:
      "Crop to the body section the feature lives on - roughly head-to-waist or chest-to-hip - so the feature is large and sharp while its placement on the garment stays legible. Tighter than the hero frame, wider than a macro crop.",
    full_body_feature:
      "Frame head-to-toe, but compose and pose for the named feature rather than for a second hero shot: angle, stance and weight shift must be chosen so that feature reads at its best, and it must be unmistakably the subject of the frame.",
    drape_feature:
      "Frame so the draped panel is the subject: held, spread or falling clear of the body and opened flat enough that its artwork, border and full length read end to end, with no arm, hair or prop crossing it.",
    movement_feature:
      "Show the feature's fall and weight with a gentle turn or a small weight shift, both feet planted and close. The garment stays readable and uncrumpled. Do not freeze a walking stride or lift a foot.",
  }[shotType];
}

/**
 * Editorial photoshoot direction for Pose 6 so the frame reads as both a
 * high-aesthetic fashion photograph and a razor-sharp product-detail showcase.
 */
export function showcaseAestheticDirection(
  shotType: ShowcaseShotType,
  featureRegion?: ShowcaseFeatureRegion,
): string {
  const regionLabel = featureRegion ? featureRegion.replace(/_/g, " ") : "featured detail";
  switch (shotType) {
    case "macro_detail":
      return `Editorial macro photoshoot aesthetics: tack-sharp optical focus across the ${regionLabel} plane, directional grazing studio key light with soft fill to sculpt embroidery thread relief, zari sheen, and weave grain without specular blowout, and creamy shallow depth-of-field background separation.`;
    case "half_body_detail":
      return `Editorial waist-up fashion portrait aesthetics: sculpted studio key-and-fill lighting, intentional negative space, poised diagonal shoulder line, and tack-sharp focus across the ${regionLabel} craftsmanship and natural facial expression.`;
    case "drape_feature":
      return `Editorial drape-showcase photoshoot aesthetics: soft directional studio lighting that illuminates the ${regionLabel} artwork, border continuity, and weave translucency end-to-end, paired with a serene, graceful torso turn and coordinated two-hand placement clear of the motif field.`;
    case "movement_feature":
      return `Editorial catalog photoshoot aesthetics: a gentle turn or small weight shift so ${regionLabel} fall and weight read clearly, both feet planted and close enough that a joined or tapered hem stays closed, directional studio lighting, prints and construction razor-sharp. No frozen mid-stride and no lifted foot.`;
    case "full_body_feature":
    default:
      return `Editorial full-length fashion photoshoot aesthetics: slightly low leg-lengthening camera perspective, a natural stance with both feet planted and close and a soft angle so ${regionLabel} volume, pleat geometry, and hem border read clearly without opening a joined hem, directional side-key lighting that carves fabric drape, and grounded contact shadows.`;
  }
}

/** The key a feedback row is scored against. */
export function showcaseOutcomeKey(plan: Pick<ShowcasePlan, "featureRegion" | "shotType">) {
  return `${plan.featureRegion}:${plan.shotType}`;
}

function netScore(row: ShowcaseFeatureOutcomeRow) {
  // A regeneration is a softer negative than an outright rejection: the operator
  // wanted this subject shot differently, not a different subject.
  return integer(row.selected_count) * 2 -
    integer(row.rejected_count) * 2 -
    integer(row.regenerated_count) -
    integer(row.qa_failed_count);
}

function quality(row: ShowcaseFeatureOutcomeRow) {
  const value = Number(row.avg_quality);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Bounded, fail-closed guidance for the analysis prompt.
 *
 * This is house taste learned from operators, never product truth: it reports
 * which subjects and framings this team kept and which they threw away, and the
 * prompt that receives it says the current product references still decide.
 */
export function selectShowcaseFeedbackGuidance(
  rows: readonly ShowcaseFeatureOutcomeRow[] | null | undefined,
  args: { organizationId: string; productCategory?: string; garmentFamily?: string },
): { ids: string[]; guidance: string } {
  const organizationId = text(args.organizationId);
  const productCategory = comparable(args.productCategory);
  const garmentFamily = comparable(args.garmentFamily);
  if (!organizationId || !productCategory || !Array.isArray(rows)) return { ids: [], guidance: "" };


  const eligible = rows.filter((row) => {
    const owner = text(row.organization_id);
    if (owner && owner !== organizationId) return false;
    if (comparable(row.product_category) !== productCategory) return false;
    // Strict: a row recorded under one family never advises another, and a
    // caller that does not yet know the family (the analysis has not run) sees
    // only category-wide rows rather than inheriting whichever family wrote last.
    if (comparable(row.garment_family) !== garmentFamily) return false;
    if (!normalizeShowcaseFeatureRegion(row.feature_region)) return false;
    if (!normalizeShowcaseShotType(row.shot_type)) return false;
    // Only rows carrying real feedback say anything.
    return integer(row.selected_count) + integer(row.rejected_count) +
      integer(row.regenerated_count) + integer(row.qa_failed_count) > 0;
  }).sort((left, right) => {
    const delta = Math.abs(netScore(right)) - Math.abs(netScore(left));
    if (delta) return delta;
    const byQuality = quality(right) - quality(left);
    if (byQuality) return byQuality;
    return text(left.id).localeCompare(text(right.id));
  });

  const selected: Array<{ id: string; line: string }> = [];
  let used = 0;
  for (const row of eligible) {
    if (selected.length >= MAX_SHOWCASE_FEEDBACK_ROWS) break;
    const id = text(row.id) || `${comparable(row.feature_region)}:${comparable(row.shot_type)}`;
    if (!id || selected.some((entry) => entry.id === id)) continue;
    const score = netScore(row);
    const reworked = integer(row.rejected_count) + integer(row.regenerated_count) +
      integer(row.qa_failed_count);
    const line = bounded(
      score > 0
        ? `${text(row.feature_region)} as ${text(row.shot_type)}: kept ${integer(row.selected_count)} time(s) - this reads well for this category.`
        : `${text(row.feature_region)} as ${text(row.shot_type)}: reworked or rejected ${reworked} time(s) - prefer a different subject or framing unless the references clearly call for it.`,
      200,
    );
    if (!line) continue;
    const prefix = used ? "\n- " : "- ";
    if (MAX_SHOWCASE_FEEDBACK_CHARS - used - prefix.length < line.length) break;
    selected.push({ id, line });
    used += prefix.length + line.length;
  }

  return {
    ids: selected.map((entry) => entry.id),
    guidance: selected.map((entry) => `- ${entry.line}`).join("\n"),
  };
}

export function nextShowcaseOutcomeCounts(
  row: ShowcaseFeatureOutcomeRow | null | undefined,
  outcome: ShowcaseOutcome,
  qualityScore?: number | null,
) {
  const counts = {
    selectedCount: integer(row?.selected_count) + (outcome === "selected" ? 1 : 0),
    rejectedCount: integer(row?.rejected_count) + (outcome === "rejected" ? 1 : 0),
    regeneratedCount: integer(row?.regenerated_count) + (outcome === "regenerated" ? 1 : 0),
    qaFailedCount: integer(row?.qa_failed_count) + (outcome === "qa_failed" ? 1 : 0),
  };
  const previousAverage = Number(row?.avg_quality);
  const score = Number(qualityScore);
  let avgQuality: number | null = Number.isFinite(previousAverage) ? previousAverage : null;
  if (outcome === "selected" && Number.isFinite(score) && score >= 0 && score <= 100 && counts.selectedCount > 0) {
    const prior = Number.isFinite(previousAverage) ? previousAverage : score;
    const priorWeight = Math.max(0, counts.selectedCount - 1);
    avgQuality = Math.round(((prior * priorWeight) + score) / counts.selectedCount * 100) / 100;
  }
  return { ...counts, avgQuality };
}

export const SHOWCASE_OUTCOME_WRITE_ATTEMPTS = 4;

export function planShowcaseOutcomeWrite(
  rows: readonly ShowcaseFeatureOutcomeRow[] | null | undefined,
  outcome: ShowcaseOutcome,
  qualityScore?: number | null,
) {
  const sorted = [...(Array.isArray(rows) ? rows : [])].filter((row) => text(row.id))
    .sort((left, right) => {
      const created = (Date.parse(text(left.created_at)) || 0) - (Date.parse(text(right.created_at)) || 0);
      if (created) return created;
      return text(left.id).localeCompare(text(right.id));
    });
  const row = sorted[0];
  if (!row) return { action: "insert" as const, next: nextShowcaseOutcomeCounts(null, outcome, qualityScore) };
  return {
    action: "update" as const,
    id: text(row.id),
    expected: {
      selectedCount: integer(row.selected_count),
      rejectedCount: integer(row.rejected_count),
      regeneratedCount: integer(row.regenerated_count),
      qaFailedCount: integer(row.qa_failed_count),
    },
    next: nextShowcaseOutcomeCounts(row, outcome, qualityScore),
  };
}
