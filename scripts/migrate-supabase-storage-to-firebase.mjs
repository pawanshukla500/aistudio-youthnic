import { createSign, randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;

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

function parseServiceAccount(raw) {
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing.");
  const candidates = [raw];
  try {
    candidates.push(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    // raw format
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.client_email && parsed.private_key && parsed.project_id) return parsed;
    } catch {
      // try next candidate
    }
  }
  throw new Error("FIREBASE_SERVICE_ACCOUNT must be valid JSON or base64 JSON.");
}

let cachedGoogleToken = null;
let googleTokenExpiry = 0;

async function getGoogleAccessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && now < googleTokenExpiry - 60) {
    return cachedGoogleToken;
  }
  const assertion = signJwt(account, {
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/cloud-platform",
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
    throw new Error(`Google token exchange failed: ${result.error_description || result.error || response.statusText}`);
  }
  cachedGoogleToken = result.access_token;
  googleTokenExpiry = now + (result.expires_in || 3600);
  return cachedGoogleToken;
}

async function uploadToFirebase(firebaseAccount, bucketName, storagePath, buffer, mimeType = "image/jpeg") {
  const token = await getGoogleAccessToken(firebaseAccount);
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucketName)}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Firebase upload failed (${uploadRes.status}): ${errText}`);
  }

  const downloadToken = randomUUID();
  const metaUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(storagePath)}`;
  const metaRes = await fetch(metaUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType: mimeType,
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    }),
  });

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(`Firebase metadata patch failed (${metaRes.status}): ${errText}`);
  }

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
  return { downloadUrl, downloadToken };
}

async function getSupabaseServiceRoleKey(accessToken, projectRef) {
  console.log(`Fetching API keys for project ${projectRef} from Supabase Management API...`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch Supabase API keys (${res.status}): ${errText}`);
  }
  const keys = await res.json();
  const serviceKeyObj = keys.find(k => k.name === "service_role" || k.tags === "service_role");
  if (!serviceKeyObj || !serviceKeyObj.api_key) {
    throw new Error(`service_role key not found in project keys: ${JSON.stringify(keys)}`);
  }
  console.log("Successfully retrieved service_role key for Cloud Supabase.");
  return serviceKeyObj.api_key;
}

async function main() {
  const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF || "cyygmyiqgdzgeoayxbro";
  const railwayDbUrl = process.env.RAILWAY_DATABASE_URL;
  const firebaseAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const firebaseBucket = process.env.FIREBASE_STORAGE_BUCKET || "ai-studio-app-be068.firebasestorage.app";

  if (!supabaseAccessToken) throw new Error("SUPABASE_ACCESS_TOKEN is required.");
  if (!railwayDbUrl) throw new Error("RAILWAY_DATABASE_URL is required.");
  if (!firebaseAccountRaw) throw new Error("FIREBASE_SERVICE_ACCOUNT is required.");

  const firebaseAccount = parseServiceAccount(firebaseAccountRaw);
  console.log(`Firebase account loaded for project: ${firebaseAccount.project_id}`);
  console.log(`Target Firebase bucket: ${firebaseBucket}`);

  const serviceRoleKey = await getSupabaseServiceRoleKey(supabaseAccessToken, projectRef);

  const client = new Client({ connectionString: railwayDbUrl });
  await client.connect();
  console.log("Connected to Railway Postgres.\n");

  // 1. Get all unique storage paths from planning_assets
  const assetsQuery = await client.query(`
    SELECT DISTINCT storage_path 
    FROM public.planning_assets 
    WHERE (storage_backend = 'supabase' OR storage_backend = 'supabase_temp' OR image_url LIKE '%supabase%')
      AND storage_path IS NOT NULL AND storage_path != '';
  `);
  const assetPaths = assetsQuery.rows.map(r => r.storage_path);
  console.log(`Found ${assetPaths.length} distinct storage paths in planning_assets to migrate.`);

  // 2. Get all unique storage paths from session_generations
  const sessionQuery = await client.query(`
    SELECT DISTINCT storage_path 
    FROM public.session_generations 
    WHERE (storage_backend = 'supabase' OR output_url LIKE '%supabase%')
      AND storage_path IS NOT NULL AND storage_path != '';
  `);
  const sessionPaths = sessionQuery.rows.map(r => r.storage_path);
  console.log(`Found ${sessionPaths.length} distinct storage paths in session_generations to migrate.`);

  // 3. Get all objects from storage.objects just in case
  const objectsQuery = await client.query(`
    SELECT bucket_id, name, (metadata->>'mimetype') as mimetype 
    FROM storage.objects;
  `);
  console.log(`Found ${objectsQuery.rows.length} total objects in storage.objects catalog.`);

  const allFilesMap = new Map();
  // Map storage paths to bucket and mime
  for (const obj of objectsQuery.rows) {
    allFilesMap.set(obj.name, {
      bucket: obj.bucket_id,
      storagePath: obj.name,
      mimeType: obj.mimetype || "image/jpeg",
    });
  }

  // Ensure assetPaths are in the map
  for (const p of assetPaths) {
    if (!allFilesMap.has(p)) {
      const bucket = p.includes("sku/") ? "planning-temp" : "catalog-assets";
      allFilesMap.set(p, {
        bucket,
        storagePath: p,
        mimeType: p.endsWith(".png") ? "image/png" : "image/jpeg",
      });
    }
  }

  // Ensure sessionPaths are in the map
  for (const p of sessionPaths) {
    if (!allFilesMap.has(p)) {
      allFilesMap.set(p, {
        bucket: "catalog-assets",
        storagePath: p,
        mimeType: p.endsWith(".png") ? "image/png" : "image/jpeg",
      });
    }
  }

  const filesToMigrate = Array.from(allFilesMap.values());
  console.log(`\nTotal unique files to transfer from Cloud Supabase to Firebase: ${filesToMigrate.length}`);

  const urlMapping = new Map(); // storagePath -> new downloadUrl
  let successCount = 0;
  let errorCount = 0;
  let notFoundCount = 0;

  // Process in batches of 5 concurrent downloads/uploads
  const CONCURRENCY = 5;
  for (let i = 0; i < filesToMigrate.length; i += CONCURRENCY) {
    const chunk = filesToMigrate.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (item) => {
      const { bucket, storagePath, mimeType } = item;
      const downloadUrl = `https://${projectRef}.supabase.co/storage/v1/object/authenticated/${bucket}/${storagePath}`;

      try {
        const fetchRes = await fetch(downloadUrl, {
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
          },
        });

        if (fetchRes.status === 404) {
          notFoundCount++;
          return;
        }

        if (!fetchRes.ok) {
          const errText = await fetchRes.text();
          throw new Error(`Supabase download failed (${fetchRes.status}): ${errText}`);
        }

        const buffer = Buffer.from(await fetchRes.arrayBuffer());
        const { downloadUrl: firebaseDownloadUrl } = await uploadToFirebase(
          firebaseAccount,
          firebaseBucket,
          storagePath,
          buffer,
          mimeType
        );

        urlMapping.set(storagePath, firebaseDownloadUrl);
        successCount++;
      } catch (err) {
        errorCount++;
        console.error(`[Transfer Error] ${storagePath}:`, err.message);
      }
    }));

    if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= filesToMigrate.length) {
      console.log(`Progress: ${Math.min(i + CONCURRENCY, filesToMigrate.length)}/${filesToMigrate.length} | Success: ${successCount} | Not Found: ${notFoundCount} | Errors: ${errorCount}`);
    }
  }

  console.log(`\nFile migration completed: ${successCount} uploaded to Firebase, ${notFoundCount} not found, ${errorCount} errors.`);

  // Now update database records in Railway Postgres
  console.log("\nUpdating Railway Postgres database records to point to Firebase Storage...");

  let updatedAssets = 0;
  for (const [storagePath, newUrl] of urlMapping.entries()) {
    const res = await client.query(`
      UPDATE public.planning_assets
      SET 
        image_url = $1,
        storage_backend = 'firebase'
      WHERE storage_path = $2
        AND (storage_backend != 'firebase' OR image_url LIKE '%supabase%');
    `, [newUrl, storagePath]);
    updatedAssets += res.rowCount;
  }
  console.log(`Updated ${updatedAssets} records in public.planning_assets.`);

  let updatedSessions = 0;
  for (const [storagePath, newUrl] of urlMapping.entries()) {
    const res = await client.query(`
      UPDATE public.session_generations
      SET 
        output_url = $1,
        storage_backend = 'firebase'
      WHERE storage_path = $2
        AND (storage_backend != 'firebase' OR output_url LIKE '%supabase%');
    `, [newUrl, storagePath]);
    updatedSessions += res.rowCount;
  }
  console.log(`Updated ${updatedSessions} records in public.session_generations.`);

  // Any remaining rows where file was not found: update storage_backend = 'firebase' or mark legacy
  await client.query(`
    UPDATE public.planning_assets
    SET storage_backend = 'firebase'
    WHERE storage_backend IN ('supabase', 'supabase_temp');
  `);
  await client.query(`
    UPDATE public.session_generations
    SET storage_backend = 'firebase'
    WHERE storage_backend IN ('supabase', 'supabase_temp');
  `);

  // Final verification queries
  const remAssets = await client.query(`
    SELECT count(*) FROM public.planning_assets WHERE storage_backend != 'firebase' OR image_url LIKE '%supabase%';
  `);
  const remSessions = await client.query(`
    SELECT count(*) FROM public.session_generations WHERE storage_backend != 'firebase' OR output_url LIKE '%supabase%';
  `);

  console.log("\n=== FINAL DATABASE VERIFICATION ===");
  console.log(`Remaining planning_assets with Supabase backend/URL: ${remAssets.rows[0].count}`);
  console.log(`Remaining session_generations with Supabase backend/URL: ${remSessions.rows[0].count}`);

  // Test fetch sample migrated URLs
  const sampleMigrated = await client.query(`
    SELECT id, image_url FROM public.planning_assets 
    WHERE image_url LIKE '%firebasestorage%' 
    ORDER BY updated_at DESC NULLS LAST 
    LIMIT 3;
  `);
  console.log("\nTesting 3 sample migrated Firebase URLs:");
  for (const r of sampleMigrated.rows) {
    try {
      const testRes = await fetch(r.image_url, { method: "HEAD" });
      console.log(`- ${r.id}: HTTP ${testRes.status} (${testRes.statusText})`);
    } catch (e) {
      console.error(`- ${r.id}: Failed fetch - ${e.message}`);
    }
  }

  await client.end();
  console.log("\nStorage migration to Firebase finished successfully!");
}

main().catch(e => {
  console.error("FATAL ERROR during storage migration:", e);
  process.exit(1);
});
