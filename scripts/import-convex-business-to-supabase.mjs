import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createFirebaseIdToken, listFirebaseUsers, parseServiceAccount } from "./lib/firebase-service-account.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

const excluded = new Set([
  "_storage", "_tables", "authAccounts", "authCredentials", "authRateLimits", "authRefreshTokens",
  "authSessions", "authVerificationCodes", "authVerifiers",
]);
const root = resolve(".migration-audit-20260811/convex-export");
const documents = [];
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || excluded.has(entry.name)) continue;
  const source = await readFile(join(root, entry.name, "documents.jsonl"), "utf8").catch(() => "");
  for (const line of source.split(/\r?\n/).filter(Boolean)) {
    const payload = JSON.parse(line);
    if (payload._id) documents.push({ table: entry.name, id: String(payload._id), payload });
  }
}

const env = await loadLocalEnv();
const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
const emailFlag = process.argv.indexOf("--email");
const requestedEmail = emailFlag >= 0 ? String(process.argv[emailFlag + 1] || "").trim().toLowerCase() : "";
const users = await listFirebaseUsers(account);
const user = requestedEmail ? users.find((candidate) => candidate.email?.toLowerCase() === requestedEmail) : users.find((candidate) => !candidate.disabled);
if (!user) throw new Error("No matching enabled Firebase administrator was found.");
const idToken = await createFirebaseIdToken(account, env.VITE_FIREBASE_API_KEY, user.localId);

let imported = 0;
let batch = [];
let batchBytes = 0;
async function flush() {
  if (!batch.length) return;
  const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/app-api`, {
    method: "POST",
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "migration.archive", args: { documents: batch } }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error || `Archive import failed (${response.status}).`);
  imported += Number(result.data?.imported || 0);
  batch = [];
  batchBytes = 0;
}

for (const document of documents) {
  const bytes = Buffer.byteLength(JSON.stringify(document));
  if (batch.length >= 20 || (batch.length && batchBytes + bytes > 450_000)) await flush();
  batch.push(document);
  batchBytes += bytes;
  if (bytes > 450_000) await flush();
}
await flush();
console.log(`Convex business documents imported to Supabase archive: ${imported}`);
console.log("Convex Auth credentials, passwords, sessions, refresh tokens, verifiers, and rate limits were excluded.");
