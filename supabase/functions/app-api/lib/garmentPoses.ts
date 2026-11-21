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

/**
 * Construction of the Farshi / Farsi pajama only.
 * Print, colour, motif scale, and length still come from the product references.
 * Palazzo, sharara, salwar, and every other cut must not receive this construction.
 */
export const FARSHI_SILHOUETTE_STRUCTURE =
  "FALL: soft and flowy, but structured, with a fluid or heavy drape. " +
  "WAIST: high-waisted or mid-rise, with an elasticated or fitted waistband, and three waist pleats on each side. " +
  "SIDE JOINT: one large pleat on each side at the side-seam joint (one on the left and one on the right), in addition to the three waist pleats. " +
  "HEM: the hem is narrower than the volume at the waist (the hem is quite narrow from the waist side). A separate hem panel 6 inches wide is joined (seamed) onto the bottom of each leg, and that panel tapers 4 inches from its upper edge to its lower edge (a taper of 4 inches from the upper hem), so the opening at the bottom of the hem is 4 inches narrower than the seam where the hem joins the leg. " +
  "Keep two distinct trouser legs. This joined hem is not a gathered salwar poncha, not churidar rings, and not an open straight palazzo hem.";

/**
 * A dedicated bottom-wear photo confirms Farshi only when analysis was unsure
 * ("none"/"other") or explicitly named Farshi/Farsi/Fasi. Named non-Farshi cuts
 * such as palazzo, sharara, churidar, straight trouser, or skirt stay isolated
 * so Farshi taper/hem rules never bleed onto other silhouettes.
 */
export function effectiveBottomCutClass(
  cutClass: BottomCutClass,
  hasBottomReference: boolean,
  context?: { skuName?: string; productDetails?: string; details?: string },
): BottomCutClass {
  const contextText = context
    ? [
        positiveBottomWearPortion(text(context.skuName)),
        positiveBottomWearPortion(text(context.productDetails)),
        positiveBottomWearPortion(text(context.details)),
      ].filter(Boolean).join(" ")
    : "";
  if (/\b(?:farshi|farsi|fasi)\b/i.test(contextText)) return "farshi";
  if (hasBottomReference && cutClass === "none") return "farshi";
  return cutClass;
}

/**
 * Analyses written before the joined-hem lock told the model the Farshi was
 * untapered. Those clauses cancel the silhouette, so they are removed only
 * from Farshi specifications. A dhoti taper ban is kept.
 */
export function withoutFarshiStructureContradictions(details: string): string {
  return details
    .replace(/\bnot\s+tapered\s+at\s+(?:the\s+)?ankle\b/gi, "")
    .replace(/\bnot\s+gathered\s+into\s+an\s+ankle\s+cuff\b/gi, "")
    .replace(/\bnot\s+tapered\b(?!\s+into\b)/gi, "")
    .replace(/([,;])(?:\s*[,;])+/g, "$1")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Pose briefs that forbid every cuff would delete the Farshi hem panel. */
export function reconcileFarshiVisibilityRules(rules: string): string {
  return rules
    .replace(/never gathered into cuffs/gi, "keep the 6-inch joined Farshi hem with its 4-inch taper; never a gathered salwar cuff")
    .replace(/\bnot\s+tapered\s+at\s+(?:the\s+)?ankle\b/gi, "keep the 4-inch Farshi hem taper")
    .replace(/\bnot\s+gathered\s+into\s+an\s+ankle\s+cuff\b/gi, "not a gathered salwar poncha");
}

const ABSENT_BOTTOM_WEAR =
  /^(unknown|unproven|none|n\/a|na|n\.a\.?|not applicable|standalone|not visible|not recorded|not specified|no bottom(?:s)?(?:\s+wear)?|no trousers?|no pants?)(\b|[.\s-]|$)/i;
const BOTTOM_GARMENT_CLASS =
  /\b(?:farshi|farsi|fasi|pajama|pyjama|palazzo|trousers?|pants?|sharara|gharara|salwar|patiala|churidar|skirt|lehenga|leggings?|dhoti|culottes?|shorts?)\b/i;

const BENGALI_SAREE_RE =
  /\b(bengali|bangla(?:deshi)?|bengal|tant|taant|jamdani|dhakai|garad|garod|korial|baluchari|swarnachari|kantha|lal\s*paar|laal\s*paar|red\s*and\s*white\s*saree|shantipuri|begumpuri|murshidabad|bishnupuri|atpoure|aatpoure|athpourey|aanchal|anchal)\b/i;
const SAREE_RE = /\bsarees?\b|\bsari\b/i;
const LEHENGA_RE = /\b(lehenga|lehanga|ghagra|chaniya\s*choli)\b/i;
const KURTA_RE = /\b(kurta|kurti|kurtha|kurtis|kurtas|salwar\s*suit|churidar\s*suit|anarkali)\b/i;
// A co-ord set is ethnic or western depending on the rest of the garment, so it
// only joins the kurta family when nothing western is claimed alongside it.
const COORD_RE = /\bco-?ord(?:inate)?s?\b/i;
const TOP_ONLY_RE = /\b(top|tee|t-?shirt|shirt|blouse|crop\s*top|tunic|camisole|corset|bustier|peplum)\b/i;
const DRESS_RE = /\b(dress|gown|maxi|midi\s*dress|jumpsuit|kaftan|kaftaan|caftan)\b/i;
const WESTERN_RE = /\b(western|casual|denim|jeans|athleisure|street\s*wear)\b/i;

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
  const raw = product.bottomWearDetails ?? product.bottom_wear_details;
  if (typeof raw === "string") return raw.trim();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const parts = [
      text(obj.classification),
      text(obj.cutTruth),
      text(obj.waistAndPleating),
      text(obj.legVolume),
      text(obj.hemline),
      text(obj.fabricColorPrint),
      text(obj.negativeConstraints),
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(". ");
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v || "")}`)
      .join(". ");
  }
  return "";
}

/**
 * Positive descriptors of the recorded specification. Negated clauses (e.g.
 * "Palazzo - NOT farshi" or "No dupatta, pink kurti with farshi salwar")
 * have their negated portion stripped per clause so earlier unrelated negations
 * don't erase valid bottom descriptors later in the string.
 */
export function positiveBottomWearPortion(details: string): string {
  if (!details || ABSENT_BOTTOM_WEAR.test(details)) return "";
  const cleaned = details.replace(
    /\bwithout\s+(?:a\s+|an\s+|any\s+)?(?:dupatta|stole|scarf|sleeves?|lining|embroidery|pockets?)\b/gi,
    " ",
  );
  const clauses = cleaned.split(/(?:[,;.\n]+|\s+[-–—]+\s+)/);
  return clauses
    .map((clause) => {
      const firstNegative = clause.search(/\b(?:not|never|without|no)\b/i);
      return (firstNegative === -1 ? clause : clause.slice(0, firstNegative)).trim();
    })
    .filter(Boolean)
    .join(" ");
}

export function hasBottomWearInAnalysis(productIdentity: unknown): boolean {
  const positive = positiveBottomWearPortion(recordedBottomWearText(productIdentity));
  return Boolean(positive) && BOTTOM_GARMENT_CLASS.test(positive);
}

export function classifyBottomCut(
  detailsOrProduct: unknown,
  extraContext?: { skuName?: string; productDetails?: string },
): BottomCutClass {
  const isObj = detailsOrProduct && typeof detailsOrProduct === "object" && !Array.isArray(detailsOrProduct);
  const details = typeof detailsOrProduct === "string"
    ? detailsOrProduct
    : recordedBottomWearText(detailsOrProduct);
  const positive = positiveBottomWearPortion(details);

  const contextStr = [
    positiveBottomWearPortion(text(extraContext?.skuName)),
    positiveBottomWearPortion(text(extraContext?.productDetails)),
  ].filter(Boolean).join(" ");

  // Direct check for Farshi / Farsi / Fasi in positive details
  if (/\b(?:farshi|farsi|fasi)\b/i.test(positive)) return "farshi";

  if (isObj) {
    const product = detailsOrProduct as JsonRecord;
    const positiveExtra = [
      positiveBottomWearPortion(text(product.skuName ?? product.sku_name)),
      positiveBottomWearPortion(text(product.title ?? product.name)),
      positiveBottomWearPortion(text(product.productDetails ?? product.product_details)),
      positiveBottomWearPortion(text(product.silhouette)),
      positiveBottomWearPortion(text(product.bottomWear)),
      positiveBottomWearPortion(text(product.bottom_wear)),
    ].join(" ");
    if (/\b(?:farshi|farsi|fasi)\b/i.test(positiveExtra)) return "farshi";
  }

  if (contextStr && /\b(?:farshi|farsi|fasi)\b/i.test(contextStr)) {
    return "farshi";
  }

  if (!positive && !isObj) return "none";
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
  skuName?: string;
  productDetails?: string;
  hasBottomReference?: boolean;
}): BottomWearPresentation {
  const mode = normalizeBottomWearMode(args.mode);
  const details = recordedBottomWearText(args.productIdentity);
  const recordedInAnalysis = hasBottomWearInAnalysis(args.productIdentity);
  const includesBottomWear = mode === "included"
    ? true
    : mode === "top_only"
    ? false
    : (args.hasBottomReference ? true : recordedInAnalysis);
  const cutClass = includesBottomWear
    ? classifyBottomCut(args.productIdentity ?? details, {
        skuName: args.skuName,
        productDetails: args.productDetails,
      })
    : "none";
  return {
    mode,
    includesBottomWear,
    recordedInAnalysis,
    details: includesBottomWear ? details : "",
    cutClass,
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
  const sanitizedSareeFabric = text(sareeBody.mainFabric)
    .replace(/\b(?:n\/a|not|non|never|no|without)\b[\s\-–—]*(?:a\s+)?saree\b/gi, "")
    .replace(/^(?:n\/a|na|none)\b[\s\-–—:]*/i, "")
    .trim();
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
    sanitizedSareeFabric,
    sareeBody.weave,
    sareeBody.pattern,
  ]).replace(/\b(?:not|non|never|no|without)\s+(?:a\s+)?saree\b/gi, "");

  const explicitNonSareeFamily = Boolean(garmentFamily && garmentFamily !== "other" && !SAREE_RE.test(garmentFamily));
  const hasRealSareeTruth = Boolean(sanitizedSareeFabric || text(sareeBody.weave) || text(sareeBody.pattern));
  const isSaree = garmentFamily === "saree" ||
    SAREE_RE.test(`${garmentFamily} ${category}`) ||
    (!explicitNonSareeFamily && hasRealSareeTruth && SAREE_RE.test(haystack));
  if (isSaree) return BENGALI_SAREE_RE.test(haystack) ? "saree_bengali" : "saree_ethnic";

  if (LEHENGA_RE.test(haystack)) return "lehenga";

  const looksWestern = garmentFamily === "western_or_casual" || WESTERN_RE.test(haystack);
  const looksKurta = garmentFamily.includes("kurta") || garmentFamily.includes("kurti") ||
    KURTA_RE.test(haystack) || (COORD_RE.test(haystack) && !looksWestern);
  if (looksKurta) {
    if (hasBottomWearInAnalysis(product)) return "kurta_set";
    if (isShortUpperGarment(product, haystack)) return "short_kurti_top";
    return "long_kurti";
  }

  if (DRESS_RE.test(haystack) || garmentFamily === "dress") return "dress";
  // A cropped top takes the playful short-top grammar whether it is ethnic or
  // western, so this stays ahead of the broader western/casual bucket.
  if (TOP_ONLY_RE.test(haystack)) return "short_kurti_top";
  if (looksWestern) return "western_casual";
  return "other";
}

function isShortUpperGarment(product: JsonRecord, haystack: string) {
  const length = text(product.length);
  if (SHORT_LENGTH_RE.test(length)) return true;
  if (LONG_LENGTH_RE.test(length)) return false;
  return SHORT_LENGTH_RE.test(haystack) && !LONG_LENGTH_RE.test(haystack);
}

/**
 * The coarse `productIdentity.garmentFamily` a declared category implies, or ""
 * when the category is too broad to tell (for example "ethnic/fusion", which
 * covers both sarees and kurta sets).
 *
 * Used before analysis has run, where the category is the only signal. Returning
 * "" there is deliberate: feedback recorded for one family must not be applied
 * to another just because the category could not decide between them.
 */
export function coarseGarmentFamilyForCategory(category: string): string {
  const family = detectGarmentPoseFamily({ productIdentity: {}, category });
  if (isSareePoseFamily(family)) return "saree";
  if (family === "kurta_set" || family === "long_kurti" || family === "short_kurti_top") {
    return "kurta_or_kurti_set";
  }
  if (family === "dress") return "dress";
  if (family === "western_casual") return "western_or_casual";
  return "";
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
export function garmentPoseDirection(
  family: GarmentPoseFamily,
  options: { croppedAboveAnkles?: boolean } = {},
): string {
  const cropped = options.croppedAboveAnkles === true;
  return {
    saree_bengali:
      `- BENGALI SAREE POSE GRAMMAR: pose with quiet, upright, living-human grace centered in an open floor clearing (never pinned behind or leaning against a foreground pillar). Shoulders relaxed, spine tall, chin level, weight settled naturally on one leg.
- PALLU (AANCHAL) PLACEMENT: the pallu must read as a deliberately placed panel, not stray cloth. Keep its recorded shoulder side, fall direction and visible length exactly as the drape plan states. Where the drape is aatpoure/Bengali style, the pallu comes over the shoulder and its border and end-piece artwork stay readable; never bunch, twist, fold away, or hide the pallu behind an arm.
- PLEATS AND BORDER: front pleats stay flat, evenly stacked and vertical; the upper and lower borders stay continuous and unbroken along the body and across the pallu edge; the lower border stays parallel to the floor and never rides up. If references show a strapless mannequin wrap with no stitched blouse, pair with a plain undecorated solid modest half/elbow-sleeve blouse with zero invented motifs or ties.
- HANDS: strictly two natural human arms with relaxed fingers (never copy mannequin straight arms or splayed plastic fingers). Every arm/wrist follows an exterior path outside the saree pleats — NEVER poke a hand through an imaginary mid-pleat or pallu slit, NEVER cover pallu artwork or border, and NEVER render a third/phantom hand.`,
    saree_ethnic:
      `- ETHNIC SAREE POSE GRAMMAR: graceful, poised, living-human editorial posture centered cleanly in an open floor zone with room breathing room (never jammed behind a foreground pillar; Poses 1, 2, 3 and 5 and a product-led Pose 4 or 6 never copy a seated/leaning reference pose, while a Pose 4 or 6 the pose plan matches to the style reference follows that plan) — tall spine, soft shoulders, easy weight shift, varied framing/angle across poses.
- PALLU PLACEMENT: follow the recorded drape plan exactly for shoulder side, open-or-pleated pallu, fall direction and visible length. The pallu reads as one continuous placed panel with its artwork and border legible; never duplicate it into extra loose panels, never let it fall behind the body out of frame.
- PLEATS AND BORDER: front pleats stay flat, even and vertical; upper and lower borders stay continuous and identical in width; the hem border stays level. If product references show a strapless knotted mannequin wrap with no blouse, wear a plain undecorated modest basic short- or elbow-sleeve blouse in a cohesive solid shade locked across all poses without inventing embroidery, prints, cutouts, or ties.
- HANDS: strictly two continuous exterior arms and hands with soft relaxed human fingers (zero splayed stiff plastic fingers, zero forearm clawing). Any hand touching the pallu/hem holds ONLY the exterior outer edge cleanly from outside — NEVER emerge hands through a phantom slit inside pleats or chest wrap, and keep hands clear of pallu artwork and border artwork.`,
    kurta_set: cropped
      ? `- KURTA / KURTI SET POSE GRAMMAR: frame this look within the planned closer editorial crop so the kurta neckline, yoke, sleeves, torso fit, side detail, and any visible upper bottom wear read richly and vary camera proximity cleanly from Pose 1 without forcing out-of-frame ankles or footwear.
- FIT AND HANDS: relaxed natural shoulder/elbow curve with both arms clearly outside the kurta and dupatta perimeter — never push a hand out through a closed front kurta or dupatta slit, never grip the opposite forearm awkwardly, and never cover yoke/chest craft with fingers.
- SLEEVES: keep both sleeves readable - sleeve length, cuff, and any sleeve embroidery stay unobstructed. Arms stay clear of the torso enough for natural garment drape.
- DUPATTA: if a dupatta ships with the set, drape it over one shoulder and clear forearm so it never hides yoke embroidery, center placket, side slits, or upper bottom wear.`
      : `- KURTA / KURTI SET POSE GRAMMAR: every full-length frame must sell the complete set while visibly diverging in torso angle, camera distance, or studio floor placement across Poses 1, 2, 4, and 6. Keep the full length of the kurta from shoulder seam to hem and the bottom wear from waistband to hem readable with natural stance.
- FIT AND HANDS: relaxed human weight shift with varied arm choreography (never identical robot straight arms in Poses 1, 2, 4). Arms stay outside the closed kurta/dupatta perimeter — NEVER poke a hand out through an imaginary kurta or dupatta slit, never claw the opposite forearm, and never cover yoke embroidery or hem lace.
- SLEEVES: keep both sleeves readable - sleeve length, cuff, and sleeve embroidery stay unobstructed without pinching awkwardly into the waist.
- DUPATTA: if a dupatta ships with the set, drape it smoothly so yoke craft, placket, side slits, and bottom wear stay clear. Front/angled frames keep the center clear; back frames sweep hair and dupatta cleanly forward over forearms.`,
    long_kurti: cropped
      ? `- LONG KURTI POSE GRAMMAR: the planned closer editorial crop highlights bodice fit, neckline, sleeves, side drape, and natural human body language clearly without forcing out-of-frame lower hem or feet.
- FIT AND HANDS: keep the upper silhouette smooth with natural relaxed fingers and elbows — never stiff straight arms or fingers covering chest/neckline craft; keep neutral bottoms understated and non-matching.`
      : `- LONG KURTI POSE GRAMMAR: the frame sells fit, fall, side slits, and true length with varied camera angles across Poses 1, 2, 4, and 6 while keeping understated neutral bottoms clearly secondary. Keep the complete hem line inside the frame hanging cleanly at its true length.
- FIT AND HANDS: relaxed living-human stance (never mannequin dead-hang arms) so side seams hang straight and hem stays level. Never hitch, tuck, gather, or shorten the hem, and never block neckline, placket, or side slits with hands.`,
    short_kurti_top:
      `- SHORT KURTI / TOP POSE GRAMMAR: fill the frame purposefully around the top so neckline craft, sleeves, yoke, and waist/hip hem read close and crisp rather than shrinking the top into distant full-body pavement shots. Use varied gentle torso angles, natural shoulder tilt, or soft weight shifts across frames — never freeze a laugh, a walking stride, or a wide leg split.
- MATCH THE POSE TO THE SET: ${cropped ? "maintain balanced, relaxed three-quarter/knees-up posture closer to the camera so top details shine." : "both feet stay planted and close, with the camera sized so the top remains the clear visual hero."} Do not sit because the style photo sits (Poses 1, 2, 3 and 5 and a product-led Pose 4 or 6; a Pose 4 or 6 the pose plan matches to the style reference follows that plan), do not lean behind foreground pillars, and do not invent furniture or handheld coffee/bags.
- NATURAL HANDS & PRODUCT READABILITY: keep relaxed soft fingers with a continuous visible forearm/wrist path outside garment seams (one hand softly beside pocket/hip edge or gentle wrist curve; zero splayed stiff plastic fingers, zero forearm clawing, NEVER press fingers over chest embroidery, and NEVER lock both arms identically stiff at the sides across multiple poses). Top hem line, neckline, sleeve shape, fit, and print stay 100% unobstructed.
- EXPRESSION: calm and genuine - a small relaxed smile or an easy glance - never a frozen mid-laugh or a stiff corporate stare.`,
    lehenga: cropped
      ? `- LEHENGA SET POSE GRAMMAR: highlight the choli, dupatta drape, waist detail, and visible upper skirt volume within this pose's planned crop without forcing out-of-frame floor hem or feet.
- SKIRT VOLUME: the visible skirt keeps its true flare and panel structure without flattening or hand-crushing.
- DUPATTA & HANDS: drape it so it frames rather than hides the choli and visible skirt border work, with relaxed continuous arms outside the pleats.`
      : `- LEHENGA SET POSE GRAMMAR: show the full silhouette - choli, dupatta and the complete skirt flare from waist to hem - with the hem inside the frame.
- SKIRT VOLUME: the skirt keeps its true flare, panel structure and hem weight. Never flatten the volume, and never let a hand or dupatta collapse the silhouette.
- DUPATTA & HANDS: drape it so it frames rather than hides the choli and the skirt's border work, with natural living hands along exterior drape edges only.`,
    dress: cropped
      ? `- DRESS POSE GRAMMAR: keep the bodice, neckline, waist seam, and visible skirt fall readable within this pose's planned crop without forcing out-of-frame hemline or feet. Posture is relaxed, warm, and elongating.
- Keep natural relaxed arms clear of the bodice, waist seam and any side detail.`
      : `- DRESS POSE GRAMMAR: show the complete silhouette from shoulder to hem with the hemline level and inside the frame. Posture is relaxed and elongating so the waist seam, skirt fall and any slit read correctly.
- Keep natural relaxed arms clear of the bodice, waist seam and any side detail.`,
    western_casual: cropped
      ? `- WESTERN / CASUAL POSE GRAMMAR: relaxed, current, natural editorial body language with varied proximity and gentle shoulder/hip weight shifts.
- Keep the visible outfit readable within this pose's planned crop: top hem, waistline, and visible upper bottom-wear cut stay unobstructed without forcing out-of-frame ankles or footwear. Keep hands natural without copied drinks/bags/phones.`
      : `- WESTERN / CASUAL POSE GRAMMAR: relaxed, current, natural street-style body language with easy weight shifts and candid movement.
- Keep the full outfit readable: top hem, waistline, bottom-wear cut and footwear all stay in frame and unobstructed. Never repeat identical hanging robot arms across poses.`,
    other:
      `- GENERAL POSE GRAMMAR: natural, living-human editorial body language with relaxed wrists/fingers and distinct angle/distance per pose that keeps the complete garment silhouette, hem and construction readable in every frame.`,
  }[family];
}
