// Prepaid packs in rupees, as set by the owner on 23 Nov 2026. One SKU is one product shot as a six-frame set.

export const FRAMES_PER_SKU = 6;

/** Free SKUs a store gets when it enrolls (app_enroll_seller). */
export const TRIAL_SKUS = 5;

export const PACKS = [
  { skus: 2, price: 500 },
  { skus: 11, price: 2000 },
  { skus: 30, price: 5000 },
  { skus: 60, price: 10000 },
] as const;

export type Pack = (typeof PACKS)[number];

/** Price of one SKU in a pack, rounded to the rupee. */
export const perSku = (pack: Pack) => Math.round(pack.price / pack.skus);

export const rupees = (amount: number) =>
  `₹${Math.round(amount).toLocaleString("en-IN")}`;
