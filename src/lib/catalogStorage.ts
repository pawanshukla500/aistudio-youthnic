import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseStorage } from "./firebase";
import { supabase } from "./supabase";

export const CATALOG_ASSET_BUCKET = "catalog-assets";
const BROWSER_SIGNED_URL_TTL_SECONDS = 60 * 60;

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
    "organizations",
    args.organizationId,
    "references",
    safeSegment(args.ownerKey, "unassigned"),
    safeSegment(args.role, "reference"),
    `${crypto.randomUUID()}-${extensionSafeName}`,
  ].join("/");

  const storageRef = ref(firebaseStorage, storagePath);
  await uploadBytes(storageRef, args.file, {
    contentType: args.file.type || "image/jpeg",
    cacheControl: "public,max-age=31536000",
  });
  const downloadUrl = await getDownloadURL(storageRef);

  return {
    storageBackend: "firebase" as const,
    storagePath,
    downloadUrl,
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
  // Firebase assets are served directly via their download URL; no Supabase round-trip needed
  if (backend !== "supabase" || !storagePath) return fallbackUrl;
  const { data, error } = await supabase.storage.from(CATALOG_ASSET_BUCKET).createSignedUrl(storagePath, BROWSER_SIGNED_URL_TTL_SECONDS);
  return error || !data?.signedUrl ? fallbackUrl : data.signedUrl;
}

