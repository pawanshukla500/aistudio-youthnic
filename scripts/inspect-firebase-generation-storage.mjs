import { getGoogleAccessToken, parseServiceAccount } from "./lib/firebase-service-account.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

const prefixFlag = process.argv.indexOf("--prefix");
const prefix = prefixFlag >= 0 ? String(process.argv[prefixFlag + 1] || "").trim() : "";
if (!prefix) throw new Error("Pass the generated-object prefix with --prefix.");

const env = await loadLocalEnv();
const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
const bucket = String(env.FIREBASE_STORAGE_BUCKET || env.VITE_FIREBASE_STORAGE_BUCKET || "").trim();
if (!bucket) throw new Error("FIREBASE_STORAGE_BUCKET is not configured.");

const token = await getGoogleAccessToken(account);
const query = new URLSearchParams({ prefix });
const response = await fetch(
  `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(result?.error?.message || `Firebase object listing failed (${response.status}).`);

const objects = Array.isArray(result.items) ? result.items : [];
console.log(`Firebase generated objects matching prefix: ${objects.length}`);
for (const object of objects) {
  console.log(`${object.name} | ${object.size || 0} bytes | ${object.contentType || "unknown"}`);
}
