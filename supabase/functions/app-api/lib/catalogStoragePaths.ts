function normalizedPath(value: string) {
  const path = String(value || "").replace(/^\/+/, "");
  if (
    !path ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Catalog Storage path is invalid.");
  }
  return path;
}

function requireOrganizationId(orgId: string) {
  const value = String(orgId || "").trim();
  if (!value || value.includes("/")) {
    throw new Error("Catalog Storage organization context is invalid.");
  }
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The private Supabase bucket stores objects under `<organization id>/...`. */
export function supabaseCatalogPath(orgId: string, requestedPath: string) {
  const organizationId = requireOrganizationId(orgId);
  const normalized = normalizedPath(requestedPath);
  const legacyPrefix = `organizations/${organizationId}/`;
  const path = normalized.startsWith(legacyPrefix)
    ? `${organizationId}/${normalized.slice(legacyPrefix.length)}`
    : normalized;
  if (!path.startsWith(`${organizationId}/`)) {
    throw new Error("Catalog Storage path is outside the organization prefix.");
  }
  return path;
}

/**
 * Firebase is legacy-only. Its historical object names have exactly two
 * allowed tenant layouts; accepting a substring would permit an organization
 * identifier embedded inside another tenant's object name.
 */
export function firebaseCatalogPath(orgId: string, requestedPath: string) {
  const organizationId = requireOrganizationId(orgId);
  const path = normalizedPath(requestedPath);
  const organizationPrefix = `organizations/${organizationId}/`;
  const userPrefix = new RegExp(
    `^users/[^/]+/organizations/${escapeRegExp(organizationId)}/`,
  );
  if (!path.startsWith(organizationPrefix) && !userPrefix.test(path)) {
    throw new Error(
      "The Firebase reference path is outside the current organization.",
    );
  }
  return path;
}
