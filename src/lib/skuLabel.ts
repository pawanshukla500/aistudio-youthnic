const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SkuFields = { skuId?: string | null; skuName?: string | null } | null | undefined;

/** The SKU code to show. Clones made before #189 stored their internal planning id as skuId. */
export function skuLabel(job: SkuFields) {
  const code = String(job?.skuId || "").trim();
  if (code && !UUID_LIKE.test(code)) return code;
  return String(job?.skuName || "").trim() || "Untitled shoot";
}

/** A safe file-name stem from the SKU label. */
export function skuFileStem(job: SkuFields) {
  return skuLabel(job).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "Youthnic";
}
