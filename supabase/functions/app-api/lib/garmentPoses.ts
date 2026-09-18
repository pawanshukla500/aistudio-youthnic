/**
 * Pure garment classification for pose planning and prompt composition.
 *
 * A saree, a kurta set with farshi, a standalone long kurti and a cropped top
 * need different pose grammar, but the rest of the pipeline only carries a
 * coarse `garmentFamily` ("saree", "kurta_or_kurti_set", ...). This module
 * derives the finer *pose family* that pose slots and prompts actually need,
 * and resolves how bottom wear should be presented.
 *
 * It intentionally imports nothing from the rest of the codebase: profiles.ts
 * and generationPrompt.ts both depend on it, so a back-reference would create
 * a runtime import cycle.
 */

type JsonRecord = Record<string, unknown>;

export const GARMENT_POSE_FAMILIES = [
  "saree_bengali",
  "saree_ethnic",
  "kurta_set",
  "long_kurti",
  "short_kurti_top",
  "lehenga",
  "dress",
  "western_casual",
  "other",
] as const;
export type GarmentPoseFamily = typeof GARMENT_POSE_FAMILIES[number];

export const BOTTOM_WEAR_MODES = ["auto", "included", "top_only"] as const;
export type BottomWearMode = typeof BOTTOM_WEAR_MODES[number];

export type BottomWearPresentation = {
  mode: BottomWearMode;
  /** True when this shoot must frame the bottom wear as part of the product. */
  includesBottomWear: boolean;
  /** True when the analysis itself proved a bottom garment in the references. */
  recordedInAnalysis: boolean;
  details: string;
  /** Recorded cut class, used to emit only the substitution guards that apply. */
  cutClass: BottomCutClass;
  source: "user" | "analysis";
};

export const BOTTOM_CUT_CLASSES = [
  "farshi",
  "palazzo",
  "sharara_gharara",
  "salwar_churidar",
  "straight_trouser",
  "skirt_lehenga",
  "other",
  "none",
] as const;
export type BottomCutClass = typeof BOTTOM_CUT_CLASSES[number];

const ABSENT_BOTTOM_WEAR =
  /^(unknown|unproven|none|n\/a|na|n\.a\.?|not applicable|standalone|not visible|not recorded|not specified|no bottom(?:s)?(?:\s+wear)?|no trousers?|no pants?)(\b|[.\s-]|$)/i;
const BOTTOM_GARMENT_CLASS =
  /\b(?:farshi|farsi|pajama|pyjama|palazzo|trousers?|pants?|sharara|gharara|salwar|patiala|churidar|skirt|lehenga|leggings?|dhoti|culottes?|shorts?)\b/i;

const BENGALI_SAREE_RE =
  /\b(bengali|bangla(?:deshi)?|bengal|tant|taant|jamdani|dhakai|garad|garod|korial|baluchari|swarnachari|kantha|lal\s*paar|laal\s*paar|red\s*and\s*white\s*saree|shantipuri|begumpuri|murshidabad|bishnupuri|atpoure|aatpoure|athpourey|aanchal|anchal)\b/i;
const SAREE_RE = /\bsarees?\b|\bsari\b/i;
const LEHENGA_RE = /\b(lehenga|lehanga|ghagra|chaniya\s*choli)\b/i;
const KURTA_RE = /\b(kurta|kurti|kurtha|kurtis|kurtas|salwar\s*suit|churidar\s*suit|anarkali|co-?ord)\b/i;
const TOP_ONLY_RE = /\b(top|tee|t-?shirt|shirt|blouse|crop\s*top|tunic|camisole|corset|bustier|peplum)\b/i;
const DRESS_RE = /\b(dress|gown|maxi|midi\s*dress|jumpsuit|kaftan|kaftaan|caftan)\b/i;
const WESTERN_RE = /\b(western|casual|denim|jeans|co-?ord\s*set|athleisure|street\s*wear)\b/i;

/** Lengths that read as a short/cropped upper garment rather than a long kurti. */
const SHORT_LENGTH_RE =
  /\b(crop(?:ped)?|waist[-\s]?length|above[-\s]the[-\s]waist|hip[-\s]?length|short\s*kurti|short\s*length|mini)\b/i;
const LONG_LENGTH_RE =
  /\b(ankle[-\s]?length|floor[-\s]?length|calf[-\s]?length|maxi|full[-\s]?length|straight\s*long|anarkali|knee[-\s]?length|below[-\s]the[-\s]knee|mid[-\s]?thigh)\b/i;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function joined(values: unknown[]) {
  return values.map((value) => text(value)).filter(Boolean).join(" ");
}

export function recordedBottomWearText(productIdentity: unknown): string {
  const product = objectValue(productIdentity);
  return text(product.bottomWearDetails ?? product.bottom_wear_details);
}

/**
 * The positive half of the recorded specification. "Palazzo, NOT farshi" must
 * classify as palazzo, so everything from the first negation onward is dropped
 * before the garment class is read.
 */
function positiveBottomWearPortion(details: string) {
  if (!details || ABSENT_BOTTOM_WEAR.test(details)) return "";
  const firstNegative = details.search(/\b(?:not|without|no)\b/i);
  return (firstNegative === -1 ? details : details.slice(0, firstNegative)).trim();
}

export function hasBottomWearInAnalysis(productIdentity: unknown): boolean {
  const positive = positiveBottomWearPortion(recordedBottomWearText(productIdentity));
  return Boolean(positive) && BOTTOM_GARMENT_CLASS.test(positive);
}

export function classifyBottomCut(detailsOrProduct: unknown): BottomCutClass {
  const details = typeof detailsOrProduct === "string"
    ? detailsOrProduct
    : recordedBottomWearText(detailsOrProduct);
  const positive = positiveBottomWearPortion(details);
  if (!positive) return "none";
  if (/\b(farshi|farsi)\b/i.test(positive)) return "farshi";
  if (/\b(sharara|gharara)\b/i.test(positive)) return "sharara_gharara";
  if (/\bpalazzo\b/i.test(positive)) return "palazzo";
  if (/\b(churidar|patiala|salwar)\b/i.test(positive)) return "salwar_churidar";
  if (/\b(cigarette|straight\s*(?:trousers?|pants?)|tapered|slim\s*(?:fit\s*)?(?:trousers?|pants?)|trousers?|pants?|leggings?)\b/i.test(positive)) {
    return "straight_trouser";
  }
  if (/\b(skirt|lehenga|ghagra)\b/i.test(positive)) return "skirt_lehenga";
  return BOTTOM_GARMENT_CLASS.test(positive) ? "other" : "none";
}

export function normalizeBottomWearMode(value: unknown, fallback: BottomWearMode = "auto"): BottomWearMode {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return fallback;
  if (normalized === "auto" || normalized === "detect" || normalized === "automatic") return "auto";
  if (
    normalized === "included" || normalized === "yes" || normalized === "true" ||
    normalized === "with_bottom" || normalized === "with_bottom_wear" || normalized === "set"
  ) return "included";
  if (
    normalized === "top_only" || normalized === "no" || normalized === "false" ||
    normalized === "none" || normalized === "standalone" || normalized === "upper_only"
  ) return "top_only";
  return fallback;
}

/**
 * Analysis records what the references prove; this option records how the
 * merchandiser wants it presented. "auto" keeps the two in sync, and an
 * explicit choice wins so a top-only SKU never gets an invented matching set.
 */
export function resolveBottomWearPresentation(args: {
  mode?: unknown;
  productIdentity?: unknown;
}): BottomWearPresentation {
  const mode = normalizeBottomWearMode(args.mode);
  const details = recordedBottomWearText(args.productIdentity);
  const recordedInAnalysis = hasBottomWearInAnalysis(args.productIdentity);
  const includesBottomWear = mode === "included" ? true : mode === "top_only" ? false : recordedInAnalysis;
  return {
    mode,
    includesBottomWear,
    recordedInAnalysis,
    details: includesBottomWear ? details : "",
    cutClass: includesBottomWear ? classifyBottomCut(details) : "none",
    source: mode === "auto" ? "analysis" : "user",
  };
}

/**
 * Resolve the pose family. `garmentFamily` from analysis is the strongest
 * signal; category, recorded length/silhouette and the member's own notes
 * refine it (a Bengali saree and a cropped top both need their own grammar).
 */
export function detectGarmentPoseFamily(args: {
  productIdentity?: unknown;
  category?: string;
  productDetails?: string;
  skuName?: string;
}): GarmentPoseFamily {
  const product = objectValue(args.productIdentity);
  const garmentFamily = text(product.garmentFamily ?? product.garment_family).toLowerCase();
  const sareeTruth = objectValue(product.sareeTruth ?? product.saree_truth);
  const sareeBody = objectValue(sareeTruth.body);
  const category = text(args.category).toLowerCase();
  const notes = joined([args.productDetails, args.skuName]);
  const haystack = joined([
    garmentFamily,
    category,
    notes,
    product.category,
    product.silhouette,
    product.fabric,
    product.pattern,
    product.print,
    product.length,
    sareeBody.mainFabric,
    sareeBody.weave,
    sareeBody.pattern,
  ]);

  const isSaree = garmentFamily === "saree" ||
    SAREE_RE.test(`${garmentFamily} ${category}`) ||
    (Object.keys(sareeTruth).length > 0 && SAREE_RE.test(haystack));
  if (isSaree) return BENGALI_SAREE_RE.test(haystack) ? "saree_bengali" : "saree_ethnic";

  if (LEHENGA_RE.test(haystack)) return "lehenga";

  const looksKurta = garmentFamily.includes("kurta") || garmentFamily.includes("kurti") || KURTA_RE.test(haystack);
  if (looksKurta) {
    if (hasBottomWearInAnalysis(product)) return "kurta_set";
    if (isShortUpperGarment(product, haystack)) return "short_kurti_top";
    return "long_kurti";
  }

  if (DRESS_RE.test(haystack) || garmentFamily === "dress") return "dress";
  if (TOP_ONLY_RE.test(haystack)) return "short_kurti_top";
  if (garmentFamily === "western_or_casual" || WESTERN_RE.test(haystack)) return "western_casual";
  return "other";
}

function isShortUpperGarment(product: JsonRecord, haystack: string) {
  const length = text(product.length);
  if (SHORT_LENGTH_RE.test(length)) return true;
  if (LONG_LENGTH_RE.test(length)) return false;
  return SHORT_LENGTH_RE.test(haystack) && !LONG_LENGTH_RE.test(haystack);
}

export function isSareePoseFamily(family: GarmentPoseFamily) {
  return family === "saree_bengali" || family === "saree_ethnic";
}

export function garmentPoseFamilyLabel(family: GarmentPoseFamily) {
  return {
    saree_bengali: "Bengali saree",
    saree_ethnic: "Ethnic / traditional saree",
    kurta_set: "Kurti or kurta set with bottom wear",
    long_kurti: "Long kurti / kurta (standalone)",
    short_kurti_top: "Short kurti or top",
    lehenga: "Lehenga set",
    dress: "Dress or gown",
    western_casual: "Western / casual",
    other: "General apparel",
  }[family];
}

/**
 * The per-family pose grammar injected into every generation prompt. Kept short
 * and concrete: it directs body language and framing only, and never touches
 * garment colour, print, construction or fit, which stay owned by the product
 * truth blocks.
 */
export function garmentPoseDirection(family: GarmentPoseFamily): string {
  return {
    saree_bengali:
      `- BENGALI SAREE POSE GRAMMAR: pose with the quiet, upright grace this drape is photographed with. Shoulders open and level, spine tall, chin level, weight settled on one leg, movement small and deliberate.
- PALLU (AANCHAL) PLACEMENT: the pallu must read as a deliberately placed panel, not stray cloth. Keep its recorded shoulder side, fall direction and visible length exactly as the drape plan states. Where the drape is aatpoure/Bengali style, the pallu comes over the shoulder and its border and end-piece artwork stay readable; never bunch, twist, fold away, or hide the pallu behind an arm.
- PLEATS AND BORDER: front pleats stay flat, evenly stacked and vertical; the upper and lower borders stay continuous and unbroken along the body and across the pallu edge; the lower border stays parallel to the floor and never rides up.
- HANDS: keep both hands clear of the pallu artwork and the border. If a hand touches the drape at all, it rests lightly at the pleat line or holds the pallu edge low and open so the artwork stays fully visible.`,
    saree_ethnic:
      `- ETHNIC SAREE POSE GRAMMAR: graceful, poised, unhurried posture that suits a traditional drape - tall spine, relaxed shoulders, soft weight shift, controlled movement that never disturbs the drape.
- PALLU PLACEMENT: follow the recorded drape plan exactly for shoulder side, open-or-pleated pallu, fall direction and visible length. The pallu reads as one continuous placed panel with its artwork and border legible; never duplicate it into extra loose panels, never let it fall behind the body out of frame.
- PLEATS AND BORDER: front pleats stay flat, even and vertical; upper and lower borders stay continuous and identical in width; the hem border stays level.
- HANDS: keep hands away from the pallu artwork, border and pleat stack. A hand may hold the pallu edge open, low and flat, so the artwork stays readable.`,
    kurta_set:
      `- KURTA / KURTI SET POSE GRAMMAR: every frame must sell the complete set. Keep the full length of the kurta from shoulder seam to hem in frame, and keep the bottom wear visible from waistband to hem with the footwear grounded.
- FIT AND LENGTH: stance must show the garment's true fit and true length - no hitching the hem up, no bunching at the waist, no arm crossing the torso to hide the side seam or the hem line.
- SLEEVES: keep both sleeves readable - sleeve length, cuff, and any sleeve embroidery stay unobstructed. Arms stay away from the body far enough that the sleeve silhouette does not collapse against the torso.
- DUPATTA: if a dupatta ships with the set, drape it so it never covers the yoke embroidery, the front placket, the side slit or the bottom wear. Front frames keep it off the centre front; back frames keep it forward over the arms.`,
    long_kurti:
      `- LONG KURTI POSE GRAMMAR: the frame sells fit, fall and length. Keep the complete hem line inside the frame and show the garment hanging naturally at its true length.
- FIT AND LENGTH: stance is relaxed and grounded so the side seams hang straight and the hem stays level. Never hitch, tuck, gather, or hold the hem in a way that shortens the garment.
- SLEEVES AND DETAIL: keep both sleeves, the neckline, the placket and any side slit readable; arms stay clear of the yoke, print and slit.`,
    short_kurti_top:
      `- SHORT KURTI / TOP POSE GRAMMAR: this is the playful, lively half of the catalog. Use natural, candid, in-motion body language - a light step, a turn, a laugh, a hand in the hair, a shoulder tilt, a lean into the set - so the frame feels alive rather than posed.
- MATCH THE POSE TO THE SET: read the backdrop and props actually established for this shoot and let the pose interact with them naturally (leaning on the established wall, seated on the established step, walking through the established space). Never invent new props, furniture or architecture to pose against.
- KEEP THE PRODUCT READABLE: however playful the pose, the top's hem line, neckline, sleeve shape, fit and print must all stay unobstructed and in frame. Movement must not crumple, twist or hide the garment.
- EXPRESSION: genuine, warm, Gen-Z energy - a real smile, a candid glance, natural mid-laugh - never stiff or corporate.`,
    lehenga:
      `- LEHENGA SET POSE GRAMMAR: show the full silhouette - choli, dupatta and the complete skirt flare from waist to hem - with the hem inside the frame.
- SKIRT VOLUME: the skirt keeps its true flare, panel structure and hem weight. Never flatten the volume, and never let a hand or dupatta collapse the silhouette.
- DUPATTA: drape it so it frames rather than hides the choli and the skirt's border work.`,
    dress:
      `- DRESS POSE GRAMMAR: show the complete silhouette from shoulder to hem with the hemline level and inside the frame. Posture is relaxed and elongating so the waist seam, skirt fall and any slit read correctly.
- Keep arms clear of the bodice, waist seam and any side detail.`,
    western_casual:
      `- WESTERN / CASUAL POSE GRAMMAR: relaxed, current, natural street-style body language with easy weight shifts and candid movement.
- Keep the full outfit readable: top hem, waistline, bottom-wear cut and footwear all stay in frame and unobstructed.`,
    other:
      `- GENERAL POSE GRAMMAR: natural, confident, catalog-appropriate body language that keeps the complete garment silhouette, hem and construction readable in every frame.`,
  }[family];
}
