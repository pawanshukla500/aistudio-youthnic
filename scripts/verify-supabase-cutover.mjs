import { createFirebaseIdToken, listFirebaseUsers, parseServiceAccount } from "./lib/firebase-service-account.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

const env = await loadLocalEnv();
const emailFlag = process.argv.indexOf("--email");
const requestedEmail = emailFlag >= 0 ? String(process.argv[emailFlag + 1] || "").trim().toLowerCase() : "";
const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
const users = await listFirebaseUsers(account);
const user = requestedEmail
  ? users.find((candidate) => candidate.email?.toLowerCase() === requestedEmail)
  : users.find((candidate) => !candidate.disabled);
if (!user) throw new Error("No matching enabled Firebase user was found.");

const idToken = await createFirebaseIdToken(account, env.VITE_FIREBASE_API_KEY, user.localId);
const functionResponse = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/app-api`, {
  method: "POST",
  headers: {
    apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${idToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ operation: "admin.overview", args: {} }),
});
const functionText = await functionResponse.text();
const functionBody = (() => {
  try {
    return JSON.parse(functionText);
  } catch {
    return {};
  }
})();
if (!functionResponse.ok || functionBody.error) {
  throw new Error(functionBody.error || functionText || `Edge API failed (${functionResponse.status}).`);
}
const health = functionBody.data?.health || {};
if (!health.supabase || !health.firebaseConfigured || !health.openaiConfigured || !health.geminiConfigured) {
  throw new Error("The Edge API health response reports incomplete provider configuration.");
}

const modelResponse = await fetch("https://api.openai.com/v1/models/gpt-image-2", {
  headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
});
const modelBody = await modelResponse.json().catch(() => ({}));
if (!modelResponse.ok || modelBody.id !== "gpt-image-2") {
  throw new Error(modelBody?.error?.message || `OpenAI model access check failed (${modelResponse.status}).`);
}

console.log("Supabase Edge API: authenticated and healthy");
console.log("Firebase Auth + Supabase RLS: accepted");
console.log("OpenAI gpt-image-2: accessible with the configured key");
console.log(`Workspace members visible to the API: ${Number(health.memberCount || 0)}`);
