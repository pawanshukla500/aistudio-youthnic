type ServiceAccount = { client_email: string; private_key: string; private_key_id?: string; project_id?: string };
type CachedToken = { value: string; expiresAt: number; scope: string };
let cachedToken: CachedToken | null = null;

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured in the Supabase Edge Function.`);
  return value;
}

function serviceAccount(): ServiceAccount {
  const raw = requiredEnv("FIREBASE_SERVICE_ACCOUNT");
  const candidates = [raw];
  try {
    candidates.push(new TextDecoder().decode(Uint8Array.from(atob(raw), (character) => character.charCodeAt(0))));
  } catch {
    // Plain JSON is the preferred representation. Only treat the value as
    // base64 when decoding is valid; an eager atob(raw) would reject JSON
    // before the valid first candidate could be parsed.
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ServiceAccount;
      if (parsed.client_email && parsed.private_key) return parsed;
    } catch {
      // Try the next supported representation.
    }
  }
  throw new Error("FIREBASE_SERVICE_ACCOUNT must be valid JSON or base64-encoded JSON.");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToBytes(pem: string) {
  const base64 = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export async function googleAccessToken(scopes: string[]) {
  const scope = [...new Set(scopes)].sort().join(" ");
  if (cachedToken && cachedToken.scope === scope && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    alg: "RS256", typ: "JWT", ...(account.private_key_id ? { kid: account.private_key_id } : {}),
  })));
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    iss: account.client_email, sub: account.client_email, aud: "https://oauth2.googleapis.com/token",
    scope, iat: now, exp: now + 3600,
  })));
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToBytes(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const assertion = `${input}.${bytesToBase64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !(data as { access_token?: string }).access_token) throw new Error((data as { error_description?: string }).error_description || `Google authorization failed (${response.status}).`);
  cachedToken = { value: (data as { access_token: string }).access_token, expiresAt: Date.now() + Number((data as { expires_in?: number }).expires_in || 3600) * 1000, scope };
  return cachedToken.value;
}

async function identityToolkit(path: string, body: Record<string, unknown>) {
  const account = serviceAccount();
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID")?.trim() || account.project_id;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured.");
  const token = await googleAccessToken(["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/identitytoolkit"]);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: { message?: string } })?.error?.message || `Firebase Auth request failed (${response.status}).`);
  return data as Record<string, unknown>;
}

export async function createFirebaseUser(args: { email: string; password: string; displayName: string }) {
  return identityToolkit("/accounts", { email: args.email, password: args.password, displayName: args.displayName, emailVerified: false, disableUser: false }) as Promise<{ localId: string }>;
}

export async function updateFirebaseUser(args: { uid: string; disabled?: boolean; displayName?: string; customClaims?: Record<string, unknown> }) {
  return identityToolkit("/accounts:update", {
    localId: args.uid,
    ...(args.disabled === undefined ? {} : { disableUser: args.disabled }),
    ...(args.displayName === undefined ? {} : { displayName: args.displayName }),
    ...(args.customClaims ? { customAttributes: JSON.stringify(args.customClaims) } : {}),
  });
}

export async function deleteFirebaseUser(uid: string) {
  return identityToolkit("/accounts:delete", { localId: uid });
}

export async function uploadFirebaseObject(args: { storagePath: string; blob: Blob; mimeType: string }) {
  const bucket = requiredEnv("FIREBASE_STORAGE_BUCKET");
  const token = await googleAccessToken(["https://www.googleapis.com/auth/cloud-platform"]);
  const upload = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(args.storagePath)}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": args.mimeType }, body: args.blob,
  });
  const uploadData = await upload.json().catch(() => ({}));
  if (!upload.ok) throw new Error((uploadData as { error?: { message?: string } })?.error?.message || `Firebase upload failed (${upload.status}).`);
  const downloadToken = crypto.randomUUID();
  const metadata = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(args.storagePath)}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: args.mimeType, metadata: { firebaseStorageDownloadTokens: downloadToken } }),
  });
  if (!metadata.ok) throw new Error(`Firebase metadata update failed (${metadata.status}).`);
  return {
    storagePath: args.storagePath,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(args.storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`,
  };
}

export async function downloadFirebaseObject(storagePath: string) {
  const bucket = requiredEnv("FIREBASE_STORAGE_BUCKET");
  const token = await googleAccessToken(["https://www.googleapis.com/auth/cloud-platform"]);
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Firebase download failed (${response.status}).`);
  return response.blob();
}

export async function deleteFirebaseObject(storagePath: string) {
  if (!storagePath) return;
  const bucket = requiredEnv("FIREBASE_STORAGE_BUCKET");
  const token = await googleAccessToken(["https://www.googleapis.com/auth/cloud-platform"]);
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok && response.status !== 404) {
    const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(data.error?.message || `Firebase delete failed (${response.status}).`);
  }
}
