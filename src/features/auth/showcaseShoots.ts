// Two real shoots from the VB Export workspace, published on the login page with the owner's go-ahead.
// The facts are the stored product analysis and the check scores are each frame's product DNA check.
// The model face and style reference photo of the wine kaftan shoot is a third-party image, so it is
// listed as an input without its picture.

const IMG = "/images/showcase";

export type ShowcaseInput = { role: string; image?: string };
export type ShowcaseFrame = { image: string; check: number };

export type ShowcaseShoot = {
  name: string;
  shotOn: string;
  /** CSS aspect-ratio of the delivered frames. */
  ratio: string;
  inputs: ShowcaseInput[];
  facts: Array<[label: string, value: string]>;
  frames: ShowcaseFrame[];
};

const frames = (slug: string, checks: number[]): ShowcaseFrame[] =>
  checks.map((check, i) => ({ image: `${IMG}/${slug}-pose-${i + 1}.webp`, check }));

export const WINE_KAFTAN: ShowcaseShoot = {
  name: "Wine kaftan",
  shotOn: "23 Nov 2026",
  ratio: "4 / 5",
  inputs: [
    { role: "Front", image: `${IMG}/wine-kaftan-ref-front.webp` },
    { role: "Back", image: `${IMG}/wine-kaftan-ref-back.webp` },
    { role: "Embroidery", image: `${IMG}/wine-kaftan-ref-fabric.webp` },
    { role: "Full length", image: `${IMG}/wine-kaftan-ref-mannequin.webp` },
    { role: "Sleeve", image: `${IMG}/wine-kaftan-ref-additional.webp` },
    { role: "Model face" },
    { role: "Style reference" },
  ],
  facts: [
    ["Category", "Ethnic / fusion"],
    ["Main colour", "Deep wine / burgundy-maroon with metallic copper-gold sheen"],
    ["Fabric", "Sheer crinkled tissue-silk / metallic organza with high-gloss crushed texture"],
    ["Pattern", "Mirrored floral-crest embroidery on black ground panel set into a sheer wine metallic body"],
    ["Neckline", "Round neckline, moderately scooped, finished with narrow gold braid edge"],
  ],
  frames: frames("wine-kaftan", [92, 92, 90, 91, 91, 91]),
};

export const KITKAT_KATTHA: ShowcaseShoot = {
  name: "Kitkat Kattha top",
  shotOn: "22 Nov 2026",
  ratio: "3 / 4",
  inputs: [{ role: "Front", image: `${IMG}/kitkat-kattha-ref-front.webp` }],
  facts: [
    ["Main colour", "Rust kattha / terracotta reddish-brown"],
    ["Fabric", "Matte lightweight cotton, soft plain weave, no sheen"],
    ["Pattern", "Ajrakh-inspired block-print medallions and paisley buttas in black and cream on rust ground"],
    ["Neckline", "Wide square neckline front and back"],
    ["Highlight", "Centre-back self-fabric lace-up closure"],
  ],
  frames: frames("kitkat-kattha", [96, 95, 95, 96, 96, 95]),
};
