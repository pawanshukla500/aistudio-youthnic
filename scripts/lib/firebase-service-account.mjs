import { createSign } from "node:crypto";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signJwt(account, payload, header = {}) {
  const encodedHeader = base64Url(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
    ...(account.private_key_id ? { kid: account.private_key_id } : {}),
    ...header,
  }));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const input = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(account.private_key.replace(/\\n/g, "\n"), "base64url")}`;
}

export function parseServiceAccount(raw) {
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing from .env.local.");
  const candidates = [raw];
  try {
    candidates.push(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    // The raw JSON representation remains available.
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.client_email && parsed.private_key && parsed.project_id) return parsed;
    } catch {
      // Try the next supported representation.
    }
  }
  throw new Error("FIREBASE_SERVICE_ACCOUNT must be compact JSON or base64-encoded JSON.");
}

export async function getGoogleAccessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(account, {
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit",
    iat: now,
    exp: now + 3600,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || `Google authorization failed (${response.status}).`);
  }
  return result.access_token;
}

export async function listFirebaseUsers(account) {
  const accessToken = await getGoogleAccessToken(account);
  const users = [];
  let nextPageToken = "";
  do {
    const query = new URLSearchParams({ maxResults: "1000" });
    if (nextPageToken) query.set("nextPageToken", nextPageToken);
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/accounts:batchGet?${query}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error?.message || `Firebase user listing failed (${response.status}).`);
    users.push(...(result.users || []));
    nextPageToken = result.nextPageToken || "";
  } while (nextPageToken);
  return users;
}

export async function createFirebaseIdToken(account, webApiKey, uid) {
  const now = Math.floor(Date.now() / 1000);
  const customToken = signJwt(account, {
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
    claims: { role: "authenticated" },
  });
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(webApiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.idToken) {
    throw new Error(result?.error?.message || `Firebase custom-token exchange failed (${response.status}).`);
  }
  return result.idToken;
}

