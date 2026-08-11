import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

const env = parseEnv(await readFile(resolve(".env.local"), "utf8"));
const email = process.env.TEST_FIREBASE_EMAIL;
const password = process.env.TEST_FIREBASE_PASSWORD;
if (!email || !password) {
  throw new Error("Set TEST_FIREBASE_EMAIL and TEST_FIREBASE_PASSWORD for this one-time verification.");
}

const firebaseResponse = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY)}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  },
);
const firebaseResult = await firebaseResponse.json();
if (!firebaseResponse.ok || !firebaseResult.idToken) {
  throw new Error(firebaseResult?.error?.message || `Firebase sign-in failed (${firebaseResponse.status}).`);
}

const payload = JSON.parse(Buffer.from(firebaseResult.idToken.split(".")[1], "base64url").toString("utf8"));
if (payload.role !== "authenticated") {
  throw new Error("The Firebase token is missing role=authenticated. Run firebase:sync-supabase-claims -- --apply first.");
}

async function supabaseRows(table, select) {
  const url = new URL(`/rest/v1/${table}`, env.VITE_SUPABASE_URL);
  url.searchParams.set("select", select);
  const response = await fetch(url, {
    headers: {
      apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${firebaseResult.idToken}`,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.message || `Supabase ${table} query failed (${response.status}).`);
  return result;
}

const [members, batches, learnings, knowledge] = await Promise.all([
  supabaseRows("organization_members", "id,organization_id,status"),
  supabaseRows("planning_batches", "id"),
  supabaseRows("generation_learnings", "id"),
  supabaseRows("fashion_knowledge_base", "id"),
]);

console.log("Firebase third-party token: accepted");
console.log(`Firebase subject: ${payload.sub}`);
console.log(`Token clock skew (seconds): ${Math.round(payload.iat - Date.now() / 1000)}`);
console.log(`Visible active memberships: ${members.filter((member) => member.status === "active").length}`);
console.log(`Visible planning batches: ${batches.length}`);
console.log(`Visible generation learnings: ${learnings.length}`);
console.log(`Visible knowledge records: ${knowledge.length}`);
