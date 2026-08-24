import { supabase } from "./supabase";

export const CATALOG_ASSET_BUCKET = "catalog-assets";
const BROWSER_SIGNED_URL_TTL_SECONDS = 60 * 60;
const UPLOAD_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export type CatalogStorageBackend = "firebase" | "supabase" | "external";

function safeSegment(value: string, fallback: string) {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || fallback;
}

export async function uploadCatalogAsset(args: {
  organizationId: string;
  scope: "references" | "catalog";
  ownerKey: string;
  role: string;
  file: File;
}) {
  const extensionSafeName = safeSegment(args.file.name, "asset.jpg");
  const storagePath = [
    args.organizationId,
    args.scope,
    safeSegment(args.ownerKey, "unassigned"),
    safeSegment(args.role, "reference"),
    `${crypto.randomUUID()}-${extensionSafeName}`,
  ].join("/");
  const bucket = supabase.storage.from(CATALOG_ASSET_BUCKET);
  const { error: uploadError } = await bucket.upload(storagePath, args.file, {
    contentType: args.file.type || "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  const { data: signed, error: signError } = await bucket.createSignedUrl(storagePath, UPLOAD_SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    await bucket.remove([storagePath]).catch(() => undefined);
    throw new Error(`Supabase Storage signing failed: ${signError?.message || "no signed URL returned"}`);
  }
  return {
    storageBackend: "supabase" as const,
    storagePath,
    downloadUrl: signed.signedUrl,
  };
}

export async function resolveCatalogAssetUrl(args: {
  storageBackend?: unknown;
  storagePath?: unknown;
  fallbackUrl?: unknown;
}) {
  const backend = String(args.storageBackend || "firebase");
  const storagePath = String(args.storagePath || "");
  const fallbackUrl = String(args.fallbackUrl || "");
  if (backend !== "supabase" || !storagePath) return fallbackUrl;
  const { data, error } = await supabase.storage.from(CATALOG_ASSET_BUCKET).createSignedUrl(storagePath, BROWSER_SIGNED_URL_TTL_SECONDS);
  return error || !data?.signedUrl ? fallbackUrl : data.signedUrl;
}
