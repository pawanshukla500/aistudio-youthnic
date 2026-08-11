import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFirebaseIdToken, listFirebaseUsers, parseServiceAccount } from "./lib/firebase-service-account.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

const env = await loadLocalEnv();
const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
const requestedEmailIndex = process.argv.indexOf("--email");
const requestedEmail = requestedEmailIndex >= 0 ? process.argv[requestedEmailIndex + 1]?.trim().toLowerCase() : "";
const users = await listFirebaseUsers(account);
const user = requestedEmail
  ? users.find((candidate) => candidate.email?.toLowerCase() === requestedEmail)
  : users.find((candidate) => !candidate.disabled);
if (!user) throw new Error(requestedEmail ? "The requested Firebase user was not found." : "No enabled Firebase user was found.");

const idToken = await createFirebaseIdToken(account, env.VITE_FIREBASE_API_KEY, user.localId);
const headers = {
  apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${idToken}`,
};
const tables = [
  "ai_runs", "analysis_cache", "app_audit_logs", "app_settings", "app_system_settings",
  "audit_logs", "batch_approvals", "catalog_sessions", "event_research_runs", "execution_events",
  "fashion_knowledge_base", "generation_jobs", "generation_learnings", "learning_daily_digests",
  "marketing_events", "marketplace_campaign_catalog", "member_roles", "notifications",
  "organization_members", "organizations", "permissions", "planning_assets", "planning_batches",
  "planning_requests", "prompt_patterns", "prompt_versions", "qa_reviews", "regional_festival_catalog",
  "role_permissions", "roles", "scene_analyses", "session_generations", "visual_attributes",
];
const counts = {};
const visibleSchema = {};
for (const table of tables) {
  const response = await fetch(new URL(`/rest/v1/${table}?select=*&limit=1`, env.VITE_SUPABASE_URL), {
    headers: { ...headers, Prefer: "count=exact" },
  });
  if (response.ok) {
    const range = response.headers.get("content-range") || "";
    counts[table] = Number(range.split("/")[1] || 0);
    const rows = await response.json();
    const row = rows[0];
    visibleSchema[table] = row
      ? Object.fromEntries(Object.entries(row).map(([key, value]) => [
        key,
        value === null ? "unknown" : Array.isArray(value) ? "array" : typeof value,
      ]))
      : {};
  } else {
    const result = await response.json().catch(() => ({}));
    visibleSchema[table] = { __error: result?.message || `HTTP ${response.status}` };
  }
}

const outputDirectory = resolve(".migration-audit-20260811");
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "supabase-visible-schema.json"), `${JSON.stringify(visibleSchema, null, 2)}\n`, "utf8");
await writeFile(resolve(outputDirectory, "supabase-visible-counts.json"), `${JSON.stringify(counts, null, 2)}\n`, "utf8");
console.log(`Supabase tables checked: ${tables.length}`);
console.log(`Visible table counts captured: ${Object.keys(counts).length}`);
console.log("Audit files written to .migration-audit-20260811 without persisting credentials or ID tokens.");
