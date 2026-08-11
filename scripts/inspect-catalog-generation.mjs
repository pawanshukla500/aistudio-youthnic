import { createClient } from "@supabase/supabase-js";
import { createFirebaseIdToken, listFirebaseUsers, parseServiceAccount } from "./lib/firebase-service-account.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

const batchId = process.argv[2];
if (!batchId) throw new Error("Usage: node scripts/inspect-catalog-generation.mjs <batch-id>");

const env = await loadLocalEnv();
const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").trim();
const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const publishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
if (!url || (!serviceRoleKey && !publishableKey)) throw new Error("Supabase URL and a service-role or publishable key are required.");

let authorization = "";
if (!serviceRoleKey) {
  const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const users = await listFirebaseUsers(account);
  const adminEmail = String(env.FIREBASE_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const user = users.find((candidate) => candidate.email?.toLowerCase() === adminEmail && !candidate.disabled)
    || users.find((candidate) => !candidate.disabled);
  if (!user) throw new Error("No enabled Firebase user was found for the read-only catalog check.");
  authorization = `Bearer ${await createFirebaseIdToken(account, env.VITE_FIREBASE_API_KEY, user.localId)}`;
}
const supabase = createClient(url, serviceRoleKey || publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: authorization ? { headers: { Authorization: authorization } } : undefined,
});
const [batchResult, requestResult, jobResult] = await Promise.all([
  supabase.from("planning_batches").select("id,name,schedule_status,queue_status,generated_count,failed_count,pending_count,schedule_error").eq("id", batchId).single(),
  supabase.from("planning_requests").select("id,sku_name,status,generation_status,completion_status,generation_job_id,error_message,queue_position").eq("batch_id", batchId).order("queue_position"),
  supabase.from("generation_jobs").select("job_id,planning_request_id,session_id,sku_name,status,current_pose,completed_poses,failed_poses,attempt_count,available_at,error_code,error_message,created_at").eq("batch_id", batchId).order("created_at"),
]);
if (batchResult.error) throw batchResult.error;
if (requestResult.error) throw requestResult.error;
if (jobResult.error) throw jobResult.error;

const requestIds = (requestResult.data || []).map((row) => row.id);
const sessionIds = (jobResult.data || []).map((row) => row.session_id).filter(Boolean);
const [assetResult, poseResult] = await Promise.all([
  requestIds.length
    ? supabase.from("planning_assets").select("planning_request_id,asset_role,image_url,storage_path").in("planning_request_id", requestIds)
    : Promise.resolve({ data: [], error: null }),
  sessionIds.length
    ? supabase.from("session_generations").select("session_id,pose_index,status,attempt_count,qa_status,output_url,storage_path,error").in("session_id", sessionIds).order("pose_index")
    : Promise.resolve({ data: [], error: null }),
]);
if (assetResult.error) throw assetResult.error;
if (poseResult.error) throw poseResult.error;

const generatedAssetRows = (assetResult.data || []).filter((asset) => asset.asset_role === "generated");
const reachableAssets = await Promise.all(generatedAssetRows.map(async (asset) => {
  if (!asset.image_url || !asset.storage_path) return false;
  const response = await fetch(asset.image_url, { method: "HEAD" }).catch(() => null);
  return Boolean(response?.ok);
}));
const jobs = (jobResult.data || []).map((job) => ({
  jobId: job.job_id,
  sku: job.sku_name,
  status: job.status,
  currentPose: job.current_pose,
  storedPoses: job.completed_poses,
  failedPoses: job.failed_poses,
  attempt: job.attempt_count,
  retryAt: job.available_at,
  errorCode: job.error_code || "",
  error: job.error_message || "",
  generatedAssets: (assetResult.data || []).filter((asset) => asset.planning_request_id === job.planning_request_id && asset.asset_role === "generated").length,
  poses: (poseResult.data || []).filter((pose) => pose.session_id === job.session_id).map((pose) => ({
    pose: pose.pose_index,
    status: pose.status,
    attempt: pose.attempt_count,
    qa: pose.qa_status,
    stored: Boolean(pose.output_url && pose.storage_path),
    error: pose.error || "",
  })),
}));

console.log(JSON.stringify({
  batch: batchResult.data,
  requests: requestResult.data,
  storageVerification: {
    generatedAssetRows: generatedAssetRows.length,
    completeStorageRecords: generatedAssetRows.filter((asset) => asset.image_url && asset.storage_path).length,
    reachableFirebaseObjects: reachableAssets.filter(Boolean).length,
  },
  jobs,
}, null, 2));
