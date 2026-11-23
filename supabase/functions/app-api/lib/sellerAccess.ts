// Who pays for a shoot, who must verify an email first, and who may approve a recharge.
// Pure: no database, network or environment access.

type Loose = Record<string, unknown>;

export const VERIFY_EMAIL_MESSAGE =
  'Verify your email to start your free shoot. Open the link we emailed you, then press "I have verified".';

export const OUT_OF_CREDITS_MESSAGE =
  "You have no shoots left. Open Credits to request a recharge pack, then generate again.";

/** Seller stores that enrolled themselves pay per shoot; the internal organization does not. */
export function isExternalSeller(settings: unknown): boolean {
  return (settings as Loose | null | undefined)?.seller_type === "external";
}

/**
 * The payload of a bearer token, undecoded claims only. Call it after workspaceFor(): that
 * request already had the token's signature checked by the database API.
 */
export function tokenClaims(authorization: string): Loose {
  const parts = authorization.replace(/^Bearer\s+/i, "").trim().split(".");
  if (parts.length !== 3) return {};
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === "object" ? payload as Loose : {};
  } catch {
    return {};
  }
}

/**
 * Before a shoot is queued: `charge` says whether one credit must be consumed, `error` blocks
 * the shoot. An internal organization is never charged and never blocked.
 */
export function sellerShootGate(args: { settings: unknown; claims: Loose }): { charge: boolean; error: string | null } {
  if (!isExternalSeller(args.settings)) return { charge: false, error: null };
  if (args.claims.email_verified !== true) return { charge: false, error: VERIFY_EMAIL_MESSAGE };
  return { charge: true, error: null };
}

/**
 * Recharges are approved by administrators of the primary organization only. A seller is the
 * administrator of its own store, so the role alone is not enough.
 */
export function canApproveRecharges(workspace: {
  organization: Loose;
  isAdmin: boolean;
  permissions: string[];
}): boolean {
  return workspace.organization.is_primary === true &&
    (workspace.isAdmin || workspace.permissions.includes("admin.settings"));
}
