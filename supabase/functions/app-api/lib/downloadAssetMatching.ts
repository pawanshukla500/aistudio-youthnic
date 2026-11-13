export interface MatchableAsset {
  storagePath: string;
  storageBackend?: string;
  fallbackUrl?: string;
}

/**
 * Robustly matches an incoming image request path against an allowed list of generation assets.
 * Handles:
 * - Exact storage path match (e.g. "organizations/org-123/.../1-pose.jpg")
 * - Exact fallback URL match (e.g. "https://firebasestorage.../1-pose.jpg?alt=media&token=xyz")
 * - URL without query parameters (e.g. stripped tokens or ?alt=media)
 * - Encoded URL path segments (e.g. organizations%2Forg-123)
 * - Exact path boundary suffix match (must be preceded by a slash, e.g. "/1-pose.jpg")
 * Strictly prevents substring collisions (e.g. "1-pose.jpg" will NEVER match "11-pose.jpg").
 */
export function matchImageAsset<T extends MatchableAsset>(
  allowed: T[],
  queryPath: string,
): T | undefined {
  const raw = String(queryPath || "").trim();
  if (!raw) return undefined;
  const noQuery = raw.split("?")[0];
  let decoded = "";
  try {
    decoded = decodeURIComponent(noQuery);
  } catch {
    decoded = noQuery;
  }
  const cleanQuery = decoded
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return allowed.find((candidate) => {
    if (candidate.storagePath === raw || candidate.fallbackUrl === raw) return true;
    if (candidate.fallbackUrl && candidate.fallbackUrl.split("?")[0] === noQuery) return true;
    const candClean = candidate.storagePath
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    if (!candClean) return false;
    if (candClean === cleanQuery) return true;
    if (cleanQuery.endsWith(`/${candClean}`)) return true;
    if (candClean.endsWith(`/${cleanQuery}`)) return true;
    return false;
  });
}
