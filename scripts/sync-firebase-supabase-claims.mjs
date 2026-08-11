import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseEnv(contents) {
  const values = {};
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (value.startsWith("{")) {
      let braceBalance = (value.match(/\{/g) || []).length - (value.match(/\}/g) || []).length;
      while (braceBalance > 0 && index + 1 < lines.length) {
        index += 1;
        const continuation = lines[index];
        value += `\n${continuation}`;
        braceBalance += (continuation.match(/\{/g) || []).length - (continuation.match(/\}/g) || []).length;
      }
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function serviceAccountFrom(raw) {
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing from .env.local.");
  for (const candidate of [raw, Buffer.from(raw, "base64").toString("utf8")]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.client_email && parsed.private_key) return parsed;
    } catch {
      // Try the next supported representation.
    }
  }
  throw new Error("FIREBASE_SERVICE_ACCOUNT must be compact JSON or base64-encoded JSON.");
}

async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const assertion = `${signingInput}.${signer.sign(account.private_key.replace(/\\n/g, "\n"), "base64url")}`;
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

async function firebaseRequest(projectId, token, path, init = {}) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || `Firebase Auth request failed (${response.status}).`);
  return result;
}

async function listUsers(projectId, token) {
  const users = [];
  let nextPageToken = "";
  do {
    const query = new URLSearchParams({ maxResults: "1000" });
    if (nextPageToken) query.set("nextPageToken", nextPageToken);
    const page = await firebaseRequest(projectId, token, `/accounts:batchGet?${query}`);
    users.push(...(page.users || []));
    nextPageToken = page.nextPageToken || "";
  } while (nextPageToken);
  return users;
}

const env = parseEnv(await readFile(resolve(".env.local"), "utf8"));
const projectId = env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID;
if (!projectId) throw new Error("FIREBASE_PROJECT_ID is missing from .env.local.");
const account = serviceAccountFrom(env.FIREBASE_SERVICE_ACCOUNT);
const token = await accessToken(account);
const users = await listUsers(projectId, token);
const apply = process.argv.includes("--apply");
let alreadyConfigured = 0;
let pending = 0;

for (const user of users) {
  let claims = {};
  try {
    claims = user.customAttributes ? JSON.parse(user.customAttributes) : {};
  } catch {
    claims = {};
  }
  if (claims.role === "authenticated") {
    alreadyConfigured += 1;
    continue;
  }
  pending += 1;
  if (!apply) continue;
  await firebaseRequest(projectId, token, "/accounts:update", {
    method: "POST",
    body: JSON.stringify({
      localId: user.localId,
      customAttributes: JSON.stringify({ ...claims, role: "authenticated" }),
    }),
  });
}

console.log(`Firebase users: ${users.length}`);
console.log(`Already configured: ${alreadyConfigured}`);
console.log(`${apply ? "Updated" : "Would update"}: ${pending}`);
if (!apply && pending) console.log("Run again with --apply to install the Supabase authenticated claim.");
