export interface MatchableAsset {
  storagePath: string;
  storageBackend?: string;
  fallbackUrl?: string;
}

function cleanPathString(value: string): string {
  const noQuery = String(value || "").split("?")[0].trim();
  if (!noQuery) return "";
  let decoded = "";
  try {
    decoded = decodeURIComponent(noQuery);
  } catch {
    decoded = noQuery;
  }
  return decoded
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/**
 * Robustly matches an incoming image request path against an allowed list of generation assets.
 * Handles:
 * - Exact storage path match (e.g. "organizations/org-123/.../1-pose.jpg")
 * - Exact fallback URL match (e.g. "https://firebasestorage.../1-pose.jpg?alt=media&token=xyz")
 * - URL without query parameters (e.g. stripped tokens or ?alt=media)
 * - Encoded URL path segments (e.g. organizations%2Forg-123)
 * - Relative filename / segment suffix match on path boundaries (e.g. "1-pose.jpg")
 * Strictly prevents substring collisions (e.g. "1-pose.jpg" will NEVER match "11-pose.jpg" or "hero.jpg").
 */
export function matchImageAsset<T extends MatchableAsset>(
  allowed: T[],
  queryPath: string,
): T | undefined {
  const raw = String(queryPath || "").trim();
  if (!raw || raw.includes("\0")) return undefined;

  const cleanQuery = cleanPathString(raw);
  if (!cleanQuery) return undefined;

  const noQuery = raw.split("?")[0].trim();

  return allowed.find((candidate) => {
    // 1. Exact raw match
    if (candidate.storagePath === raw || candidate.fallbackUrl === raw) return true;

    // 2. Fallback URL matching (without query parameters & decoded)
    if (candidate.fallbackUrl) {
      const fbNoQuery = candidate.fallbackUrl.split("?")[0].trim();
      if (fbNoQuery === noQuery) return true;
    }

    // 3. Storage path boundary-aware matching
    const candClean = cleanPathString(candidate.storagePath);
    if (candClean) {
      if (candClean === cleanQuery) return true;
      if (cleanQuery.endsWith("/" + candClean)) return true;
      if (candClean.endsWith("/" + cleanQuery)) return true;
    }

    // 4. Fallback URL path boundary-aware matching (if storagePath was absent or matched via URL)
    if (candidate.fallbackUrl) {
      const fallbackClean = cleanPathString(candidate.fallbackUrl);
      if (fallbackClean) {
        if (fallbackClean === cleanQuery) return true;
        if (cleanQuery.endsWith("/" + fallbackClean)) return true;
        if (fallbackClean.endsWith("/" + cleanQuery)) return true;
      }
    }

    return false;
  });
}
