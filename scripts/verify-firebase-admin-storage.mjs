import { getGoogleAccessToken, parseServiceAccount } from "./lib/firebase-service-account.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

const env = await loadLocalEnv();
const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
const bucket = String(env.FIREBASE_STORAGE_BUCKET || env.VITE_FIREBASE_STORAGE_BUCKET || "").trim();
if (!bucket) throw new Error("FIREBASE_STORAGE_BUCKET is not configured.");

const token = await getGoogleAccessToken(account);
const objectName = `diagnostics/ai-studio-storage-check-${Date.now()}.txt`;
const objectUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`;

try {
  const upload = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: "Youthnic AI Studio storage health check",
    },
  );
  const uploadData = await upload.json().catch(() => ({}));
  if (!upload.ok) throw new Error(uploadData?.error?.message || `Firebase upload failed (${upload.status}).`);
  console.log("Firebase Admin upload: accepted");

  const metadata = await fetch(objectUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      contentType: "text/plain",
      metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() },
    }),
  });
  const metadataData = await metadata.json().catch(() => ({}));
  if (!metadata.ok) throw new Error(metadataData?.error?.message || `Firebase metadata update failed (${metadata.status}).`);
  console.log("Firebase download-token metadata: accepted");
} finally {
  const cleanup = await fetch(objectUrl, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (cleanup.ok || cleanup.status === 404) console.log("Firebase diagnostic object: removed");
  else console.log(`Firebase diagnostic cleanup returned ${cleanup.status}`);
}
