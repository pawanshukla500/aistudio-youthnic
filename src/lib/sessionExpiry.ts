/** Every interactive login session expires strictly after 24 hours (86,400,000 ms). */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SESSION_LOGIN_AT_KEY = "youthnic_auth_login_at";
const FRESH_AUTH_CLOCK_SKEW_MS = 60_000;

export function resolveSessionLoginAtMs(
  authTimeSeconds?: number | string | null,
  storedLoginAtMs?: number | string | null,
): number | null {
  const parsedAuthMs =
    authTimeSeconds !== undefined &&
    authTimeSeconds !== null &&
    String(authTimeSeconds).trim() !== ""
      ? Number(authTimeSeconds) * 1000
      : NaN;
  const parsedStoredMs =
    storedLoginAtMs !== undefined &&
    storedLoginAtMs !== null &&
    String(storedLoginAtMs).trim() !== ""
      ? Number(storedLoginAtMs)
      : NaN;

  const validAuth = Number.isFinite(parsedAuthMs) && parsedAuthMs > 0;
  const validStored = Number.isFinite(parsedStoredMs) && parsedStoredMs > 0;

  if (validAuth && validStored) {
    // Firebase auth_time only advances on a fresh credential login. If auth_time
    // is newer than a stale localStorage entry beyond clock-skew tolerance, trust auth_time.
    if (parsedAuthMs - parsedStoredMs > FRESH_AUTH_CLOCK_SKEW_MS) {
      return parsedAuthMs;
    }
    return Math.min(parsedAuthMs, parsedStoredMs);
  }
  if (validStored) return parsedStoredMs;
  if (validAuth) return parsedAuthMs;
  return null;
}

export function isFirebaseSessionExpired(
  authTimeSeconds?: number | string | null,
  storedLoginAtMs?: number | string | null,
  nowMs = Date.now(),
): boolean {
  const loginAtMs = resolveSessionLoginAtMs(authTimeSeconds, storedLoginAtMs);
  if (loginAtMs === null) return false;
  return nowMs - loginAtMs >= SESSION_MAX_AGE_MS;
}

export function extractFirebaseAuthTimeSeconds(
  tokenResult?: {
    claims?: Record<string, unknown>;
    authTime?: string;
  } | null,
  user?: {
    metadata?: { lastSignInTime?: string };
  } | null,
): number | null {
  const authTimeClaim = tokenResult?.claims?.auth_time;
  if (
    authTimeClaim !== undefined &&
    authTimeClaim !== null &&
    String(authTimeClaim).trim() !== ""
  ) {
    const parsed = Number(authTimeClaim);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (tokenResult?.authTime) {
    const parsedMs = Date.parse(tokenResult.authTime);
    if (Number.isFinite(parsedMs) && parsedMs > 0) return parsedMs / 1000;
  }
  if (user?.metadata?.lastSignInTime) {
    const parsedMs = Date.parse(user.metadata.lastSignInTime);
    if (Number.isFinite(parsedMs) && parsedMs > 0) return parsedMs / 1000;
  }
  return null;
}

export function readStoredSessionLoginAtMs(): number {
  try {
    if (typeof window === "undefined") return 0;
    const raw = window.localStorage.getItem(SESSION_LOGIN_AT_KEY);
    const parsed = Number(raw || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function writeStoredSessionLoginAtMs(loginAtMs: number): void {
  try {
    if (typeof window === "undefined") return;
    if (Number.isFinite(loginAtMs) && loginAtMs > 0) {
      window.localStorage.setItem(
        SESSION_LOGIN_AT_KEY,
        String(Math.floor(loginAtMs)),
      );
    }
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function clearStoredSessionLoginAtMs(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(SESSION_LOGIN_AT_KEY);
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}
