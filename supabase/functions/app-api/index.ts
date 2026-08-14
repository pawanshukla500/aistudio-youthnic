import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import ExcelJS from "https://esm.sh/exceljs@4.4.0";
import { deleteFirebaseObject, downloadFirebaseObject, uploadFirebaseObject, createFirebaseUser, updateFirebaseUser, deleteFirebaseUser } from "./firebase-admin.ts";
import {
  ANALYSIS_VERSION,
  CONSISTENCY_RULES,
  buildCombinedAnalysisPrompt,
  normalizeAnalysis,
  parseJsonResponse,
  smallHash,
  type JsonRecord,
  type StudioPose,
} from "./profiles.ts";
import { buildPoseQaPrompt, parseQaResponse } from "./qa.ts";

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PUBLISHABLE_KEY = Deno.env.get("SB_PUBLISHABLE_KEY")?.trim() || Deno.env.get("SUPABASE_ANON_KEY")?.trim() || requiredEnv("SUPABASE_ANON_KEY");
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/app-api`;
const OPENAI_MODEL = "gpt-image-2";
const MAX_REFERENCES = 8;
const MAX_GENERATION_ATTEMPTS = 3;
const WORKER_LEASE_MS = 4 * 60_000;
const TIER_ONE_RETRY_FLOOR_MS = 30_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ReferenceInput = {
  id?: string;
  role: string;
  downloadUrl?: string;
  storagePath?: string;
  hash: string;
  filename: string;
  mimeType: string;
  size: number;
};

type LoadedReference = ReferenceInput & { blob: Blob; base64: string };

type ProviderUsage = {
  inputTokens: number;
  inputTextTokens: number;
  inputImageTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerReported: boolean;
  raw: JsonRecord;
};

const IMAGE_TOKEN_RATES: Record<string, { textInput: number; imageInput: number; imageOutput: number }> = {
  "gpt-image-2": { textInput: 5, imageInput: 8, imageOutput: 30 },
  "gpt-image-1.5": { textInput: 5, imageInput: 8, imageOutput: 32 },
  "gpt-image-1": { textInput: 5, imageInput: 10, imageOutput: 40 },
  "gpt-image-1-mini": { textInput: 2, imageInput: 2.5, imageOutput: 8 },
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured in the Supabase Edge Function.`);
  return value;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  const duration = value.match(/(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (!duration) return 0;
  return Math.ceil((Number(duration[1] || 0) * 60 + Number(duration[2] || 0)) * 1000);
}

function retryDelayMs(error: unknown, attempt: number) {
  const providerDelay = Number((error as { retryAfterMs?: number })?.retryAfterMs || 0);
  const exponential = TIER_ONE_RETRY_FLOOR_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(5 * 60_000, Math.max(TIER_ONE_RETRY_FLOOR_MS, exponential, providerDelay));
}

function userClient(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function workspaceFor(request: Request, permission?: string) {
  const client = userClient(request);
  const { data, error } = await client.rpc("app_current_workspace");
  if (error || !data) throw new Error("Your Firebase session is not linked to an active Supabase workspace.");
  const workspace = data as {
    organization: { id: string; name: string; slug: string };
    member: { id: string; firebase_uid: string; email: string; display_name: string };
    user: { id: string; firebaseUid: string; email: string; name: string };
    permissions: string[];
    roles: Array<{ id: string; slug: string; name: string }>;
    isAdmin: boolean;
  };
  if (permission && !workspace.isAdmin && !workspace.permissions.includes(permission)) {
    throw new Error(`Permission required: ${permission}`);
  }
  return { workspace, client };
}

function assertInternal(request: Request) {
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const workerSecret = Deno.env.get("CATALOG_WORKER_SECRET")?.trim();
  if (bearer !== SERVICE_ROLE_KEY && (!workerSecret || bearer !== workerSecret)) throw new Error("Internal worker authorization failed.");
}

function scheduleBackground(promise: Promise<unknown>) {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(promise.catch((error) => console.error("Background task failed", errorMessage(error))));
  else void promise.catch((error) => console.error("Background task failed", errorMessage(error)));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function blobToBase64(blob: Blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function providerUsage(value: unknown): ProviderUsage {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
  const details = raw.input_tokens_details && typeof raw.input_tokens_details === "object"
    ? raw.input_tokens_details as JsonRecord
    : {};
  const inputTokens = numberValue(raw.input_tokens);
  const outputTokens = numberValue(raw.output_tokens);
  return {
    inputTokens,
    inputTextTokens: numberValue(details.text_tokens),
    inputImageTokens: numberValue(details.image_tokens),
    outputTokens,
    totalTokens: numberValue(raw.total_tokens) || inputTokens + outputTokens,
    providerReported: Boolean(inputTokens || outputTokens || raw.total_tokens),
    raw,
  };
}

function usageCostUsd(model: string, usage: ProviderUsage) {
  if (!usage.providerReported) return 0;
  const rates = IMAGE_TOKEN_RATES[model];
  if (!rates) return 0;
  const classifiedInput = usage.inputTextTokens + usage.inputImageTokens;
  const unclassifiedInput = Math.max(0, usage.inputTokens - classifiedInput);
  return (
    usage.inputTextTokens * rates.textInput +
    (usage.inputImageTokens + unclassifiedInput) * rates.imageInput +
    usage.outputTokens * rates.imageOutput
  ) / 1_000_000;
}

function accumulatedUsage(row: JsonRecord, usage: ProviderUsage, requestId: string, costUsd: number) {
  const existingPayload = row.usage_payload && typeof row.usage_payload === "object" ? row.usage_payload as JsonRecord : {};
  const attempts = Array.isArray(existingPayload.attempts) ? existingPayload.attempts as JsonRecord[] : [];
  return {
    provider_request_id: requestId,
    input_tokens: Number(row.input_tokens || 0) + usage.inputTokens,
    input_text_tokens: Number(row.input_text_tokens || 0) + usage.inputTextTokens,
    input_image_tokens: Number(row.input_image_tokens || 0) + usage.inputImageTokens,
    output_tokens: Number(row.output_tokens || 0) + usage.outputTokens,
    total_tokens: Number(row.total_tokens || 0) + usage.totalTokens,
    actual_cost_usd: Number(row.actual_cost_usd || 0) + costUsd,
    usage_payload: {
      ...existingPayload,
      providerReported: usage.providerReported,
      pricingBasis: usage.providerReported ? "provider_reported_tokens_openai_public_rates" : "provider_usage_not_returned",
      attempts: [...attempts, { requestId, usage: usage.raw, costUsd }],
    },
  };
}

function cleanEmails(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : String(value || "").split(","))
    .map((entry) => String(entry).trim().toLowerCase())
    .filter((entry) => /^\S+@\S+\.\S+$/.test(entry)))];
}

function escapeHtml(value: unknown) {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character] || character);
}

function localDateParts(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { iso: `${value.year}-${value.month}-${value.day}`, year: Number(value.year), month: Number(value.month), day: Number(value.day) };
}

async function sendEmail(args: { recipients: string[]; subject: string; html: string; attachments?: Array<{ filename: string; content: string }> }) {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const from = Deno.env.get("RESEND_FROM")?.trim();
  if (!apiKey || !from) throw new Error("Email delivery is not configured. Add RESEND_API_KEY and RESEND_FROM to Supabase Edge Function secrets.");
  if (!args.recipients.length) throw new Error("Add at least one valid report recipient in Administration.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: args.recipients, subject: args.subject, html: args.html, attachments: args.attachments }),
  });
  const data = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(String(data.message || `Email provider failed (${response.status}).`));
  return String(data.id || "");
}

async function geminiGroundedJson(prompt: string) {
  const model = Deno.env.get("GEMINI_RESEARCH_MODEL")?.trim() || Deno.env.get("GEMINI_ANALYSIS_MODEL")?.trim() || "gemini-3.6-flash";
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": requiredEnv("GEMINI_API_KEY") },
    body: JSON.stringify({ model, input: prompt, tools: [{ type: "google_search" }] }),
  });
  const data = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(String((data.error as JsonRecord | undefined)?.message || `Gemini research failed (${response.status}).`));
  const steps = Array.isArray(data.steps) ? data.steps as JsonRecord[] : [];
  const outputs = steps.filter((step) => step.type === "model_output").flatMap((step) => Array.isArray(step.content) ? step.content as JsonRecord[] : []);
  const text = outputs.map((content) => String(content.text || "")).filter(Boolean).join("\n").trim();
  if (!text) throw new Error("Gemini research returned no structured response.");
  const citations = outputs.flatMap((content) => Array.isArray(content.annotations) ? content.annotations as JsonRecord[] : [])
    .filter((annotation) => annotation.type === "url_citation")
    .map((annotation) => ({ title: String(annotation.title || "Source"), url: String(annotation.url || "") }))
    .filter((citation) => citation.url);
  return { model, raw: data, json: parseJsonResponse(text), citations };
}

async function loadReference(reference: ReferenceInput): Promise<LoadedReference> {
  let blob: Blob | null = null;
  if (reference.downloadUrl) {
    const response = await fetch(reference.downloadUrl);
    if (response.ok) blob = await response.blob();
  }
  if (!blob && reference.storagePath) blob = await downloadFirebaseObject(reference.storagePath);
  if (!blob) throw new Error(`Could not load ${reference.filename} from Firebase Storage.`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = reference.mimeType || blob.type || "image/jpeg";
  return { ...reference, mimeType, blob: new Blob([bytes], { type: mimeType }), base64: bytesToBase64(bytes) };
}

async function loadAvailableReferences(references: ReferenceInput[]): Promise<LoadedReference[]> {
  const loaded: LoadedReference[] = [];
  for (const reference of references) {
    try {
      loaded.push(await loadReference(reference));
    } catch (error) {
      if (reference.role === "front" || reference.role === "back") {
        throw new Error(
          `Could not load required ${reference.role} reference ${reference.filename}: ${errorMessage(error)}`,
        );
      }
      console.warn(
        `Skipping unavailable optional ${reference.role} reference ${reference.filename}: ${errorMessage(error)}`,
      );
    }
  }
  if (!loaded.some((reference) => reference.role === "front") || !loaded.some((reference) => reference.role === "back")) {
    throw new Error("Loadable front and back product references are required.");
  }
  return loaded;
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    model_identity: "MODEL FACE REFERENCE - the exact, non-negotiable face and identity for the model in every pose; reproduce it as closely as photographically possible, never invent or beautify a different face",
    front: "FRONT PRODUCT - authoritative front product truth",
    back: "BACK PRODUCT - authoritative back design and construction",
    fabric_pattern: "FABRIC / PATTERN DETAIL - high-priority texture, print, embroidery, stitching, trim and construction truth",
    mannequin: "MANNEQUIN / FLAT-LAY SHOT - authoritative garment truth for this exact garment: on a mannequin or dress form it also sets worn shape, fit, proportion and drape; laid flat it sets outline, construction, panel layout and length only, since flat cloth shows no worn drape. Read the garment from it, never reproduce the mannequin, dress form, hanger, pins, clips or the flat surface itself",
    additional_product: "ADDITIONAL PRODUCT PHOTO - supporting product truth",
    approved_pose: "APPROVED POSE 1 - shoot-continuity anchor (scene, lighting, styling); also the model identity anchor only when no MODEL FACE REFERENCE was supplied",
    style_reference: "STYLE REFERENCE ONLY - background, composition, mood, lighting and creative direction; never product identity",
  };
  return labels[role] || role.toUpperCase();
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function canonicalReferences(references: ReferenceInput[]) {
  const order: Record<string, number> = { model_identity: 0, front: 1, back: 2, fabric_pattern: 3, additional_product: 4, style_reference: 5 };
  return [...references].sort((left, right) => (order[left.role] ?? 99) - (order[right.role] ?? 99) || left.hash.localeCompare(right.hash));
}

function productHash(args: JsonRecord) {
  return smallHash([args.skuId, args.skuName, args.category, args.productDetails, args.modelDirection, args.sceneDirection].map((value) => String(value || "").trim().replace(/\s+/g, " ")).join("|"));
}

function referenceHash(references: ReferenceInput[]) {
  return smallHash(canonicalReferences(references).map((reference) => `${reference.role}:${reference.hash}`).join("|"));
}

function extractGeminiText(data: JsonRecord) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const candidate = candidates[0] as JsonRecord | undefined;
  const content = candidate?.content as JsonRecord | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts.map((part) => typeof (part as JsonRecord)?.text === "string" ? String((part as JsonRecord).text) : "").filter(Boolean).join("\n").trim();
}

// Diagnoses *why* Gemini returned no usable text - a blocked prompt (promptFeedback.blockReason)
// or a candidate that stopped for a non-STOP reason (finishReason: SAFETY/RECITATION/MAX_TOKENS/
// OTHER) both look identical ("no text") to extractGeminiText, but need very different handling
// and very different error messages for anyone debugging a failed job.
function geminiBlockReason(data: JsonRecord) {
  const promptFeedback = data.promptFeedback as JsonRecord | undefined;
  const blockReason = String(promptFeedback?.blockReason || "");
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const finishReason = String((candidates[0] as JsonRecord | undefined)?.finishReason || "");
  return [blockReason, finishReason && finishReason !== "STOP" ? finishReason : ""].filter(Boolean).join("/");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sent with every Gemini analysis/QA call. Default Gemini safety thresholds are tuned for
// general-purpose consumer traffic and routinely flag ordinary, fully-clothed fashion-catalog
// photography of real people as a false positive - this is the actual, frequent cause behind
// "Gemini returned no structured response" failures burning through a whole generation job.
// This is an authorized internal tool analyzing licensed product photography for an e-commerce
// catalog, not open-ended public content, so relaxing (not disabling) these thresholds to only
// block genuinely high-probability harmful content is the correct fix, not a policy workaround.
const GEMINI_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
];

// A single flaky/rate-limited/momentarily-over-cautious Gemini call used to burn an entire
// $0.05-0.07 OpenAI image generation attempt via the outer per-pose retry loop, since QA runs
// after the (expensive) image already exists. Retry the (cheap, no-image-cost) Gemini call a
// few times first so a transient hiccup doesn't waste that budget or fail poses needlessly.
async function geminiJson(model: string, parts: JsonRecord[], attempt = 1): Promise<{ raw: JsonRecord; text: string; json: JsonRecord }> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": requiredEnv("GEMINI_API_KEY") },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json" },
      safetySettings: GEMINI_SAFETY_SETTINGS,
    }),
  });
  const data = await response.json().catch(() => ({})) as JsonRecord;
  const retryableStatus = !response.ok && [408, 429, 500, 502, 503, 504].includes(response.status);
  const text = response.ok ? extractGeminiText(data) : "";
  if ((retryableStatus || (response.ok && !text)) && attempt < 3) {
    await sleep(500 * attempt);
    return geminiJson(model, parts, attempt + 1);
  }
  if (!response.ok) throw new Error(String((data.error as JsonRecord | undefined)?.message || `Gemini failed (${response.status}).`));
  if (!text) {
    const reason = geminiBlockReason(data);
    throw new Error(`Gemini returned no structured response${reason ? ` (${reason})` : ""}.`);
  }
  return { raw: data, text, json: parseJsonResponse(text) };
}

async function analyze(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const references = canonicalReferences((Array.isArray(args.references) ? args.references : []) as ReferenceInput[]);
  if (!references.some((reference) => reference.role === "front")) throw new Error("A front product image is required before analysis.");
  if (!references.some((reference) => reference.role === "back")) throw new Error("A back product image is required before analysis.");
  const pHash = productHash(args);
  const rHash = referenceHash(references);
  const fingerprint = smallHash(`${ANALYSIS_VERSION}|${pHash}|${rHash}`);
  const orgId = workspace.organization.id;
  const cacheKey = `${pHash}:${rHash}:${ANALYSIS_VERSION}`;
  let cacheHit = false;
  let normalized: ReturnType<typeof normalizeAnalysis> | null = null;
  const forceRefresh = args.forceRefresh === true;
  if (!forceRefresh) {
    const { data: cached } = await service.from("analysis_cache").select("payload").eq("org_key", orgId).eq("cache_kind", "studio_product_analysis").eq("cache_key", cacheKey).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cached?.payload) {
      normalized = normalizeAnalysis(cached.payload as JsonRecord, String(args.category || "ethnic/fusion"));
      cacheHit = true;
    }
  }
  const started = Date.now();
  if (!normalized) {
    const loaded = await loadAvailableReferences(references);
    const manifest: Array<{ number: number; role: string }> = [];
    const parts: JsonRecord[] = [];
    loaded.forEach((reference, index) => {
      manifest.push({ number: index + 1, role: roleLabel(reference.role) });
      parts.push({ text: `IMAGE ${index + 1}: ${roleLabel(reference.role)}` });
      parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.base64 } });
    });
    parts.push({ text: buildCombinedAnalysisPrompt({
      skuName: String(args.skuName || "Untitled studio product"), productDetails: String(args.productDetails || ""),
      category: String(args.category || "ethnic/fusion"), modelDirection: String(args.modelDirection || ""),
      sceneDirection: String(args.sceneDirection || ""), referenceManifest: manifest,
    }) });
    const model = Deno.env.get("GEMINI_ANALYSIS_MODEL")?.trim() || "gemini-3.6-flash";
    const result = await geminiJson(model, parts);
    normalized = normalizeAnalysis(result.json, String(args.category || "ethnic/fusion"));
    await service.from("analysis_cache").upsert({
      organization_id: orgId, org_key: orgId, cache_kind: "studio_product_analysis", cache_key: cacheKey,
      sku_name: String(args.skuName || ""), product_category: String(args.category || ""), payload: normalized,
      expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "org_key,cache_kind,cache_key" });
    await service.from("ai_runs").insert({
      organization_id: orgId, job_id: "", run_kind: "product_reference_analysis", model, provider: "gemini",
      input_fingerprint: fingerprint, input_summary: { referenceCount: references.length, roles: references.map((reference) => reference.role) },
      output_json: normalized, status: "completed", latency_ms: Date.now() - started, cost_usd: 0, cost_source: "provider_not_reported",
    });
  }

  const requestCode = `STUDIO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const { data: planningRequest, error: planningError } = await service.from("planning_requests").insert({
    organization_id: orgId, created_by_member_id: workspace.member.id, sku_name: String(args.skuName || "Untitled studio product"),
    product_description: String(args.productDetails || ""), photoshoot_type: "ai_catalog_5_pose", category: String(args.category || "ethnic/fusion"),
    status: "analyzed", request_code: requestCode, generation_status: "ready", completion_status: "pending",
    garment_analysis: normalized, ai_analysis: normalized, validation_status: "ready",
  }).select("id").single();
  if (planningError || !planningRequest) throw new Error(planningError?.message || "Could not create the Supabase planning request.");

  const assetRows = references.map((reference) => ({
    organization_id: orgId, planning_request_id: planningRequest.id, sku_name: String(args.skuName || "Untitled studio product"),
    prompt: "", image_url: reference.downloadUrl || "", storage_path: reference.storagePath || "", sku_matched: true,
    asset_role: reference.role, storage_backend: "firebase", metadata: { hash: reference.hash, filename: reference.filename, mimeType: reference.mimeType, size: reference.size },
  }));
  const { data: assets, error: assetError } = await service.from("planning_assets").insert(assetRows).select("id,asset_role,image_url,storage_path,metadata");
  if (assetError) throw new Error(assetError.message);
  const sessionId = `session_${crypto.randomUUID()}`;
  const sessionData = {
    skuId: String(args.skuId || requestCode), skuName: String(args.skuName || "Untitled studio product"),
    productDetails: String(args.productDetails || ""), category: String(args.category || "ethnic/fusion"),
    referenceIds: (assets || []).map((asset) => asset.id), references: (assets || []).map((asset) => ({
      id: asset.id, role: asset.asset_role, downloadUrl: asset.image_url, storagePath: asset.storage_path,
      hash: String((asset.metadata as JsonRecord)?.hash || ""), filename: String((asset.metadata as JsonRecord)?.filename || `${asset.asset_role}.jpg`),
      mimeType: String((asset.metadata as JsonRecord)?.mimeType || "image/jpeg"), size: Number((asset.metadata as JsonRecord)?.size || 0),
    })), productIdentity: normalized.productIdentity, creativeDirection: normalized.creativeDirection,
    modelIdentity: normalized.modelIdentity, posePlan: normalized.posePlan, consistencyRules: CONSISTENCY_RULES,
    analysisModel: Deno.env.get("GEMINI_ANALYSIS_MODEL")?.trim() || "gemini-3.6-flash", analysisVersion: ANALYSIS_VERSION,
    generatedAssets: [], approvedAssets: [],
  };
  const { error: sessionError } = await service.from("catalog_sessions").insert({
    session_id: sessionId, job_id: "", user_id: workspace.user.firebaseUid, organization_id: orgId,
    planning_request_id: planningRequest.id, status: "ready", analysis_fingerprint: fingerprint,
    product_hash: pHash, reference_hash: rHash, session_data: sessionData,
  });
  if (sessionError) throw new Error(sessionError.message);
  return { sessionId, referenceIds: sessionData.referenceIds, analysisFingerprint: fingerprint, productHash: pHash, referenceHash: rHash, ...normalized, cacheHit };
}

function normalizeImageSize(aspectRatio: string, imageSize: string, model: string) {
  if (model !== "gpt-image-2") {
    if (["3:4", "2:3", "4:5", "9:16"].includes(aspectRatio)) return "1024x1536";
    if (["16:9", "3:2"].includes(aspectRatio)) return "1536x1024";
    return "1024x1024";
  }
  const is2k = imageSize.toLowerCase().includes("2k");
  if (aspectRatio === "3:4") return is2k ? "1536x2048" : "768x1024";
  if (aspectRatio === "2:3") return "1024x1536";
  if (aspectRatio === "4:5") return is2k ? "1280x1600" : "832x1040";
  if (aspectRatio === "9:16") return is2k ? "1152x2048" : "720x1280";
  if (aspectRatio === "16:9") return is2k ? "2048x1152" : "1536x864";
  if (aspectRatio === "3:2") return "1536x1024";
  return is2k ? "2048x2048" : "1024x1024";
}

function selectReferences(references: LoadedReference[], approved: LoadedReference[], poseType: string) {
  // A mannequin/flat-lay shot carries worn shape and drape, so it ranks with the
  // primary product truth for full-body poses and drops below the detail shot for
  // the close-up, where texture matters more than silhouette.
  const order = poseType === "back"
    ? ["back", "front", "mannequin", "fabric_pattern", "additional_product"]
    : poseType === "closeup"
      ? ["fabric_pattern", "front", "back", "mannequin", "additional_product"]
      : ["front", "back", "mannequin", "fabric_pattern", "additional_product"];
  // The model face reference (if supplied) leads every pose's image set, including pose 1 -
  // it is the identity ground truth and must reach every generation and QA call, not just the
  // poses that also get an approved-pose-1 anchor.
  const modelRef = references.filter((reference) => reference.role === "model_identity").slice(0, 1);
  const product = order.flatMap((role) => references.filter((reference) => reference.role === role));
  const style = references.filter((reference) => reference.role === "style_reference").slice(0, 3);
  return [...modelRef, ...product, ...approved.slice(0, 1), ...style].slice(0, MAX_REFERENCES);
}

function composeGenerationPrompt(args: {
  skuName: string; productDetails: string; pose: StudioPose & { poseNumber: number };
  session: JsonRecord; references: LoadedReference[]; correction?: string;
}) {
  const product = args.session.productIdentity as JsonRecord;
  const creative = args.session.creativeDirection as JsonRecord;
  const model = args.session.modelIdentity as JsonRecord;
  const rules = Array.isArray(args.session.consistencyRules) ? args.session.consistencyRules.map(String) : CONSISTENCY_RULES;
  const placement = Array.isArray(product?.detailPlacementMap) ? product.detailPlacementMap.map(String) : [];
  const absent = Array.isArray(product?.absenceConstraints) ? product.absenceConstraints.map(String) : [];
  const manifest = args.references.map((reference, index) => `IMAGE ${index + 1}: ${roleLabel(reference.role)}`).join("\n");
  const hasApprovedAnchor = args.references.some((reference) => reference.role === "approved_pose");
  const hasModelReference = args.references.some((reference) => reference.role === "model_identity");
  const faceVisible = args.pose.id !== "back";
  const allowedDelta = [
    `pose/body position: ${args.pose.bodyPosition}`,
    `camera angle: ${args.pose.cameraAngle}`,
    `framing: ${args.pose.framing}`,
    `expression: ${args.pose.expression}`,
  ];
  return `Create ONE premium photorealistic fashion e-commerce photograph for ${args.skuName}.

REFERENCE MANIFEST IN UPLOAD ORDER:
${manifest}

EDIT GOAL:
Place the exact uploaded product on one consistent professional adult fashion model and create Pose ${args.pose.poseNumber}: ${args.pose.title}. The finished image must look like the same real professional photoshoot as the other four images.

LOCKED SUBJECT - MUST NOT CHANGE:
${JSON.stringify(model)}
- Same recognizable face, skin tone, body proportions, hairstyle, hair length/color, makeup, accessories and footwear across the complete set.
- Pose 1 is only the subject/scene anchor for later poses. It never overrides original product references.

FACE & IDENTITY LOCK - HIGHEST PRIORITY:
${hasModelReference
    ? `The image labeled MODEL FACE REFERENCE in the reference manifest above is the exact, non-negotiable face and identity for this model in EVERY pose, including this one - it outranks every other face source, including the approved-pose anchor. Reproduce it as close to pixel-identical as photographically possible: identical facial bone structure, eyes (shape, color, spacing), eyebrows, nose, lips, jawline, skin tone and texture, and hairstyle. Do not idealize, beautify, average, restyle, or blend it with any other face - this must read as the same real person from that reference photo, not merely a similar-looking model.${hasApprovedAnchor ? " Use the APPROVED POSE 1 image only for scene, lighting, and styling continuity - never as a face source." : ""}`
    : hasApprovedAnchor
      ? "The image labeled APPROVED POSE 1 in the reference manifest above is the exact, non-negotiable ground truth for this model's identity. Reproduce the identical facial bone structure, eye shape and color, eyebrow shape, nose, lips, jawline, skin tone and texture, and hairstyle seen in that image - do not idealize, beautify, average, or drift toward a different face."
      : "This is the hero pose and establishes the model identity anchor for the whole shoot. Commit to one specific, photorealistic, naturally beautiful adult face exactly as described in modelIdentity above - every later pose in this set must reproduce this same face."}
${faceVisible
    ? "The face must read as a real photographed person: natural skin texture with visible pores and subtle micro-imperfections, gentle natural asymmetry, anatomically correct and naturally shaped eyes with realistic catchlights and correctly aligned gaze, and naturally aligned teeth (not uniformly perfect, no extra or missing teeth). Never render a plastic, waxy, over-smoothed, mirror-symmetric, or otherwise synthetic \"AI face\". Never distort, warp, blur, or misalign eyes, eyebrows, nose, lips, ears, or teeth."
    : "The face is turned away and is not the subject of this pose - keep hair color/style, skin tone, and body proportions consistent with the identity anchor."}

LOCKED PRODUCT - MUST NOT CHANGE:
${JSON.stringify(product)}
User notes: ${args.productDetails}
Reference authority: FRONT controls front construction; BACK solely controls rear construction; FABRIC/PATTERN resolves material and small construction; a MANNEQUIN/DRESS-FORM shot resolves worn shape, fit, proportion and drape, while a FLAT-LAY resolves outline, construction, panel layout and length only; ADDITIONAL supports product truth; STYLE controls art direction only.
- Product references may be flat-lay, folded, pinned or shot on a mannequin or dress form. Rebuild the garment as it falls on a live human body, and never render a mannequin, dress form, hanger, clip, pin, prop stand, or the flat background surface in the output.
Detail placement hard locks:
${placement.length ? placement.map((rule) => `- ${rule}`).join("\n") : "- Preserve every visible detail only in the exact region shown by the authoritative image."}
Negative-evidence hard locks:
${absent.length ? absent.map((rule) => `- ${rule}`).join("\n") : "- Add no button, closure, tassel/latkan, trim, embroidery, pocket, logo, jewelry or hardware unless the authoritative product image proves it exists at that location."}

LOCKED ART DIRECTION - MUST NOT CHANGE BETWEEN POSES:
${JSON.stringify(creative)}

STYLING ADDITION (optional, locked once chosen):
${creative.suggestedAccessories ? `The stylist has proposed adding: ${creative.suggestedAccessories}. Style the model with exactly this addition, identical across every pose. It is a styling choice only - it must never hide, replace, or contradict the garment, bottom wear, or footwear shown in the product references.` : "No additional styling accessory is needed for this product - use only what the product references show."}

ALLOWED DELTA - THE ONLY THINGS THAT MAY CHANGE:
${allowedDelta.map((value) => `- ${value}`).join("\n")}
- Hand placement: ${args.pose.handPlacement}
- Everything not named here stays locked.

POSE REQUIREMENT:
Description: ${args.pose.description}
Details to highlight: ${args.pose.highlightedDetails.join(", ")}
Visibility rules: ${args.pose.productVisibilityRules.join("; ")}
Purpose: ${args.pose.purpose}
Continuity: ${args.pose.consistencyNotes}
Direction: ${args.pose.prompt}

REALISTIC INTEGRATION:
- Treat this as frame ${args.pose.poseNumber} from one photographed contact sheet, not a new image concept. Reuse the same physical set coordinates, time of day, camera family, focal-length character, camera height, exposure, white balance, light direction, shadow density, and color grade established by Pose 1.
- Preserve natural fabric drape, folds, gravity, occlusion, thickness and construction for this exact material and fit.
- Match locked lighting direction, color temperature, shadows, contact shadows, perspective, lens feel, depth and scene geometry.
- Keep anatomy realistic and keep hands away from product details.
- Preserve believable pores, flyaway hairs, fabric microtexture, seam depth, edge transitions, optical depth of field, and grounded foot/contact shadows. Avoid waxy skin, over-smoothed fabric, duplicated motifs, over-sharpening, floating garments, plastic texture, and other synthetic AI tells.
${faceVisible ? `- Render the eyes with correct anatomy: two naturally shaped, correctly positioned eyes with realistic iris detail, natural catchlights, and a correctly aligned gaze - never crossed, misaligned, melted, or malformed.
- Render teeth naturally: a real, slightly imperfect smile with naturally aligned teeth in the correct count - never uniformly perfect, fused, extra, missing, or warped.
- Skin must show real photographic micro-detail (pores, faint texture variation) rather than an airbrushed, plastic, or over-smoothed "beauty filter" look.` : ""}

PROHIBITED UNRELATED CHANGES:
${rules.map((rule) => `- ${rule}`).join("\n")}
- Never complete, mirror, continue, relocate, add or remove decoration for symmetry.
- Never add random text, branding, people, layers, props that hide the product, or substitute bottom wear.
${args.pose.id === "back" ? "- TRUE BACK HARD RULE: shoulders and hips fully face away. Reproduce uploaded BACK exactly; never infer the rear from FRONT." : ""}
${args.pose.id === "closeup" ? "- POSE 5 HARD RULE: this is a genuine ZOOMED-IN face-to-chest or face-to-waist shot - visibly tighter in scale than the full-body hero pose, never a repeat of that wide framing. The face must be sharp, beautiful, and carry a natural Gen-Z expression, and one real product detail (embroidery, neckline, drape, print, or fabric texture) must also be sharp and clearly visible in the same frame." : ""}
${args.correction ? `\nEARLIER ATTEMPTS OF THIS EXACT POSE FAILED CONSISTENCY QA. Fix every issue listed below in one image while preserving every lock, and never reintroduce a defect an earlier attempt already corrected:\n${args.correction}` : ""}

Product accuracy is more important than style matching. Output only the finished photograph: no captions, labels, collage, borders or watermark.`;
}

async function generateImage(args: { prompt: string; model: string; size: string; quality: string; references: LoadedReference[] }) {
  const body = new FormData();
  body.append("model", args.model);
  body.append("prompt", args.prompt);
  body.append("size", args.size);
  body.append("quality", args.quality);
  // OpenAI defaults image edits/generations to lossless PNG, which routinely runs several MB
  // per pose - slow to upload, store, and download, and unnecessary for catalog photography.
  // Request JPEG instead: this alone (at OpenAI's default output_compression=100, i.e. we don't
  // override it) is what gets a comparable fashion-catalog project down to a few hundred KB per
  // image, so match that rather than layering on an extra, unproven compression knob.
  body.append("output_format", "jpeg");
  // GPT Image 2 always processes reference images at high fidelity and rejects
  // input_fidelity. Older supported GPT Image edit models accept the hint.
  if (["gpt-image-1.5", "gpt-image-1"].includes(args.model)) body.append("input_fidelity", "high");
  for (let index = 0; index < args.references.length; index += 1) {
    const reference = args.references[index];
    body.append("image[]", reference.blob, `${String(index + 1).padStart(2, "0")}_${reference.role}_${reference.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
  }
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", headers: { Authorization: `Bearer ${requiredEnv("OPENAI_API_KEY")}` }, body,
  });
  const responseText = await response.text();
  let data: JsonRecord = {};
  try { data = JSON.parse(responseText) as JsonRecord; } catch { data = {}; }
  if (!response.ok) {
    const providerError = data.error as JsonRecord | undefined;
    const providerMessage = String(providerError?.message || responseText.slice(0, 800) || `OpenAI image request failed (${response.status}).`);
    const error = new Error(providerMessage) as Error & { code?: string; status?: number; retryAfterMs?: number };
    error.code = String(providerError?.code || providerError?.type || "");
    error.status = response.status;
    error.retryAfterMs = Math.max(
      parseRetryAfterMs(response.headers.get("retry-after")),
      parseRetryAfterMs(response.headers.get("x-ratelimit-reset-images")),
    );
    throw error;
  }
  const requestId = response.headers.get("x-request-id") || "";
  const usage = providerUsage(data.usage);
  const costUsd = usageCostUsd(args.model, usage);
  const item = Array.isArray(data.data) ? data.data[0] as JsonRecord | undefined : undefined;
  if (!item?.b64_json && !item?.url) throw new Error("OpenAI returned no image data.");
  if (item.b64_json) {
    const binary = atob(String(item.b64_json));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return {
      blob: new Blob([bytes], { type: "image/jpeg" }), base64: String(item.b64_json), mimeType: "image/jpeg",
      requestId, usage, costUsd,
    };
  }
  const imageResponse = await fetch(String(item.url));
  if (!imageResponse.ok) throw new Error("The generated OpenAI image could not be downloaded.");
  const blob = await imageResponse.blob();
  return { blob, base64: await blobToBase64(blob), mimeType: blob.type || "image/jpeg", requestId, usage, costUsd };
}

function permanentProviderError(error: unknown) {
  const code = String((error as { code?: string })?.code || "").toLowerCase();
  const status = Number((error as { status?: number })?.status || 0);
  return ["moderation_blocked", "invalid_api_key", "image_generation_user_error"].includes(code) || [400, 401, 403, 404].includes(status);
}

async function validatePose(args: {
  generated: { base64: string; mimeType: string }; references: LoadedReference[];
  approved: LoadedReference[]; session: JsonRecord; pose: StudioPose & { poseNumber: number };
}) {
  const qaRefs = selectReferences(args.references, args.approved, args.pose.id);
  const prompt = buildPoseQaPrompt({
    poseNumber: args.pose.poseNumber, poseType: args.pose.id, poseTitle: args.pose.title, poseDirection: args.pose,
    productIdentity: args.session.productIdentity, creativeDirection: args.session.creativeDirection,
    modelIdentity: args.session.modelIdentity, consistencyRules: (args.session.consistencyRules as string[]) || CONSISTENCY_RULES,
    hasApprovedAnchor: args.approved.length > 0,
    hasModelReference: qaRefs.some((reference) => reference.role === "model_identity"),
    referenceManifest: qaRefs.map((reference, index) => `IMAGE ${index + 1}: ${roleLabel(reference.role)}`),
  });
  const parts: JsonRecord[] = [{ text: prompt }, { text: "IMAGE A: NEWLY GENERATED POSE UNDER TEST" }, { inlineData: { mimeType: args.generated.mimeType, data: args.generated.base64 } }];
  qaRefs.forEach((reference) => {
    parts.push({ text: roleLabel(reference.role) });
    parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.base64 } });
  });
  const result = await geminiJson(Deno.env.get("GEMINI_QA_MODEL")?.trim() || "gemini-3.6-flash", parts);
  return { ...parseQaResponse(result.text), usageMetadata: result.raw.usageMetadata || {} };
}

async function kickWorker(jobId?: string) {
  return fetch(FUNCTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "worker", args: jobId ? { jobId } : {} }),
  });
}

async function queueGeneration(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const sessionId = String(args.sessionId || "");
  const { data: session, error: sessionError } = await service.from("catalog_sessions").select("*").eq("session_id", sessionId).eq("organization_id", workspace.organization.id).single();
  if (sessionError || !session) throw new Error("The analyzed generation session is missing or belongs to another organization.");
  if (args.analysisFingerprint && String(args.analysisFingerprint) !== session.analysis_fingerprint) throw new Error("References changed after analysis. Rebuild the current analysis and pose plan before generation.");
  const sessionData = session.session_data as JsonRecord;
  const poses = (Array.isArray(args.poses) ? args.poses : sessionData.posePlan) as StudioPose[];
  const enabled = poses.filter((pose) => pose.enabled !== false && pose.prompt?.trim());
  if (enabled.length !== 5 || enabled.map((pose) => pose.id).join(",") !== "full_front,angled,back,creative,closeup") throw new Error("The current generation session must contain the complete ordered five-pose plan.");
  const allowedModels = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
  const model = allowedModels.includes(String(args.model)) ? String(args.model) : OPENAI_MODEL;
  const quality = ["low", "medium", "high"].includes(String(args.quality)) ? String(args.quality) : "medium";
  const jobId = `job_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const jobData = {
    skuId: String(args.skuId || sessionData.skuId || session.planning_request_id),
    skuName: String(args.skuName || sessionData.skuName || "Untitled studio product"),
    productDetails: String(args.productDetails || sessionData.productDetails || ""), category: String(args.category || sessionData.category || "ethnic/fusion"),
    backgroundStyle: String(args.backgroundStyle || ""), modelIdentityDirection: String(args.modelIdentity || ""),
    references: sessionData.references || [], analysisFingerprint: session.analysis_fingerprint,
  };
  const { error: jobError } = await service.from("generation_jobs").insert({
    job_id: jobId, user_id: workspace.user.firebaseUid, user_email: workspace.user.email, org_id: workspace.organization.id,
    status: "queued", readiness_status: "ready", readiness_reasons: [], sku_name: jobData.skuName, session_id: sessionId, job_data: jobData,
    planning_request_id: session.planning_request_id, total_poses: 5, provider: "openai", model,
    aspect_ratio: String(args.aspectRatio || "3:4"), image_size: String(args.imageSize || "2K"), quality,
    pose_qa: args.poseQa !== false, estimated_cost_usd: 0.25, created_at: now, updated_at: now,
  });
  if (jobError) throw new Error(jobError.message);
  const poseRows = enabled.map((pose, index) => ({
    session_id: sessionId, generation_id: `${jobId}:pose:${index + 1}`, pose_index: index + 1,
    title: pose.title, pose_type: pose.id, instructions: pose.prompt, status: "queued", attempt_count: 0,
    generation_data: { ...pose, poseNumber: index + 1, jobId },
  }));
  const { error: poseError } = await service.from("session_generations").insert(poseRows);
  if (poseError) throw new Error(poseError.message);
  await Promise.all([
    service.from("catalog_sessions").update({ job_id: jobId, status: "generating", updated_at: now, session_data: { ...sessionData, posePlan: enabled } }).eq("session_id", sessionId),
    service.from("planning_requests").update({ status: "generating", generation_status: "queued", generation_job_id: jobId, queued_at: now, updated_at: now }).eq("id", session.planning_request_id),
  ]);
  scheduleBackground(kickWorker());
  return { success: true, jobId };
}

async function nextJob(args: JsonRecord) {
  if (args.jobId) {
    const { data } = await service.from("generation_jobs").select("*").eq("job_id", String(args.jobId)).in("status", ["processing", "cancelling"]).maybeSingle();
    if (data) return data;
  }
  await service.rpc("recover_stale_generation_jobs");
  const { data, error } = await service.rpc("claim_next_generation_job");
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function finalizeJob(job: JsonRecord, session: JsonRecord, poses: JsonRecord[]) {
  const completed = poses.filter((pose) => pose.status === "completed").length;
  const failed = poses.filter((pose) => pose.status === "failed").length;
  const status = failed ? "failed" : "completed";
  const now = new Date().toISOString();
  const sessionData = session.session_data as JsonRecord;
  await Promise.all([
    service.from("generation_jobs").update({
      status, readiness_status: failed ? "needs_review" : "completed", readiness_reasons: failed ? [`${failed} pose(s) failed consistency validation.`] : [], completed_poses: completed, failed_poses: failed, completed_at: now,
      locked_at: null, lock_expires_at: null, updated_at: now,
      ...(failed ? { error_code: "pose_consistency_failed", error_message: `${failed} of ${poses.length} pose(s) exhausted automatic generation/QA retries${completed ? `; ${completed} pose(s) passed and can be downloaded or regenerated individually` : ""}.` } : {}),
    }).eq("job_id", job.job_id),
    service.from("catalog_sessions").update({ status: failed ? "needs_review" : "completed", updated_at: now }).eq("session_id", job.session_id),
    service.from("planning_requests").update({
      status, generation_status: status, completion_status: failed ? "needs_review" : "completed",
      generation_finished_at: now, generation_cost_usd: Number(job.actual_cost_usd || 0), updated_at: now,
      ...(failed ? { error_message: `${failed} pose(s) failed consistency validation.` } : {}),
    }).eq("id", job.planning_request_id),
  ]);
  const { data: member } = await service.from("organization_members").select("id").eq("organization_id", job.org_id).eq("firebase_uid", job.user_id).maybeSingle();
  await service.from("notifications").insert({
    organization_id: job.org_id, recipient_member_id: member?.id || null,
    type: status === "completed" ? "generation_completed" : "generation_failed", channel: "in_app",
    recipient_email: job.user_email || "", planning_request_id: job.planning_request_id,
    title: status === "completed" ? "Photoshoot completed" : "Photoshoot needs review",
    body: `${job.sku_name} finished with ${completed} passed and ${failed} failed poses.`, status: "sent", sent_at: now,
    payload: { jobId: job.job_id, sessionId: job.session_id },
  });
  await service.from("generation_learnings").insert({
    organization_id: job.org_id, job_id: job.job_id, session_id: job.session_id,
    sku_name: job.sku_name || "", product_category: String(sessionData.category || ""), model: job.model,
    provider: job.provider || "openai", status, pose_count: completed, retry_count: poses.reduce((sum, pose) => sum + Math.max(0, Number(pose.attempt_count || 0) - 1), 0),
    processing_time_ms: job.started_at ? Date.now() - new Date(String(job.started_at)).getTime() : 0,
    actual_cost_usd: Number(job.actual_cost_usd || 0), quality_score: completed ? (completed / 5) * 100 : 0,
    success_signals: { completedPoses: completed }, failure_signals: { failedPoses: failed },
    pose_titles: poses.map((pose) => String(pose.title || "")), prompt_fingerprint: String(session.analysis_fingerprint || ""),
    scene_summary: String((sessionData.creativeDirection as JsonRecord | undefined)?.backgroundStyle || ""),
    footwear: String((sessionData.productIdentity as JsonRecord | undefined)?.footwearDetails || ""),
    background_style: String((sessionData.creativeDirection as JsonRecord | undefined)?.backgroundStyle || ""),
    showcase_framing: "3:4", cost_source: "estimated_from_generation_attempts",
  });
  if (job.batch_id) {
    const batchId = String(job.batch_id);
    const { data: batch } = await service.from("planning_batches").select("catalog_memory").eq("id", batchId).maybeSingle();
    const anchor = poses.find((pose) => Number(pose.pose_index) === 1 && pose.status === "completed");
    if (anchor?.output_url) {
      const memory = ((batch?.catalog_memory || {}) as JsonRecord);
      await service.from("planning_batches").update({
        catalog_memory: { ...memory, anchorOutputUrl: anchor.output_url, anchorStoragePath: anchor.storage_path, anchorJobId: job.job_id },
        memory_updated_at: now,
      }).eq("id", batchId);
    }
    const { data: catalogVariants } = await service.from("planning_requests").select("generation_status").eq("batch_id", batchId);
    const completedVariants = (catalogVariants || []).filter((variant) => variant.generation_status === "completed").length;
    const failedVariants = (catalogVariants || []).filter((variant) => variant.generation_status === "failed").length;
    await service.from("planning_batches").update({
      generated_count: completedVariants, failed_count: failedVariants,
      pending_count: Math.max(0, (catalogVariants || []).length - completedVariants - failedVariants), updated_at: now,
    }).eq("id", batchId);
    scheduleBackground(kickCatalogProcessor(batchId));
  }
  scheduleBackground(kickWorker());
}

async function failPoseAndJob(job: JsonRecord, session: JsonRecord, pose: JsonRecord, message: string) {
  const now = new Date().toISOString();
  await service.from("session_generations").update({ status: "failed", qa_status: "failed", error: message.slice(0, 1000), updated_at: now }).eq("session_id", job.session_id).eq("generation_id", pose.generation_id);
  const { data: poses } = await service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index");
  const remaining = (poses || []).filter((entry) => entry.status === "queued");
  // Poses 2-5 depend only on the pose 1 identity anchor, never on each other.
  // A later failure therefore keeps the shoot running and the set is delivered
  // partially for review instead of discarding images already paid for.
  if (remaining.length && Number(pose.pose_index) !== 1) {
    await Promise.all([
      service.from("generation_jobs").update({
        status: "queued", available_at: now, locked_at: null, lock_expires_at: null,
        failed_poses: (poses || []).filter((entry) => entry.status === "failed").length,
        error_code: "pose_consistency_failed", error_message: message.slice(0, 1000), updated_at: now,
      }).eq("job_id", job.job_id),
      service.from("planning_requests").update({ generation_status: "queued", error_message: message.slice(0, 1000), updated_at: now }).eq("id", job.planning_request_id),
    ]);
    scheduleBackground(kickWorker(String(job.job_id)));
    return;
  }
  if (remaining.length) {
    await service.from("session_generations").update({ status: "failed", qa_status: "failed", error: "Skipped because pose 1 is the identity anchor for the set and could not be produced.", updated_at: now }).eq("session_id", job.session_id).eq("status", "queued");
  }
  const { data: finalPoses } = await service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index");
  await finalizeJob({ ...job, actual_cost_usd: Number(job.actual_cost_usd || 0) }, session, (finalPoses || []) as JsonRecord[]);
}

// The image behind a QA rejection is already paid for, so it is archived instead of
// discarded: the shoot owner can see exactly what the model produced, judge the
// verdict, and salvage the frame if it is usable. Archiving must never turn a QA
// rejection into a hard upload failure, so any storage error is logged and ignored.
async function archiveRejectedAttempt(args: {
  job: JsonRecord;
  pose: JsonRecord;
  attempt: number;
  generated: { blob: Blob; mimeType: string };
  qa: { reason: string; score: number; failed: string[] };
}): Promise<JsonRecord | null> {
  try {
    const storagePath = `organizations/${args.job.org_id}/generated/${args.job.job_id}/rejected/${args.pose.pose_index}-attempt-${args.attempt}-${crypto.randomUUID()}.${extensionForMimeType(args.generated.mimeType)}`;
    const stored = await uploadFirebaseObject({ storagePath, blob: args.generated.blob, mimeType: args.generated.mimeType });
    return {
      attempt: args.attempt, url: stored.downloadUrl, storagePath: stored.storagePath,
      mimeType: args.generated.mimeType, reason: args.qa.reason, failed: args.qa.failed,
      score: args.qa.score, createdAt: Date.now(),
    };
  } catch (error) {
    console.error("Could not archive the QA-rejected attempt", errorMessage(error));
    return null;
  }
}

async function deferPoseRetry(args: {
  job: JsonRecord;
  pose: JsonRecord;
  attempt: number;
  message: string;
  corrections: string[];
  rejectedAttempts: JsonRecord[];
  attemptCost: number;
  usage?: ProviderUsage;
  providerRequestId?: string;
  error?: unknown;
}) {
  const delayMs = retryDelayMs(args.error, args.attempt);
  const now = new Date().toISOString();
  const availableAt = new Date(Date.now() + delayMs).toISOString();
  const poseData = (args.pose.generation_data || {}) as JsonRecord;
  const retryMessage = `Pose ${args.pose.pose_index} attempt ${args.attempt} will retry after ${availableAt}: ${args.message}`.slice(0, 1000);
  const usagePatch = args.usage
    ? accumulatedUsage(args.pose, args.usage, String(args.providerRequestId || ""), args.attemptCost)
    : {};
  await Promise.all([
    service.from("session_generations").update({
      status: "queued", qa_status: "pending", error: retryMessage,
      attempt_count: args.attempt, updated_at: now,
      generation_data: { ...poseData, corrections: args.corrections, correction: args.corrections.join("\n"), rejectedAttempts: args.rejectedAttempts, retryAvailableAt: availableAt },
      ...usagePatch,
    }).eq("session_id", args.job.session_id).eq("generation_id", args.pose.generation_id),
    service.from("generation_jobs").update({
      status: "queued", available_at: availableAt, locked_at: null, lock_expires_at: null,
      actual_cost_usd: Number(args.job.actual_cost_usd || 0) + args.attemptCost,
      input_tokens: Number(args.job.input_tokens || 0) + Number(args.usage?.inputTokens || 0),
      input_text_tokens: Number(args.job.input_text_tokens || 0) + Number(args.usage?.inputTextTokens || 0),
      input_image_tokens: Number(args.job.input_image_tokens || 0) + Number(args.usage?.inputImageTokens || 0),
      output_tokens: Number(args.job.output_tokens || 0) + Number(args.usage?.outputTokens || 0),
      total_tokens: Number(args.job.total_tokens || 0) + Number(args.usage?.totalTokens || 0),
      error_code: Number((args.error as { status?: number })?.status || 0) === 429 ? "openai_rate_limited" : "generation_attempt_retry",
      error_message: retryMessage, updated_at: now,
    }).eq("job_id", args.job.job_id),
    service.from("planning_requests").update({
      generation_status: "queued", error_message: retryMessage, updated_at: now,
    }).eq("id", args.job.planning_request_id),
  ]);
  return { processed: true, deferred: true, jobId: args.job.job_id, pose: args.pose.pose_index, availableAt, error: args.message };
}

async function finalizeCancelledJob(job: JsonRecord, message = "Generation cancelled by the user.") {
  const now = new Date().toISOString();
  await Promise.all([
    service.from("generation_jobs").update({
      status: "cancelled", completed_at: now, locked_at: null, lock_expires_at: null,
      error_code: "cancelled", error_message: message, updated_at: now,
    }).eq("job_id", job.job_id),
    service.from("session_generations").update({
      status: "failed", qa_status: "failed", error: message, updated_at: now,
    }).eq("session_id", job.session_id).in("status", ["queued", "processing"]),
    service.from("catalog_sessions").update({ status: "needs_review", updated_at: now }).eq("session_id", job.session_id),
    service.from("planning_requests").update({
      status: "failed", generation_status: "failed", completion_status: "failed",
      error_message: message, generation_finished_at: now, updated_at: now,
    }).eq("id", job.planning_request_id),
  ]);
  if (job.batch_id) {
    const batchId = String(job.batch_id);
    const { data: variants } = await service.from("planning_requests").select("generation_status").eq("batch_id", batchId);
    const completed = (variants || []).filter((variant) => variant.generation_status === "completed").length;
    const failed = (variants || []).filter((variant) => variant.generation_status === "failed").length;
    await service.from("planning_batches").update({
      generated_count: completed, failed_count: failed,
      pending_count: Math.max(0, (variants || []).length - completed - failed), updated_at: now,
    }).eq("id", batchId);
    scheduleBackground(kickCatalogProcessor(batchId));
  }
  scheduleBackground(kickWorker());
  return { processed: true, cancelled: true, jobId: job.job_id };
}

async function processWorker(request: Request, args: JsonRecord) {
  assertInternal(request);
  const job = await nextJob(args) as JsonRecord | null;
  if (!job) return { processed: false };
  if (job.status === "cancelling") {
    return finalizeCancelledJob(job);
  }
  const { data: session, error: sessionError } = await service.from("catalog_sessions").select("*").eq("session_id", job.session_id).single();
  if (sessionError || !session) throw new Error("The generation session is missing.");
  const { data: pose } = await service.from("session_generations").select("*").eq("session_id", job.session_id).eq("status", "queued").order("pose_index").limit(1).maybeSingle();
  if (!pose) {
    const { data: poses } = await service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index");
    await finalizeJob(job, session, (poses || []) as JsonRecord[]);
    return { processed: true, completed: true, jobId: job.job_id };
  }
  const now = new Date().toISOString();
  await Promise.all([
    service.from("session_generations").update({ status: "processing", attempt_count: Number(pose.attempt_count || 0), updated_at: now }).eq("session_id", job.session_id).eq("generation_id", pose.generation_id),
    service.from("generation_jobs").update({ current_pose: pose.pose_index, lock_expires_at: new Date(Date.now() + WORKER_LEASE_MS).toISOString(), updated_at: now }).eq("job_id", job.job_id),
    service.from("planning_requests").update({ generation_status: "processing", generation_started_at: job.started_at || now, updated_at: now }).eq("id", job.planning_request_id),
  ]);
  const sessionData = session.session_data as JsonRecord;
  const sourceInputs = (Array.isArray(sessionData.references) ? sessionData.references : []) as ReferenceInput[];
  const loadedReferences = await loadAvailableReferences(sourceInputs);
  const { data: anchorPose } = Number(pose.pose_index) > 1
    ? await service.from("session_generations").select("output_url,storage_path,title").eq("session_id", job.session_id).eq("pose_index", 1).eq("status", "completed").maybeSingle()
    : { data: null };
  const approved: LoadedReference[] = [];
  if (anchorPose?.output_url || anchorPose?.storage_path) {
    // Load the reference first to determine the actual MIME type from the blob,
    // then set the filename extension to match. No mimeType hint here on purpose:
    // loadReference() falls back to the fetched blob's actual Content-Type.
    // Pose 1 is now stored as JPEG, but could be PNG or WebP for legacy data.
    const loaded = await loadReference({
      role: "approved_pose", downloadUrl: anchorPose.output_url, storagePath: anchorPose.storage_path,
      hash: smallHash(String(anchorPose.output_url || anchorPose.storage_path)), filename: "approved-pose-1", mimeType: "", size: 0,
    });
    // Update filename to include the correct extension based on resolved MIME type
    loaded.filename = `approved-pose-1.${extensionForMimeType(loaded.mimeType)}`;
    approved.push(loaded);
  }
  const storedPoseData = (pose.generation_data || {}) as JsonRecord;
  const poseData = { ...(storedPoseData as StudioPose), poseNumber: Number(pose.pose_index) } as StudioPose & { poseNumber: number };
  const requestedCorrection = String(pose.regeneration_instructions || "").trim();
  // Every earlier QA verdict for this pose stays in the prompt. Carrying only
  // the newest one let a retry fix the latest defect while reintroducing the
  // one the previous attempt had already corrected.
  let qaCorrections = (Array.isArray(storedPoseData.corrections)
    ? storedPoseData.corrections.map(String)
    : [String(storedPoseData.correction || "")]).map((entry) => entry.trim()).filter(Boolean);
  const promptCorrection = () => [
    ...qaCorrections,
    requestedCorrection ? `USER REGENERATION INSTRUCTION (apply only if compatible with original product truth): ${requestedCorrection}` : "",
  ].filter(Boolean).join("\n");
  let rejectedAttempts = Array.isArray(storedPoseData.rejectedAttempts) ? storedPoseData.rejectedAttempts as JsonRecord[] : [];
  let lastError = "Generation did not complete.";
  let attemptCost = 0;
  let attemptUsage: ProviderUsage | undefined;
  let providerRequestId = "";
  const attempt = Number(pose.attempt_count || 0) + 1;
  if (attempt > MAX_GENERATION_ATTEMPTS) {
    await failPoseAndJob(job, session, pose, `Pose ${pose.pose_index} exhausted ${MAX_GENERATION_ATTEMPTS} generation attempts.`);
    return { processed: true, jobId: job.job_id, pose: pose.pose_index, status: "failed" };
  }
  try {
    const selected = selectReferences(loadedReferences, approved, poseData.id);
    const prompt = composeGenerationPrompt({
      skuName: String((job.job_data as JsonRecord)?.skuName || job.sku_name || "Untitled product"),
      productDetails: String((job.job_data as JsonRecord)?.productDetails || ""), pose: poseData, session: sessionData,
      references: selected, correction: promptCorrection(),
    });
    await service.from("session_generations").update({ full_prompt: prompt, attempt_count: attempt, updated_at: new Date().toISOString() }).eq("session_id", job.session_id).eq("generation_id", pose.generation_id);
    const generatedStarted = Date.now();
    const generated = await generateImage({
      prompt, model: String(job.model || OPENAI_MODEL), size: normalizeImageSize(String(job.aspect_ratio || "3:4"), String(job.image_size || "2K"), String(job.model || OPENAI_MODEL)),
      quality: String(job.quality || "medium"), references: selected,
    });
    attemptUsage = generated.usage;
    providerRequestId = generated.requestId;
    attemptCost = generated.costUsd;
    let qa: ReturnType<typeof parseQaResponse> & { usageMetadata?: unknown } = { pass: true, score: 100, checks: {}, failed: [], reason: "QA disabled.", correction: "" };
    // A QA call that cannot return a verdict - safety block, provider outage, malformed
    // response - is not evidence that the frame is wrong. The image is already generated
    // and paid for, so it ships flagged for human review instead of being destroyed and
    // regenerated three times into a total loss.
    let qaUnavailable = "";
    if (job.pose_qa !== false) {
      try {
        qa = await validatePose({ generated, references: loadedReferences, approved, session: sessionData, pose: poseData });
      } catch (error) {
        qaUnavailable = errorMessage(error);
        qa = { pass: true, score: 0, checks: {}, failed: [], reason: `Automatic consistency QA could not run: ${qaUnavailable}`, correction: "" };
      }
    }
    await service.from("ai_runs").insert({
      organization_id: job.org_id, planning_request_id: job.planning_request_id, batch_id: job.batch_id || null,
      job_id: job.job_id, run_kind: "image_generation", model: job.model, provider: "openai",
      input_fingerprint: smallHash(prompt), input_summary: { pose: pose.pose_index, attempt, referenceRoles: selected.map((reference) => reference.role) },
      output_json: { qa }, status: qa.pass ? "completed" : "rejected_by_qa", latency_ms: Date.now() - generatedStarted,
      provider_request_id: providerRequestId,
      input_tokens: generated.usage.inputTokens, input_text_tokens: generated.usage.inputTextTokens,
      input_image_tokens: generated.usage.inputImageTokens, output_tokens: generated.usage.outputTokens,
      total_tokens: generated.usage.totalTokens, usage_payload: { openai: generated.usage.raw, geminiQa: qa.usageMetadata || {} },
      cost_usd: attemptCost, cost_source: generated.usage.providerReported ? "provider_reported_tokens_openai_public_rates" : "provider_not_reported",
    });
    if (!qa.pass) {
      const defect = [qa.correction || qa.reason, qa.failed.length ? `Failed checks: ${qa.failed.join(", ")}.` : ""].filter(Boolean).join(" ").trim();
      qaCorrections = [...qaCorrections, `Attempt ${attempt}: ${defect}`].slice(-MAX_GENERATION_ATTEMPTS);
      const archived = await archiveRejectedAttempt({ job, pose, attempt, generated, qa });
      if (archived) rejectedAttempts = [...rejectedAttempts, archived].slice(-MAX_GENERATION_ATTEMPTS);
      lastError = `Consistency QA failed: ${qa.reason}`;
      await service.from("qa_reviews").insert({
        organization_id: job.org_id, planning_request_id: job.planning_request_id, generation_job_id: job.job_id,
        pose_index: pose.pose_index, reviewer_type: "gemini_auto", score: qa.score, passed: false,
        issues: qa.failed, notes: qa.reason,
      });
      const qaError = new Error(lastError) as Error & { code?: string };
      qaError.code = "consistency_qa_failed";
      throw qaError;
    }
    const { data: latestJob } = await service.from("generation_jobs").select("status").eq("job_id", job.job_id).maybeSingle();
    if (["cancelling", "cancelled"].includes(String(latestJob?.status || ""))) return finalizeCancelledJob(job);
    const safeSku = String((job.job_data as JsonRecord)?.skuId || job.sku_name || "product").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const storagePath = `organizations/${job.org_id}/generated/${job.job_id}/${pose.pose_index}-${safeSku}-${crypto.randomUUID()}.${extensionForMimeType(generated.mimeType)}`;
    const stored = await uploadFirebaseObject({ storagePath, blob: generated.blob, mimeType: generated.mimeType });
    const completedAt = new Date().toISOString();
    const usagePatch = accumulatedUsage(pose as JsonRecord, generated.usage, generated.requestId, attemptCost);
    await Promise.all([
      service.from("session_generations").update({
        status: "completed", output_url: stored.downloadUrl, storage_path: stored.storagePath,
        qa_status: qaUnavailable ? "unverified" : "passed", qa_payload: { ...qa, qaUnavailable },
        error: qaUnavailable ? `Delivered without automatic consistency QA: ${qaUnavailable}`.slice(0, 1000) : "", updated_at: completedAt,
        generation_data: { ...storedPoseData, correction: "", corrections: [], completedAt: Date.now(), mimeType: generated.mimeType },
        ...usagePatch,
      }).eq("session_id", job.session_id).eq("generation_id", pose.generation_id),
      service.from("planning_assets").insert({
        organization_id: job.org_id, planning_request_id: job.planning_request_id, sku_name: job.sku_name,
        prompt, image_url: stored.downloadUrl, storage_path: stored.storagePath, generation_job_id: job.job_id,
        sku_matched: true, asset_role: "generated", storage_backend: "firebase",
        metadata: {
          poseIndex: pose.pose_index, poseType: pose.pose_type, qa, model: job.model, quality: job.quality,
          providerRequestId: generated.requestId, usage: generated.usage.raw, actualCostUsd: attemptCost,
        },
      }),
      // No automatic verdict means no review to record: an unverified frame must not
      // leave a "passed" audit trail behind it.
      qaUnavailable ? Promise.resolve() : service.from("qa_reviews").insert({
        organization_id: job.org_id, planning_request_id: job.planning_request_id, generation_job_id: job.job_id,
        pose_index: pose.pose_index, reviewer_type: "gemini_auto", score: qa.score, passed: true,
        issues: [], notes: qa.reason,
      }),
    ]);
    const { data: allPoses } = await service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index");
    const completedCount = (allPoses || []).filter((entry) => entry.status === "completed").length;
    const failedCount = (allPoses || []).filter((entry) => entry.status === "failed").length;
    const generatedAssets = (allPoses || []).filter((entry) => entry.output_url).map((entry) => ({ poseIndex: entry.pose_index, url: entry.output_url, storagePath: entry.storage_path }));
    await Promise.all([
      service.from("generation_jobs").update({
        completed_poses: completedCount, failed_poses: failedCount,
        actual_cost_usd: Number(job.actual_cost_usd || 0) + attemptCost,
        input_tokens: Number(job.input_tokens || 0) + generated.usage.inputTokens,
        input_text_tokens: Number(job.input_text_tokens || 0) + generated.usage.inputTextTokens,
        input_image_tokens: Number(job.input_image_tokens || 0) + generated.usage.inputImageTokens,
        output_tokens: Number(job.output_tokens || 0) + generated.usage.outputTokens,
        total_tokens: Number(job.total_tokens || 0) + generated.usage.totalTokens,
        attempt_count: 0, available_at: completedAt, error_code: "", error_message: "",
        lock_expires_at: new Date(Date.now() + WORKER_LEASE_MS).toISOString(), updated_at: completedAt,
      }).eq("job_id", job.job_id),
      service.from("catalog_sessions").update({ session_data: { ...sessionData, generatedAssets, approvedAssets: generatedAssets.filter((asset) => asset.poseIndex === 1) }, updated_at: completedAt }).eq("session_id", job.session_id),
      service.from("planning_requests").update({ error_message: "", updated_at: completedAt }).eq("id", job.planning_request_id),
    ]);
    scheduleBackground(kickWorker(String(job.job_id)));
    return { processed: true, jobId: job.job_id, pose: pose.pose_index, status: "completed" };
  } catch (error) {
    lastError = errorMessage(error);
    if (!permanentProviderError(error) && attempt < MAX_GENERATION_ATTEMPTS) {
      return deferPoseRetry({ job, pose, attempt, message: lastError, corrections: qaCorrections, rejectedAttempts, attemptCost, usage: attemptUsage, providerRequestId, error });
    }
  }
  // Last attempt: the archive and the QA history have to be written here, because
  // failPoseAndJob only touches pose status and never rewrites generation_data.
  if (rejectedAttempts.length || qaCorrections.length) {
    await service.from("session_generations").update({
      generation_data: { ...storedPoseData, corrections: qaCorrections, correction: qaCorrections.join("\n"), rejectedAttempts },
      updated_at: new Date().toISOString(),
    }).eq("session_id", job.session_id).eq("generation_id", pose.generation_id);
  }
  if (attemptUsage) {
    await Promise.all([
      service.from("session_generations").update(
        accumulatedUsage(pose as JsonRecord, attemptUsage, providerRequestId, attemptCost),
      ).eq("session_id", job.session_id).eq("generation_id", pose.generation_id),
      service.from("generation_jobs").update({
        actual_cost_usd: Number(job.actual_cost_usd || 0) + attemptCost,
        input_tokens: Number(job.input_tokens || 0) + attemptUsage.inputTokens,
        input_text_tokens: Number(job.input_text_tokens || 0) + attemptUsage.inputTextTokens,
        input_image_tokens: Number(job.input_image_tokens || 0) + attemptUsage.inputImageTokens,
        output_tokens: Number(job.output_tokens || 0) + attemptUsage.outputTokens,
        total_tokens: Number(job.total_tokens || 0) + attemptUsage.totalTokens,
        updated_at: new Date().toISOString(),
      }).eq("job_id", job.job_id),
    ]);
  }
  await failPoseAndJob({ ...job, actual_cost_usd: Number(job.actual_cost_usd || 0) + attemptCost }, session, pose, lastError);
  return { processed: true, jobId: job.job_id, pose: pose.pose_index, status: "failed", error: lastError };
}

async function cancelJob(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const jobId = String(args.jobId || "");
  const { data: job } = await service.from("generation_jobs").select("*").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (!job) throw new Error("Generation job not found.");
  if (!workspace.isAdmin && job.user_id !== workspace.user.firebaseUid) throw new Error("You can cancel only your own generation jobs.");
  if (["completed", "failed", "cancelled"].includes(String(job.status))) return { success: true };
  await service.from("generation_jobs").update({ status: "cancelling", updated_at: new Date().toISOString() }).eq("job_id", jobId);
  await finalizeCancelledJob({ ...job, status: "cancelling" });
  return { success: true };
}

async function regeneratePose(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const generationId = String(args.poseId || args.generationId || "");
  const { data: pose } = await service.from("session_generations").select("*").eq("generation_id", generationId).single();
  if (!pose) throw new Error("Pose not found.");
  const { data: job } = await service.from("generation_jobs").select("*").eq("session_id", pose.session_id).eq("org_id", workspace.organization.id).single();
  if (!job) throw new Error("Generation job not found.");
  if (["queued", "processing", "cancelling"].includes(job.status)) throw new Error("Wait for the current photoshoot to finish before regenerating a pose.");
  if (!workspace.isAdmin && job.user_id !== workspace.user.firebaseUid) throw new Error("You can regenerate only your own generation jobs.");
  const extraInstructions = String(args.extraInstructions || "").trim();
  if (extraInstructions.length > 1000) throw new Error("Regeneration instructions must be 1,000 characters or fewer.");
  const history = Array.isArray(pose.regeneration_history) ? pose.regeneration_history as JsonRecord[] : [];
  await Promise.all([
    service.from("session_generations").update({
      status: "queued", attempt_count: 0, qa_status: "pending", error: "",
      output_url: "", storage_path: "",
      regeneration_instructions: extraInstructions,
      regeneration_history: [...history, { instructions: extraInstructions, previousOutputUrl: pose.output_url || "", previousStoragePath: pose.storage_path || "", requestedAt: new Date().toISOString(), requestedByMemberId: workspace.member.id }].slice(-20),
      updated_at: new Date().toISOString(),
    }).eq("generation_id", generationId),
    service.from("generation_jobs").update({
      status: "queued", readiness_status: "ready", readiness_reasons: [], attempt_count: 0,
      completed_poses: Math.max(0, Number(job.completed_poses || 0) - (pose.status === "completed" ? 1 : 0)),
      failed_poses: Math.max(0, Number(job.failed_poses || 0) - (pose.status === "failed" ? 1 : 0)),
      current_pose: null, available_at: new Date().toISOString(), error_code: "", error_message: "", completed_at: null,
      lock_expires_at: null, locked_at: null, updated_at: new Date().toISOString(),
    }).eq("job_id", job.job_id),
    service.from("catalog_sessions").update({ status: "generating", updated_at: new Date().toISOString() }).eq("session_id", pose.session_id),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
      action: "generation.pose.regenerated", resource_type: "session_generation", resource_id: generationId,
      metadata: { jobId: job.job_id, poseIndex: pose.pose_index, extraInstructions },
    }),
  ]);
  scheduleBackground(kickWorker());
  return { success: true };
}

// Requeues every pose in a failed job that didn't complete, so one bad pose (or the cascading
// "skipped because another required pose failed" poses that follow it) doesn't force the user
// to click "Regenerate" one pose at a time. Poses that already completed are left untouched -
// cheaper, and preserves the pose-1 identity anchor when it's one of the survivors.
async function regenerateSession(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const jobId = String(args.jobId || "");
  const { data: job } = await service.from("generation_jobs").select("*").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (!job) throw new Error("Generation job not found.");
  if (!workspace.isAdmin && job.user_id !== workspace.user.firebaseUid) throw new Error("You can regenerate only your own generation jobs.");
  if (job.status !== "failed") throw new Error("Only a failed generation can be regenerated as a whole session.");
  const { data: poses } = await service.from("session_generations").select("generation_id,status").eq("session_id", job.session_id);
  const incomplete = (poses || []).filter((pose) => pose.status !== "completed");
  if (!incomplete.length) throw new Error("Every pose in this generation already completed - nothing to regenerate.");
  const now = new Date().toISOString();
  await Promise.all([
    service.from("session_generations").update({
      status: "queued", attempt_count: 0, qa_status: "pending", error: "", regeneration_instructions: "",
      output_url: "", storage_path: "", updated_at: now,
    }).eq("session_id", job.session_id).neq("status", "completed"),
    service.from("generation_jobs").update({
      status: "queued", readiness_status: "ready", readiness_reasons: [], attempt_count: 0, failed_poses: 0,
      current_pose: null, available_at: now, error_code: "", error_message: "", completed_at: null,
      lock_expires_at: null, locked_at: null, updated_at: now,
    }).eq("job_id", job.job_id),
    service.from("catalog_sessions").update({ status: "generating", updated_at: now }).eq("session_id", job.session_id),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
      action: "generation.session.regenerated", resource_type: "generation_job", resource_id: jobId,
      metadata: { posesReset: incomplete.length },
    }),
  ]);
  scheduleBackground(kickWorker());
  return { success: true, posesReset: incomplete.length };
}

// A pose owns more than its final image: attempts rejected by consistency QA are
// archived so nothing the organization paid for is destroyed. Ownership checks and
// deletion therefore have to cover that archive as well as the delivered image.
function rejectedAttemptPaths(rows: JsonRecord[]) {
  return rows.flatMap((row) => {
    const data = (row.generation_data || {}) as JsonRecord;
    return (Array.isArray(data.rejectedAttempts) ? data.rejectedAttempts as JsonRecord[] : []).map((entry) => String(entry.storagePath || ""));
  });
}

async function jobImagePaths(job: JsonRecord) {
  const [{ data: poses }, { data: generatedAssets }] = await Promise.all([
    service.from("session_generations").select("storage_path,generation_data").eq("session_id", job.session_id),
    service.from("planning_assets").select("storage_path").eq("generation_job_id", job.job_id).eq("asset_role", "generated"),
  ]);
  return new Set([
    ...(poses || []).map((row) => String(row.storage_path || "")),
    ...rejectedAttemptPaths((poses || []) as JsonRecord[]),
    ...(generatedAssets || []).map((row) => String(row.storage_path || "")),
  ].filter(Boolean));
}

async function removeJob(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const jobId = String(args.jobId || "");
  const { data: job } = await service.from("generation_jobs").select("*").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (!job) throw new Error("Generation job not found.");
  if (["queued", "processing", "cancelling"].includes(job.status)) throw new Error("Cancel the active generation before deleting it.");
  if (!workspace.isAdmin && job.user_id !== workspace.user.firebaseUid) throw new Error("You can delete only your own generation jobs.");
  const generatedPaths = [...await jobImagePaths(job)];
  await service.from("planning_assets").delete().eq("generation_job_id", jobId).eq("asset_role", "generated");
  await service.from("catalog_sessions").delete().eq("session_id", job.session_id);
  await service.from("generation_jobs").delete().eq("job_id", jobId);
  const deletionResults = await Promise.allSettled(generatedPaths.map(deleteFirebaseObject));
  const storageDeleteFailures = deletionResults.filter((result) => result.status === "rejected").length;
  return { success: true, deletedImages: generatedPaths.length - storageDeleteFailures, storageDeleteFailures };
}

// Browsers can render Firebase Storage download URLs directly in <img> tags without any
// CORS setup, but a client-side fetch()/getBytes() of that same URL is subject to CORS —
// and the bucket has no CORS configuration for this app's origin. That silently breaks the
// History page's image/ZIP downloads (each fetch rejects and is swallowed, so the ZIP comes
// back empty). Proxy the bytes through this already-authenticated, same-origin function
// instead, using the Firebase Admin credentials this worker already holds.
async function downloadGeneratedAsset(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const jobId = String(args.jobId || "");
  const storagePath = String(args.storagePath || "");
  if (!jobId || !storagePath) throw new Error("jobId and storagePath are required.");
  const { data: job } = await service.from("generation_jobs").select("job_id,session_id,org_id").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (!job) throw new Error("Generation job not found.");
  const allowed = await jobImagePaths(job);
  if (!allowed.has(storagePath)) throw new Error("This image does not belong to the requested generation job.");
  const blob = await downloadFirebaseObject(storagePath);
  return { base64: await blobToBase64(blob), mimeType: blob.type || "image/png" };
}

// Batched sibling of downloadGeneratedAsset for the "Download ZIP" flow. Calling the
// single-asset operation once per pose meant N separate function invocations - each paying
// its own cold-start and Google OAuth token exchange - which is what made ZIP downloads slow.
// This does one job lookup, one batched ownership check, and fetches every image in parallel
// within a single invocation (one shared token), so the client makes exactly one round trip.
async function downloadGeneratedAssets(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const jobId = String(args.jobId || "");
  const storagePaths = [...new Set((Array.isArray(args.storagePaths) ? args.storagePaths : []).map((value) => String(value || "")).filter(Boolean))];
  if (!jobId || !storagePaths.length) throw new Error("jobId and storagePaths are required.");
  const { data: job } = await service.from("generation_jobs").select("job_id,session_id,org_id").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (!job) throw new Error("Generation job not found.");
  const allowed = await jobImagePaths(job);
  const assetResults = await Promise.all(storagePaths.map(async (storagePath) => {
    if (!allowed.has(storagePath)) return { storagePath, error: "This image does not belong to the requested generation job." };
    try {
      const blob = await downloadFirebaseObject(storagePath);
      return { storagePath, base64: await blobToBase64(blob), mimeType: blob.type || "image/png" };
    } catch (error) {
      return { storagePath, error: errorMessage(error) };
    }
  }));
  return { assets: assetResults };
}

async function adminOverview(request: Request) {
  const { workspace } = await workspaceFor(request);
  if (!workspace.isAdmin && !workspace.permissions.some((permission) => permission.startsWith("admin."))) throw new Error("You do not have access to the admin console.");
  const orgId = workspace.organization.id;
  const [membersResult, rolesResult, permissionsResult, rolePermissionsResult, memberRolesResult, auditsResult, automationResult, deliveriesResult, usageResult] = await Promise.all([
    service.from("organization_members").select("*").eq("organization_id", orgId).order("display_name"),
    service.from("roles").select("*").eq("organization_id", orgId).order("name"),
    service.from("permissions").select("*").order("module").order("key"),
    service.from("role_permissions").select("*"),
    service.from("member_roles").select("*"),
    service.from("audit_logs").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(30),
    service.from("event_automation_settings").select("*").eq("organization_id", orgId).maybeSingle(),
    service.from("event_email_deliveries").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(10),
    service.from("openai_usage_daily").select("usage_date,image_count,request_count,actual_cost_usd,synced_at").eq("organization_id", orgId).order("usage_date", { ascending: false }).limit(100),
  ]);
  for (const result of [membersResult, rolesResult, permissionsResult, rolePermissionsResult, memberRolesResult, auditsResult, automationResult, deliveriesResult, usageResult]) if (result.error) throw new Error(result.error.message);
  const permissions = permissionsResult.data || [];
  const roles = (rolesResult.data || []).map((role) => ({
    ...role,
    permissions: (rolePermissionsResult.data || []).filter((link) => link.role_id === role.id).map((link) => permissions.find((permission) => permission.id === link.permission_id)?.key).filter(Boolean),
  }));
  const members = (membersResult.data || []).map((member) => ({
    ...member,
    user: { id: member.id, firebaseUid: member.firebase_uid, email: member.email, name: member.display_name, displayName: member.display_name, status: member.status },
    roles: (memberRolesResult.data || []).filter((link) => link.member_id === member.id).map((link) => roles.find((role) => role.id === link.role_id)).filter(Boolean),
  }));
  return {
    capabilities: {
      canManageUsers: workspace.isAdmin || workspace.permissions.includes("admin.users.manage"),
      canManageRoles: workspace.isAdmin || workspace.permissions.includes("admin.roles.manage"),
      canManageSettings: workspace.isAdmin || workspace.permissions.includes("admin.settings"),
    },
    health: {
      supabase: true, firebaseConfigured: Boolean(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")),
      openaiConfigured: Boolean(Deno.env.get("OPENAI_API_KEY")), geminiConfigured: Boolean(Deno.env.get("GEMINI_API_KEY")),
      openaiAdminConfigured: Boolean(Deno.env.get("OPENAI_ADMIN_KEY")), emailConfigured: Boolean(Deno.env.get("RESEND_API_KEY") && Deno.env.get("RESEND_FROM")),
      memberCount: members.length, settingsCount: automationResult.data ? 1 : 0,
    },
    members, roles, permissions, recentAuditLogs: auditsResult.data || [],
    automationSettings: automationResult.data,
    recentEventDeliveries: deliveriesResult.data || [],
    openaiUsage: {
      images: (usageResult.data || []).reduce((total, row) => total + Number(row.image_count || 0), 0),
      requests: (usageResult.data || []).reduce((total, row) => total + Number(row.request_count || 0), 0),
      costUsd: (usageResult.data || []).reduce((total, row) => total + Number(row.actual_cost_usd || 0), 0),
      lastSyncedAt: (usageResult.data || []).map((row) => row.synced_at).filter(Boolean).sort().at(-1) || null,
    },
  };
}

async function ensureRoles(orgId: string, roleIds: string[]) {
  if (!roleIds.length) throw new Error("Select at least one valid role.");
  const { data: roles, error } = await service.from("roles").select("*").eq("organization_id", orgId).in("id", roleIds);
  if (error || !roles || roles.length !== new Set(roleIds).size) throw new Error("One or more selected roles are invalid.");
  return roles;
}

async function countActiveAdmins(orgId: string) {
  const { data: adminRole } = await service.from("roles").select("id").eq("organization_id", orgId).eq("slug", "admin").maybeSingle();
  if (!adminRole) return 0;
  const { data: links } = await service.from("member_roles").select("member_id").eq("role_id", adminRole.id);
  const memberIds = (links || []).map((link) => link.member_id);
  if (!memberIds.length) return 0;
  const { count } = await service.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "active").in("id", memberIds);
  return count || 0;
}

async function createUserOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "admin.users.manage");
  const displayName = String(args.displayName || "").trim();
  const email = String(args.email || "").trim().toLowerCase();
  const password = String(args.password || "");
  const roleIds = (Array.isArray(args.roleIds) ? args.roleIds : []).map(String);
  if (!displayName) throw new Error("A full name is required.");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  if (password.length < 8) throw new Error("Password must contain at least 8 characters.");
  const roles = await ensureRoles(workspace.organization.id, roleIds);
  const firebaseUser = await createFirebaseUser({ email, password, displayName }).catch((error) => {
    if (errorMessage(error).includes("EMAIL_EXISTS")) throw new Error("A Firebase account already exists for this email address.");
    throw error;
  });
  try {
    await updateFirebaseUser({
      uid: firebaseUser.localId,
      customClaims: { role: "authenticated", organizationId: workspace.organization.id, roleIds },
    });
    const { data: member, error: memberError } = await service.from("organization_members").insert({
      organization_id: workspace.organization.id, firebase_uid: firebaseUser.localId, email, display_name: displayName,
      status: "active", profile: {}, notification_preferences: {},
    }).select("id").single();
    if (memberError || !member) throw new Error(memberError?.message || "Could not create the organization member.");
    const { error: roleError } = await service.from("member_roles").insert(roleIds.map((roleId) => ({ member_id: member.id, role_id: roleId, assigned_by_member_id: workspace.member.id })));
    if (roleError) throw new Error(roleError.message);
    await service.from("audit_logs").insert({
      organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
      action: "admin.user.created", resource_type: "organization_member", resource_id: member.id,
      metadata: { firebaseUid: firebaseUser.localId, roleIds, roleNames: roles.map((role) => role.name) },
    });
    
    let welcomeEmailSent = false;
    try {
      const loginUrl = Deno.env.get("FRONTEND_URL") || "https://aistudio.youthnic.shop";
      const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://aistudio.youthnic.shop/logo.png" alt="Youthnic AI Studio" style="max-height: 48px; width: auto;" />
  </div>
  <h2 style="color: #111827; font-size: 24px; font-weight: 600; margin-top: 0; margin-bottom: 16px; text-align: center;">Welcome to Youthnic AI Studio</h2>
  <div style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 32px; text-align: center;">
    Hi ${escapeHtml(displayName)},<br><br>
    An administrator has created an account for you at Youthnic AI Studio. You can now log in using this email address.
  </div>
  <div style="text-align: center; margin-bottom: 32px;">
    <a href="${loginUrl}" style="display: inline-block; background-color: #000000; color: #ffffff; font-weight: 600; font-size: 16px; text-decoration: none; padding: 12px 24px; border-radius: 6px;">
      Log In Now
    </a>
  </div>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
  <p style="color: #6b7280; font-size: 14px; margin: 0; text-align: center;">Youthnic AI Studio Administration</p>
</div>
`;
      await sendEmail({
        recipients: [email],
        subject: "Welcome to Youthnic AI Studio",
        html
      });
      welcomeEmailSent = true;
    } catch (emailError) {
      console.error("Failed to send welcome email", emailError);
    }

    return { userId: member.id, firebaseUid: firebaseUser.localId, welcomeEmailSent };
  } catch (error) {
    await deleteFirebaseUser(firebaseUser.localId).catch(() => undefined);
    throw error;
  }
}

async function updateMemberOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "admin.users.manage");
  const memberId = String(args.memberId || "");
  const roleIds = (Array.isArray(args.roleIds) ? args.roleIds : []).map(String);
  const status = args.status === "disabled" ? "disabled" : "active";
  const roles = await ensureRoles(workspace.organization.id, roleIds);
  const { data: member } = await service.from("organization_members").select("*").eq("id", memberId).eq("organization_id", workspace.organization.id).single();
  if (!member) throw new Error("Organization member not found.");
  if (member.id === workspace.member.id && status !== "active") throw new Error("You cannot disable your own administrator account.");
  const { data: currentLinks } = await service.from("member_roles").select("role_id,roles(slug)").eq("member_id", memberId);
  const currentAdmin = (currentLinks || []).some((link) => (link.roles as unknown as { slug?: string })?.slug === "admin");
  const nextAdmin = roles.some((role) => role.slug === "admin");
  if (currentAdmin && (!nextAdmin || status === "disabled") && await countActiveAdmins(workspace.organization.id) <= 1) throw new Error("At least one active administrator must remain.");
  await updateFirebaseUser({
    uid: member.firebase_uid, disabled: status === "disabled",
    ...(args.displayName ? { displayName: String(args.displayName).trim() } : {}),
    customClaims: { role: "authenticated", organizationId: workspace.organization.id, roleIds },
  });
  await service.from("member_roles").delete().eq("member_id", memberId);
  await service.from("member_roles").insert(roleIds.map((roleId) => ({ member_id: memberId, role_id: roleId, assigned_by_member_id: workspace.member.id })));
  await service.from("organization_members").update({ status, ...(args.displayName ? { display_name: String(args.displayName).trim() } : {}), updated_at: new Date().toISOString() }).eq("id", memberId);
  await service.from("audit_logs").insert({
    organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
    action: "admin.user.access_updated", resource_type: "organization_member", resource_id: memberId,
    metadata: { status, roleIds },
  });
  return { success: true };
}

async function updateOwnProfileOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request);
  const displayName = String(args.displayName || "").trim().replace(/\s+/g, " ");
  const jobTitle = String(args.jobTitle || "").trim().slice(0, 100);
  const phone = String(args.phone || "").trim().slice(0, 30);
  if (displayName.length < 2 || displayName.length > 80) throw new Error("Your name must contain between 2 and 80 characters.");
  const { data: member, error } = await service.from("organization_members").select("profile").eq("id", workspace.member.id).eq("organization_id", workspace.organization.id).single();
  if (error || !member) throw new Error("Your organization profile could not be loaded.");
  const currentProfile = member.profile && typeof member.profile === "object" ? member.profile as JsonRecord : {};
  const [, memberUpdate, auditInsert] = await Promise.all([
    updateFirebaseUser({ uid: workspace.user.firebaseUid, displayName }),
    service.from("organization_members").update({
      display_name: displayName, profile: { ...currentProfile, jobTitle, phone }, updated_at: new Date().toISOString(),
    }).eq("id", workspace.member.id).eq("organization_id", workspace.organization.id),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
      action: "profile.updated", resource_type: "organization_member", resource_id: workspace.member.id,
      metadata: { changed: ["displayName", "jobTitle", "phone"] },
    }),
  ]);
  if (memberUpdate.error) throw new Error(memberUpdate.error.message);
  if (auditInsert.error) throw new Error(auditInsert.error.message);
  return { success: true, displayName, jobTitle, phone };
}

async function deleteMemberOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "admin.users.manage");
  const memberId = String(args.memberId || "");
  if (memberId === workspace.member.id) throw new Error("You cannot delete your own administrator account.");
  const { data: member } = await service.from("organization_members").select("*").eq("id", memberId).eq("organization_id", workspace.organization.id).single();
  if (!member) throw new Error("Organization member not found.");
  const { data: links } = await service.from("member_roles").select("role_id,roles(slug)").eq("member_id", memberId);
  const isAdmin = (links || []).some((link) => (link.roles as unknown as { slug?: string })?.slug === "admin");
  if (isAdmin && await countActiveAdmins(workspace.organization.id) <= 1) throw new Error("At least one active administrator must remain.");
  await deleteFirebaseUser(member.firebase_uid).catch(() => undefined);
  await service.from("organization_members").delete().eq("id", memberId);
  await service.from("audit_logs").insert({
    organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
    action: "admin.user.deleted", resource_type: "organization_member", resource_id: memberId, metadata: { provider: "firebase" },
  });
  return { success: true };
}

async function updateRolePermissionsOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "admin.roles.manage");
  const roleId = String(args.roleId || "");
  const keys = [...new Set((Array.isArray(args.permissionKeys) ? args.permissionKeys : []).map(String))];
  const { data: role } = await service.from("roles").select("*").eq("id", roleId).eq("organization_id", workspace.organization.id).single();
  if (!role) throw new Error("Role not found.");
  if (role.slug === "admin") throw new Error("The Admin role always has full access and cannot be restricted.");
  const { data: permissions } = await service.from("permissions").select("id,key").in("key", keys);
  if ((permissions || []).length !== keys.length) throw new Error("One or more permissions are invalid.");
  await service.from("role_permissions").delete().eq("role_id", roleId);
  if (permissions?.length) await service.from("role_permissions").insert(permissions.map((permission) => ({ role_id: roleId, permission_id: permission.id })));
  await service.from("roles").update({ updated_at: new Date().toISOString() }).eq("id", roleId);
  await service.from("audit_logs").insert({
    organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
    action: "admin.role.permissions_updated", resource_type: "role", resource_id: roleId,
    metadata: { role: role.slug, permissionKeys: keys },
  });
  return { success: true };
}

function hasAnyPermission(workspace: Awaited<ReturnType<typeof workspaceFor>>["workspace"], permissions: string[]) {
  return workspace.isAdmin || permissions.some((permission) => workspace.permissions.includes(permission));
}

async function catalogBatch(workspace: Awaited<ReturnType<typeof workspaceFor>>["workspace"], batchId: string) {
  const { data, error } = await service.from("planning_batches").select("*").eq("id", batchId).eq("organization_id", workspace.organization.id).single();
  if (error || !data) throw new Error("Catalog not found.");
  return data as JsonRecord;
}

// Best-effort cleanup for the batch-level reference entries mutate_planning_batch_reference_images
// just replaced or removed from planning_batches.reference_images. A failure here never rolls
// back or blocks the reference-image update that already committed - it only leaves an orphaned
// Firebase Storage object, the same tolerance removeJob() already applies to generated images.
// deleteFirebaseObject() itself tolerates a 404 (already-gone object), so this is safe to call
// even if the same path was already cleaned up by a concurrent request.
async function cleanupOrphanedBatchReferences(removed: unknown) {
  const entries = Array.isArray(removed) ? removed as JsonRecord[] : [];
  const paths = [...new Set(entries.map((entry) => String(entry.storagePath || entry.storage_path || "")).filter(Boolean))];
  if (!paths.length) return;
  const results = await Promise.allSettled(paths.map(deleteFirebaseObject));
  const failures = results.filter((result) => result.status === "rejected").length;
  if (failures) console.warn(`Could not delete ${failures} orphaned catalog reference object(s) from Firebase Storage.`);
}

async function saveReferenceOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request);
  if (!hasAnyPermission(workspace, ["studio.generate", "planning.manage"])) throw new Error("You do not have permission to upload product references.");
  const batchId = String(args.catalogId || "");
  const role = String(args.role || "reference");
  const reference = {
    id: crypto.randomUUID(), role, downloadUrl: String(args.downloadUrl || ""), storagePath: String(args.storagePath || ""),
    hash: String(args.hash || ""), filename: String(args.filename || "reference.jpg"), mimeType: String(args.mimeType || "image/jpeg"),
    size: Number(args.size || 0), storageProvider: String(args.storageProvider || "firebase"),
  };
  if (!batchId) return reference.id;
  await catalogBatch(workspace, batchId); // Org-scoped access check; throws if not found/accessible.
  // Batch-level shared references (visible to every variant in the catalog, not tied to one
  // colourway's own front/back/fabric assets). style_reference: up to a few, creative direction
  // only. model_identity: the one face this whole catalog run should lock to - replace rather
  // than accumulate a second, conflicting one, since a batch only has one model.
  if (role === "style_reference" || role === "model_identity") {
    // Read-modify-write happens atomically in the database (one UPDATE, one row lock) instead
    // of here in app code, so a concurrent upload/removal against the same batch can't silently
    // clobber this change or vice versa.
    const { data: removed, error } = await service.rpc("mutate_planning_batch_reference_images", {
      p_batch_id: batchId, p_add: reference, p_replace_role: role === "model_identity" ? "model_identity" : null, p_remove_id: null,
    });
    if (error) throw new Error(error.message);
    scheduleBackground(cleanupOrphanedBatchReferences(removed));
    await service.from("planning_requests").update({ analysis_status: "stale", updated_at: new Date().toISOString() }).eq("batch_id", batchId).not("front_image_url", "is", null).not("back_image_url", "is", null);
    scheduleBackground(kickCatalogPreflight(batchId));
    return `${role}:${reference.id}`;
  }
  const { data: planningRequest } = await service.from("planning_requests").select("id").eq("batch_id", batchId).eq("sku_name", String(args.skuId || "")).maybeSingle();
  if (!planningRequest) throw new Error("The catalog colourway was not found for this upload.");
  const { data: asset, error } = await service.from("planning_assets").insert({
    organization_id: workspace.organization.id, planning_request_id: planningRequest.id, sku_name: String(args.skuId || ""), prompt: "",
    image_url: reference.downloadUrl, storage_path: reference.storagePath, sku_matched: true, asset_role: role,
    storage_backend: "firebase", metadata: reference,
  }).select("id").single();
  if (error || !asset) throw new Error(error?.message || "Could not save the product reference.");
  return asset.id;
}

async function createCatalogOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const name = String(args.name || "").trim();
  if (!name) throw new Error("A catalog name is required.");
  const now = new Date().toISOString();
  const generationSettings = {
    modelDirection: String(args.modelDirection || ""), sceneDirection: String(args.sceneDirection || ""),
    category: String(args.category || "ethnic/fusion"), aspectRatio: String(args.aspectRatio || "3:4"),
    imageSize: String(args.imageSize || "2K"), quality: "medium", poseQa: args.poseQa !== false,
  };
  const { data, error } = await service.from("planning_batches").insert({
    organization_id: workspace.organization.id, batch_code: `CAT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, name,
    total_skus: 0, generated_count: 0, pending_count: 0, failed_count: 0, status: "active", created_by_member_id: workspace.member.id,
    catalog_key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), queue_status: "idle",
    campaign_season: String(args.campaign || ""), scheduled_at: args.preferredGenerationAt ? new Date(Number(args.preferredGenerationAt)).toISOString() : null,
    schedule_status: "none", source_event_id: args.eventId || null, event_id: args.eventId || null, generation_settings: generationSettings,
    created_at: now, updated_at: now,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message || "Could not create the catalog.");
  return data.id;
}

async function bulkAddVariantsOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const batchId = String(args.catalogId || "");
  await catalogBatch(workspace, batchId);
  const variants = Array.isArray(args.variants) ? args.variants as JsonRecord[] : [];
  if (!variants.length) return { created: 0 };
  const { data: existing } = await service.from("planning_requests").select("sku_name").eq("batch_id", batchId);
  const existingSkus = new Set((existing || []).map((row) => String(row.sku_name).toLowerCase()));
  const clean = variants.filter((variant) => String(variant.sku || "").trim() && !existingSkus.has(String(variant.sku).trim().toLowerCase()));
  if (!clean.length) return { created: 0 };
  const basePosition = existing?.length || 0;
  const { error } = await service.from("planning_requests").insert(clean.map((variant, index) => ({
    organization_id: workspace.organization.id, created_by_member_id: workspace.member.id, batch_id: batchId,
    sku_name: String(variant.sku).trim(), color_label: String(variant.colorLabel || ""), product_description: "",
    photoshoot_type: "catalog_colourway_5_pose", category: "", status: "draft", request_code: `SKU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    generation_status: "pending", completion_status: "pending", validation_status: "pending", queue_position: basePosition + index + 1,
  })));
  if (error) throw new Error(error.message);
  const total = basePosition + clean.length;
  await service.from("planning_batches").update({ total_skus: total, pending_count: total, updated_at: new Date().toISOString() }).eq("id", batchId);
  return { created: clean.length };
}

async function setVariantReferencesOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const requestId = String(args.skuId || "");
  const { data: variant } = await service.from("planning_requests").select("*").eq("id", requestId).eq("organization_id", workspace.organization.id).single();
  if (!variant) throw new Error("Colourway not found.");
  const roleArgs: Array<[string, string, string]> = [
    ["frontReferenceId", "front_image_url", "front_image_path"], ["backReferenceId", "back_image_url", "back_image_path"],
    ["fabricPatternReferenceId", "", ""], ["additionalProductReferenceId", "", ""],
  ];
  const patch: JsonRecord = { updated_at: new Date().toISOString() };
  for (const [key, urlColumn, pathColumn] of roleArgs) {
    if (!args[key]) continue;
    const { data: asset } = await service.from("planning_assets").select("*").eq("id", String(args[key])).eq("planning_request_id", requestId).single();
    if (!asset) throw new Error("Uploaded reference not found.");
    if (urlColumn) patch[urlColumn] = asset.image_url;
    if (pathColumn) patch[pathColumn] = asset.storage_path;
  }
  const front = String(patch.front_image_url || variant.front_image_url || "");
  const back = String(patch.back_image_url || variant.back_image_url || "");
  patch.validation_status = front && back ? "ready" : "pending";
  patch.validation_report = front && back ? { ready: true, reasons: [] } : { ready: false, reasons: [!front ? "Front product image is required." : "", !back ? "Back product image is required." : ""].filter(Boolean) };
  patch.analysis_status = front && back ? "stale" : "pending";
  patch.analysis_fingerprint = "";
  const { error } = await service.from("planning_requests").update(patch).eq("id", requestId);
  if (error) throw new Error(error.message);
  if (front && back) {
    const batchId = String(variant.batch_id || "");
    scheduleBackground(kickCatalogPreflight(batchId, requestId));
    const [{ data: batch }, { data: batchVariants }] = await Promise.all([
      service.from("planning_batches").select("scheduled_at,schedule_status").eq("id", batchId).maybeSingle(),
      service.from("planning_requests").select("front_image_url,back_image_url").eq("batch_id", batchId),
    ]);
    const allReady = Boolean(batchVariants?.length) && (batchVariants || []).every((entry) => entry.front_image_url && entry.back_image_url);
    if (batch?.scheduled_at && String(batch.schedule_status || "none") === "none" && allReady) {
      await service.from("planning_batches").update({
        schedule_status: "scheduled", queue_status: "idle", schedule_error: "", status: "active", updated_at: new Date().toISOString(),
      }).eq("id", batchId);
      if (Date.parse(String(batch.scheduled_at)) <= Date.now() + 1000) scheduleBackground(kickCatalogProcessor(batchId));
    }
  }
  return { success: true };
}

async function removeVariantOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const requestId = String(args.skuId || "");
  const { data: variant } = await service.from("planning_requests").select("batch_id,status").eq("id", requestId).eq("organization_id", workspace.organization.id).single();
  if (!variant) return { success: true };
  if (["generating", "queued"].includes(variant.status)) throw new Error("An active colourway cannot be removed.");
  await service.from("planning_requests").delete().eq("id", requestId);
  const { count } = await service.from("planning_requests").select("id", { count: "exact", head: true }).eq("batch_id", variant.batch_id);
  await service.from("planning_batches").update({ total_skus: count || 0, updated_at: new Date().toISOString() }).eq("id", variant.batch_id);
  return { success: true };
}

async function addCatalogStyleReferenceOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  await catalogBatch(workspace, String(args.catalogId || ""));
  return { success: true, referenceId: String(args.referenceId || "") };
}

async function removeCatalogStyleReferenceOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const catalogId = String(args.catalogId || "");
  await catalogBatch(workspace, catalogId); // Org-scoped access check; throws if not found/accessible.
  // Removes any batch-level shared reference by id, regardless of which role prefix
  // saveReferenceOperation returned it with (style_reference or model_identity). Same atomic
  // RPC as the add/replace path above, so a concurrent add/remove against this batch can't
  // race with this removal.
  const referenceId = String(args.referenceId || "").replace(/^(style|model_identity):/, "");
  const { data: removed, error } = await service.rpc("mutate_planning_batch_reference_images", {
    p_batch_id: catalogId, p_add: null, p_replace_role: null, p_remove_id: referenceId,
  });
  if (error) throw new Error(error.message);
  scheduleBackground(cleanupOrphanedBatchReferences(removed));
  await service.from("planning_requests").update({ analysis_status: "stale", analysis_fingerprint: "", updated_at: new Date().toISOString() }).eq("batch_id", catalogId).not("front_image_url", "is", null).not("back_image_url", "is", null);
  scheduleBackground(kickCatalogPreflight(catalogId));
  return { success: true };
}

function internalWorkerAuthorized(request: Request) {
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const catalogSecret = Deno.env.get("CATALOG_WORKER_SECRET")?.trim();
  return bearer === SERVICE_ROLE_KEY || Boolean(catalogSecret && bearer === catalogSecret);
}

async function kickCatalogProcessor(batchId?: string) {
  return fetch(FUNCTION_URL, {
    method: "POST", headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "catalog.process", args: batchId ? { batchId } : {} }),
  });
}

async function kickCatalogPreflight(batchId: string, requestId?: string) {
  if (!batchId) return new Response(null, { status: 204 });
  return fetch(FUNCTION_URL, {
    method: "POST", headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "catalog.preflight", args: { batchId, ...(requestId ? { requestId } : {}) } }),
  });
}

async function scheduleCatalogOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const batchId = String(args.catalogId || "");
  await catalogBatch(workspace, batchId);
  const scheduledAt = new Date(Number(args.scheduledAt || Date.now())).toISOString();
  const { data: variants } = await service.from("planning_requests").select("id,front_image_url,back_image_url").eq("batch_id", batchId);
  const readyCount = (variants || []).filter((variant) => variant.front_image_url && variant.back_image_url).length;
  if (!readyCount) throw new Error("Upload front and back images for at least one colourway before scheduling.");
  await service.from("planning_batches").update({
    scheduled_at: scheduledAt, schedule_status: "scheduled", queue_status: "idle", schedule_error: "", status: "active", updated_at: new Date().toISOString(),
  }).eq("id", batchId);
  if (Date.parse(scheduledAt) <= Date.now() + 1000) scheduleBackground(kickCatalogProcessor(batchId));
  return { scheduledAt: Date.parse(scheduledAt), readyCount };
}

async function cancelScheduledCatalogOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const batch = await catalogBatch(workspace, String(args.catalogId || ""));
  if (String(batch.queue_status) === "running") throw new Error("A catalog that has started generation cannot be cancelled from Planning. Cancel its active job in History first.");
  await service.from("planning_batches").update({ schedule_status: "cancelled", scheduled_at: null, queue_status: "idle", updated_at: new Date().toISOString() }).eq("id", String(args.catalogId));
  return { success: true };
}

async function retryVariantOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const requestId = String(args.skuId || "");
  const { data: variant } = await service.from("planning_requests").select("batch_id,retry_count").eq("id", requestId).eq("organization_id", workspace.organization.id).single();
  if (!variant) throw new Error("Colourway not found.");
  await service.from("planning_requests").update({ status: "draft", generation_status: "pending", completion_status: "pending", error_message: "", retry_count: Number(variant.retry_count || 0) + 1, updated_at: new Date().toISOString() }).eq("id", requestId);
  scheduleBackground(kickCatalogProcessor(variant.batch_id));
  return { success: true };
}

async function analyzeCatalogVariant(batch: JsonRecord, variant: JsonRecord, references: ReferenceInput[]) {
  const loaded = await loadAvailableReferences(references);
  const settings = (batch.generation_settings || {}) as JsonRecord;
  const manifest: Array<{ number: number; role: string }> = [];
  const parts: JsonRecord[] = [];
  loaded.forEach((reference, index) => {
    manifest.push({ number: index + 1, role: roleLabel(reference.role) });
    parts.push({ text: `IMAGE ${index + 1}: ${roleLabel(reference.role)}` }, { inlineData: { mimeType: reference.mimeType, data: reference.base64 } });
  });
  parts.push({ text: buildCombinedAnalysisPrompt({
    skuName: String(variant.sku_name), productDetails: String(variant.product_description || ""), category: String(settings.category || variant.category || "ethnic/fusion"),
    modelDirection: String(settings.modelDirection || ""), sceneDirection: String(settings.sceneDirection || ""), referenceManifest: manifest,
  }) });
  const result = await geminiJson(Deno.env.get("GEMINI_ANALYSIS_MODEL")?.trim() || "gemini-3.6-flash", parts);
  const normalized = normalizeAnalysis(result.json, String(settings.category || variant.category || "ethnic/fusion"));
  const memory = (batch.catalog_memory || {}) as JsonRecord;
  if (memory.modelIdentity) normalized.modelIdentity = memory.modelIdentity as typeof normalized.modelIdentity;
  if (memory.creativeDirection) normalized.creativeDirection = memory.creativeDirection as typeof normalized.creativeDirection;
  if (Array.isArray(memory.posePlan)) normalized.posePlan = memory.posePlan as StudioPose[];
  return normalized;
}

async function catalogReferenceInputs(batch: JsonRecord, variant: JsonRecord) {
  const { data: assets } = await service.from("planning_assets").select("*").eq("planning_request_id", variant.id).order("created_at");
  const productRefs: ReferenceInput[] = (assets || [])
    .filter((asset) => ["front", "back", "fabric_pattern", "mannequin", "additional_product"].includes(asset.asset_role))
    .map((asset) => ({
      id: asset.id, role: asset.asset_role, downloadUrl: asset.image_url, storagePath: asset.storage_path,
      hash: String((asset.metadata as JsonRecord)?.hash || asset.id), filename: String((asset.metadata as JsonRecord)?.filename || `${asset.asset_role}.jpg`),
      mimeType: String((asset.metadata as JsonRecord)?.mimeType || "image/jpeg"), size: Number((asset.metadata as JsonRecord)?.size || 0),
    }));
  // batch.reference_images holds every batch-level shared reference (style_reference and, now,
  // model_identity) tagged with its own role - preserve that tag instead of collapsing
  // everything to "style_reference", or a model-identity upload would silently be treated as
  // creative direction only and never reach the FACE & IDENTITY LOCK in the generation prompt.
  const sharedRefs: ReferenceInput[] = (Array.isArray(batch.reference_images) ? batch.reference_images as JsonRecord[] : []).map((entry) => ({
    id: String(entry.id || ""), role: String(entry.role || "style_reference"), downloadUrl: String(entry.downloadUrl || entry.image_url || ""), storagePath: String(entry.storagePath || entry.storage_path || ""),
    hash: String(entry.hash || entry.id || ""), filename: String(entry.filename || "style-reference.jpg"), mimeType: String(entry.mimeType || "image/jpeg"), size: Number(entry.size || 0),
  }));
  return { productRefs, references: canonicalReferences([...productRefs, ...sharedRefs]) };
}

function catalogAnalysisFingerprint(batch: JsonRecord, variant: JsonRecord, references: ReferenceInput[]) {
  const settings = (batch.generation_settings || {}) as JsonRecord;
  const pHash = smallHash([
    variant.sku_name, variant.product_description, settings.category, settings.modelDirection, settings.sceneDirection,
  ].map((value) => String(value || "")).join("|"));
  const rHash = referenceHash(references);
  return { pHash, rHash, fingerprint: smallHash(`${ANALYSIS_VERSION}|${pHash}|${rHash}`) };
}

function applyCatalogMemory(batch: JsonRecord, normalized: ReturnType<typeof normalizeAnalysis>) {
  const memory = (batch.catalog_memory || {}) as JsonRecord;
  if (memory.modelIdentity) normalized.modelIdentity = memory.modelIdentity as typeof normalized.modelIdentity;
  if (memory.creativeDirection) normalized.creativeDirection = memory.creativeDirection as typeof normalized.creativeDirection;
  if (Array.isArray(memory.posePlan)) normalized.posePlan = memory.posePlan as StudioPose[];
  return normalized;
}

async function processCatalogPreflight(request: Request, args: JsonRecord) {
  if (!internalWorkerAuthorized(request)) throw new Error("Catalog preflight authorization failed.");
  let batchId = String(args.batchId || "");
  let requestedId = String(args.requestId || "");
  if (!batchId) {
    const { data: candidate } = await service.from("planning_requests").select("id,batch_id")
      .in("analysis_status", ["pending", "stale", "failed"]).not("batch_id", "is", null)
      .not("front_image_url", "is", null).not("back_image_url", "is", null).order("updated_at").limit(1).maybeSingle();
    if (!candidate?.batch_id) return { processed: false, reason: "no_pending_preflight" };
    batchId = String(candidate.batch_id);
    requestedId = String(candidate.id);
  }
  const { data: batch } = await service.from("planning_batches").select("*").eq("id", batchId).maybeSingle();
  if (!batch) return { processed: false, reason: "catalog_missing" };
  let variantsQuery = service.from("planning_requests").select("*").eq("batch_id", batchId).not("front_image_url", "is", null).not("back_image_url", "is", null).order("queue_position");
  if (requestedId) variantsQuery = variantsQuery.eq("id", requestedId);
  else variantsQuery = variantsQuery.in("analysis_status", ["pending", "stale", "failed"]);
  const { data: variants } = await variantsQuery;
  const variant = (variants || []).find((entry) => !["analyzing"].includes(String(entry.analysis_status || "")));
  if (!variant) return { processed: false, reason: "no_ready_variant" };
  const { references } = await catalogReferenceInputs(batch as JsonRecord, variant as JsonRecord);
  const authorityReady = references.some((entry) => entry.role === "front") && references.some((entry) => entry.role === "back");
  if (!authorityReady) return { processed: false, reason: "references_incomplete" };
  const hashes = catalogAnalysisFingerprint(batch as JsonRecord, variant as JsonRecord, references);
  if (variant.analysis_status === "ready" && variant.analysis_fingerprint === hashes.fingerprint && variant.ai_analysis) {
    return { processed: false, reason: "analysis_current", requestId: variant.id };
  }
  const started = Date.now();
  await service.from("planning_requests").update({ analysis_status: "analyzing", updated_at: new Date().toISOString() }).eq("id", variant.id);
  try {
    const normalized = await analyzeCatalogVariant(batch as JsonRecord, variant as JsonRecord, references);
    const now = new Date().toISOString();
    await Promise.all([
      service.from("planning_requests").update({
        analysis_status: "ready", analysis_fingerprint: hashes.fingerprint, analysis_updated_at: now,
        garment_analysis: normalized, ai_analysis: normalized, pose_plan: normalized.posePlan,
        validation_status: "ready", error_message: "", updated_at: now,
      }).eq("id", variant.id),
      service.from("ai_runs").insert({
        organization_id: batch.organization_id, planning_request_id: variant.id, batch_id: batchId,
        job_id: "", run_kind: "catalog_product_preflight", model: Deno.env.get("GEMINI_ANALYSIS_MODEL")?.trim() || "gemini-3.6-flash",
        provider: "gemini", input_fingerprint: hashes.fingerprint,
        input_summary: { referenceCount: references.length, referenceRoles: references.map((entry) => entry.role) },
        output_json: normalized, status: "completed", latency_ms: Date.now() - started,
        cost_usd: 0, cost_source: "provider_cost_not_available",
      }),
    ]);
    if (!args.requestId) scheduleBackground(kickCatalogPreflight(batchId));
    return { processed: true, requestId: variant.id, fingerprint: hashes.fingerprint };
  } catch (error) {
    await service.from("planning_requests").update({
      analysis_status: "failed", error_message: `Automatic Gemini preflight failed: ${errorMessage(error)}`.slice(0, 1000), updated_at: new Date().toISOString(),
    }).eq("id", variant.id);
    return { processed: false, reason: "analysis_failed", requestId: variant.id, error: errorMessage(error) };
  }
}

async function processCatalog(request: Request, args: JsonRecord) {
  if (!internalWorkerAuthorized(request)) throw new Error("Catalog worker authorization failed.");
  let batch: JsonRecord | null = null;
  const requestedBatchId = String(args.batchId || "");
  if (requestedBatchId) {
    const { data } = await service.from("planning_batches").select("*").eq("id", requestedBatchId).maybeSingle();
    batch = data as JsonRecord | null;
    if (batch && String(batch.schedule_status) === "scheduled" && Date.parse(String(batch.scheduled_at || 0)) <= Date.now()) {
      await service.from("planning_batches").update({ schedule_status: "running", queue_status: "running", schedule_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", requestedBatchId);
      batch = { ...batch, schedule_status: "running", queue_status: "running" };
    }
  } else {
    const { data } = await service.rpc("claim_due_catalog_batch");
    batch = Array.isArray(data) ? (data[0] as JsonRecord | undefined) || null : data as JsonRecord | null;
  }
  if (!batch || !["running", "scheduled"].includes(String(batch.schedule_status))) return { processed: false, reason: "no_due_catalog" };
  const batchId = String(batch.id);
  const { data: activeJobs } = await service.from("generation_jobs").select("job_id").eq("batch_id", batchId).in("status", ["queued", "processing", "cancelling"]).limit(1);
  if (activeJobs?.length) return { processed: false, reason: "active_job" };
  const { data: variants } = await service.from("planning_requests").select("*").eq("batch_id", batchId).order("queue_position", { ascending: true });
  const staleVariantIds = (variants || [])
    .filter((row) => ["queued", "processing"].includes(String(row.generation_status)))
    .map((row) => row.id);
  if (staleVariantIds.length) {
    await service.from("planning_requests").update({
      status: "draft", generation_status: "pending", completion_status: "pending",
      generation_job_id: null, error_message: "Recovered a stale catalog queue state; generation will resume automatically.",
      generation_started_at: null, generation_finished_at: null, updated_at: new Date().toISOString(),
    }).in("id", staleVariantIds);
    for (const row of variants || []) {
      if (!staleVariantIds.includes(row.id)) continue;
      row.status = "draft";
      row.generation_status = "pending";
      row.completion_status = "pending";
      row.generation_job_id = null;
    }
  }
  const variant = (variants || []).find((row) => row.front_image_url && row.back_image_url && !["completed", "queued", "processing", "failed"].includes(String(row.generation_status)));
  if (!variant) {
    const completed = (variants || []).filter((row) => row.generation_status === "completed").length;
    const failed = (variants || []).filter((row) => row.generation_status === "failed").length;
    await service.from("planning_batches").update({
      generated_count: completed, failed_count: failed, pending_count: Math.max(0, (variants || []).length - completed - failed),
      queue_status: failed ? "failed" : "completed", schedule_status: failed ? "failed" : "completed",
      schedule_finished_at: new Date().toISOString(), status: failed ? "active" : "completed", updated_at: new Date().toISOString(),
    }).eq("id", batchId);
    return { processed: false, reason: "catalog_complete" };
  }
  try {
    const { productRefs, references } = await catalogReferenceInputs(batch, variant);
    if (!references.some((entry) => entry.role === "front") || !references.some((entry) => entry.role === "back")) throw new Error("Front and back references are required.");
    const hashes = catalogAnalysisFingerprint(batch, variant, references);
    const storedAnalysis = variant.ai_analysis && typeof variant.ai_analysis === "object" ? variant.ai_analysis as JsonRecord : null;
    const normalized = storedAnalysis && variant.analysis_status === "ready" && variant.analysis_fingerprint === hashes.fingerprint
      ? applyCatalogMemory(batch, normalizeAnalysis(storedAnalysis, String(((batch.generation_settings || {}) as JsonRecord).category || variant.category || "ethnic/fusion")))
      : await analyzeCatalogVariant(batch, variant, references);
    const pHash = smallHash(`${hashes.pHash}|${JSON.stringify(normalized.productIdentity)}`);
    const rHash = hashes.rHash;
    const fingerprint = smallHash(`${ANALYSIS_VERSION}|${pHash}|${rHash}`);
    const sessionId = `session_${crypto.randomUUID()}`;
    const settings = (batch.generation_settings || {}) as JsonRecord;
    const sessionData = {
      skuId: variant.sku_name, skuName: variant.sku_name, productDetails: variant.product_description || "", category: settings.category || variant.category || "ethnic/fusion",
      referenceIds: productRefs.map((entry) => entry.id), references, productIdentity: normalized.productIdentity, creativeDirection: normalized.creativeDirection,
      modelIdentity: normalized.modelIdentity, posePlan: normalized.posePlan, consistencyRules: CONSISTENCY_RULES, generatedAssets: [], approvedAssets: [],
    };
    await service.from("catalog_sessions").insert({
      session_id: sessionId, job_id: "", user_id: "catalog-worker", organization_id: batch.organization_id, planning_request_id: variant.id,
      status: "ready", analysis_fingerprint: fingerprint, product_hash: pHash, reference_hash: rHash, session_data: sessionData,
    });
    const jobId = `job_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const { error: jobError } = await service.from("generation_jobs").insert({
      job_id: jobId, user_id: "catalog-worker", user_email: "scheduled@system.local", org_id: batch.organization_id, status: "queued", readiness_status: "ready", readiness_reasons: [], sku_name: variant.sku_name,
      session_id: sessionId, job_data: { skuId: variant.sku_name, skuName: variant.sku_name, productDetails: variant.product_description || "", category: sessionData.category, references, analysisFingerprint: fingerprint },
      planning_request_id: variant.id, batch_id: batchId, total_poses: 5, provider: "openai", model: "gpt-image-2", aspect_ratio: String(settings.aspectRatio || "3:4"),
      image_size: String(settings.imageSize || "2K"), quality: "medium", pose_qa: settings.poseQa !== false, estimated_cost_usd: 0.25, created_at: now, updated_at: now,
    });
    if (jobError) throw new Error(jobError.message);
    await service.from("session_generations").insert(normalized.posePlan.map((pose, index) => ({
      session_id: sessionId, generation_id: `${jobId}:pose:${index + 1}`, pose_index: index + 1, title: pose.title, pose_type: pose.id,
      instructions: pose.prompt, status: "queued", attempt_count: 0, generation_data: { ...pose, poseNumber: index + 1, jobId },
    })));
    await Promise.all([
      service.from("catalog_sessions").update({ job_id: jobId, status: "generating", updated_at: now }).eq("session_id", sessionId),
      service.from("planning_requests").update({
        status: "generating", generation_status: "queued", generation_job_id: jobId,
        analysis_status: "ready", analysis_fingerprint: hashes.fingerprint, analysis_updated_at: now,
        garment_analysis: normalized, ai_analysis: normalized, pose_plan: normalized.posePlan, queued_at: now, updated_at: now,
      }).eq("id", variant.id),
      Object.keys((batch.catalog_memory || {}) as JsonRecord).length ? Promise.resolve() : service.from("planning_batches").update({ catalog_memory: { modelIdentity: normalized.modelIdentity, creativeDirection: normalized.creativeDirection, posePlan: normalized.posePlan }, memory_source_request_id: variant.id, memory_updated_at: now }).eq("id", batchId),
    ]);
    scheduleBackground(kickWorker(jobId));
    return { processed: true, jobId, planningRequestId: variant.id };
  } catch (error) {
    await service.from("planning_requests").update({ status: "failed", generation_status: "failed", completion_status: "failed", error_message: errorMessage(error), generation_finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", variant.id);
    scheduleBackground(kickCatalogProcessor(batchId));
    return { processed: false, reason: "variant_failed", error: errorMessage(error) };
  }
}

async function createEventOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const date = new Date(Number(args.date || Date.now()));
  const leadDays = Math.max(1, Number(args.planningLeadDays || 21));
  const name = String(args.name || "").trim();
  if (!name) throw new Error("An event name is required.");
  const startDate = date.toISOString().slice(0, 10);
  const endCandidate = args.endDate ? new Date(Number(args.endDate)).toISOString().slice(0, 10) : startDate;
  const states = [...new Set((Array.isArray(args.states) ? args.states : []).map((entry) => String(entry).trim()).filter(Boolean))];
  const marketplaces = [...new Set((Array.isArray(args.marketplaces) ? args.marketplaces : []).map((entry) => String(entry).trim()).filter(Boolean))];
  const slug = `${slugify(name)}-${date.getUTCFullYear()}`;
  const { error } = await service.from("marketing_events").upsert({
    organization_id: workspace.organization.id, slug, name, category: String(args.type || "festival"), start_date: startDate,
    end_date: endCandidate >= startDate ? endCandidate : startDate, preparation_deadline: shiftIsoDate(startDate, -leadDays),
    priority: ["urgent", "high", "normal"].includes(String(args.priority)) ? String(args.priority) : "normal",
    applicable_states: states.length ? states : ["Pan-India"], target_marketplaces: marketplaces.length ? marketplaces : ["All"],
    description: String(args.description || "").trim(), source: "manual", source_detail: `Added by ${workspace.user.email}`,
    status: "active", year: date.getUTCFullYear(), is_recurring: false, confidence: 1,
    research_payload: { verificationStatus: "verified", campaignSeason: `${name} ${date.getUTCFullYear()}` },
  }, { onConflict: "organization_id,slug" });
  if (error) throw new Error(error.message);
  return { success: true };
}

// Fixed-calendar national moments. Month/day pairs recur every year, so the
// baseline always lands inside the rolling twelve-month planning horizon.
const BASELINE_EVENT_ROWS: Array<{ name: string; category: string; month: number; day: number; lead: number; priority: string; marketplaces: string[] }> = [
  { name: "Republic Day Sale", category: "marketplace_sale", month: 1, day: 26, lead: 30, priority: "high", marketplaces: ["All"] },
  { name: "Independence Day Sale", category: "marketplace_sale", month: 8, day: 15, lead: 30, priority: "high", marketplaces: ["All"] },
  { name: "Wedding Season Peak", category: "seasonal", month: 11, day: 20, lead: 45, priority: "high", marketplaces: ["All"] },
  { name: "Christmas", category: "festival", month: 12, day: 25, lead: 21, priority: "normal", marketplaces: ["All"] },
  { name: "New Year Party Edit", category: "seasonal", month: 12, day: 31, lead: 30, priority: "high", marketplaces: ["All"] },
];

function padNumber(value: number) {
  return String(Math.trunc(value)).padStart(2, "0");
}

function shiftIsoDate(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
}

function clampMonth(value: unknown, fallback: number) {
  const month = Math.round(Number(value || 0));
  return month >= 1 && month <= 12 ? month : fallback;
}

function slugify(value: string) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// The next calendar occurrence of a fixed day, rolling into next year once the
// date is behind the organization's current date.
function nextFixedDate(month: number, day: number, todayIso: string) {
  const year = Number(todayIso.slice(0, 4));
  const candidate = `${year}-${padNumber(month)}-${padNumber(day)}`;
  return candidate >= todayIso ? candidate : `${year + 1}-${padNumber(month)}-${padNumber(day)}`;
}

// Reference catalogs describe festivals and marketplace campaigns as month
// windows. Planning needs real dates, so the window is materialized as a
// first-to-last-day range for the next occurrence still ahead of today.
function nextMonthWindow(monthStart: unknown, monthEnd: unknown, todayIso: string) {
  const start = clampMonth(monthStart, 1);
  const end = clampMonth(monthEnd, start);
  const baseYear = Number(todayIso.slice(0, 4));
  for (const offset of [0, 1, 2]) {
    const startYear = baseYear + offset;
    const endYear = end >= start ? startYear : startYear + 1;
    const startDate = `${startYear}-${padNumber(start)}-01`;
    const endDate = `${endYear}-${padNumber(end)}-${padNumber(new Date(Date.UTC(endYear, end, 0)).getUTCDate())}`;
    if (endDate >= todayIso) return { startDate, endDate, year: startYear };
  }
  const fallback = `${baseYear + 1}-${padNumber(start)}-01`;
  return { startDate: fallback, endDate: fallback, year: baseYear + 1 };
}

async function insertSeedEvent(orgId: string, row: JsonRecord) {
  const { data: existing } = await service.from("marketing_events").select("id").eq("organization_id", orgId).eq("slug", String(row.slug)).maybeSingle();
  if (existing) return false;
  const { error } = await service.from("marketing_events").insert({ organization_id: orgId, status: "active", is_recurring: true, ...row });
  // A concurrent seed run may win the unique slug race; that is not a failure.
  if (error && error.code !== "23505") throw new Error(error.message);
  return !error;
}

// Seeds the roadmap from the reference catalogs so state-level festivals and
// marketplace sale windows carry dates before any grounded research runs.
async function seedEventsOperation(request: Request) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const orgId = workspace.organization.id;
  const settings = await automationSettings(orgId);
  const today = localDateParts(String(settings.timezone || "Asia/Kolkata")).iso;
  const [festivalsResult, campaignsResult] = await Promise.all([
    service.from("regional_festival_catalog").select("*"),
    service.from("marketplace_campaign_catalog").select("*"),
  ]);
  if (festivalsResult.error) throw new Error(festivalsResult.error.message);
  if (campaignsResult.error) throw new Error(campaignsResult.error.message);

  let festivals = 0;
  let marketplaces = 0;
  let baseline = 0;

  for (const festival of festivalsResult.data || []) {
    const window = nextMonthWindow(festival.typical_month_start, festival.typical_month_end, today);
    const states = Array.isArray(festival.states) && festival.states.length ? festival.states.map(String) : [String(festival.region || "Pan-India")];
    const lunar = Boolean(festival.lunar_based);
    // Slugs follow the research convention (name + year) so a later grounded
    // run upserts the exact date onto this row instead of duplicating it.
    const created = await insertSeedEvent(orgId, {
      slug: `${slugify(String(festival.name || festival.festival_key))}-${window.year}`,
      name: String(festival.name),
      category: "festival",
      start_date: window.startDate,
      end_date: window.endDate,
      preparation_deadline: shiftIsoDate(window.startDate, -35),
      priority: states.includes("Pan-India") ? "high" : "normal",
      applicable_states: states,
      target_marketplaces: ["All"],
      recommended_categories: Array.isArray(festival.product_categories) ? festival.product_categories.map(String) : [],
      visual_themes: Array.isArray(festival.visual_themes) ? festival.visual_themes.map(String) : [],
      color_palette: Array.isArray(festival.color_palette) ? festival.color_palette.map(String) : [],
      styling_props: Array.isArray(festival.styling_props) ? festival.styling_props.map(String) : [],
      description: [String(festival.notes || ""), lunar ? "Lunar calendar festival — the exact date shifts every year and is confirmed by grounded research." : ""].filter(Boolean).join(" "),
      source: "regional_catalog",
      source_detail: `Seeded from the regional festival catalog (${String(festival.region || "India")}).`,
      year: window.year,
      confidence: lunar ? 0.45 : 0.6,
      research_payload: {
        verificationStatus: "estimated",
        campaignSeason: `${festival.name} ${window.year}`,
        planningWindow: `${window.startDate} → ${window.endDate}`,
        lunarBased: lunar,
        region: String(festival.region || ""),
      },
    });
    if (created) festivals += 1;
  }

  for (const campaign of campaignsResult.data || []) {
    const window = nextMonthWindow(campaign.typical_month_start, campaign.typical_month_end, today);
    const priority = ["urgent", "high", "normal"].includes(String(campaign.priority)) ? String(campaign.priority) : "high";
    const created = await insertSeedEvent(orgId, {
      slug: `${slugify(String(campaign.name || campaign.campaign_key))}-${window.year}`,
      name: String(campaign.name),
      category: "marketplace_sale",
      start_date: window.startDate,
      end_date: window.endDate,
      preparation_deadline: shiftIsoDate(window.startDate, priority === "urgent" ? 45 : 40),
      priority,
      applicable_states: ["Pan-India"],
      target_marketplaces: [String(campaign.marketplace || "All")],
      recommended_categories: Array.isArray(campaign.product_categories) ? campaign.product_categories.map(String) : [],
      visual_themes: Array.isArray(campaign.visual_themes) ? campaign.visual_themes.map(String) : [],
      color_palette: Array.isArray(campaign.color_palette) ? campaign.color_palette.map(String) : [],
      description: [String(campaign.recurrence_notes || ""), "Marketplace sale windows are announced late — treat this as a planning window until the platform confirms."].filter(Boolean).join(" "),
      source: "marketplace_catalog",
      source_detail: `Seeded from the marketplace campaign catalog (${String(campaign.marketplace || "All")}).`,
      year: window.year,
      confidence: 0.55,
      research_payload: {
        verificationStatus: "estimated",
        campaignSeason: `${campaign.name} ${window.year}`,
        planningWindow: `${window.startDate} → ${window.endDate}`,
        marketplace: String(campaign.marketplace || "All"),
      },
    });
    if (created) marketplaces += 1;
  }

  for (const row of BASELINE_EVENT_ROWS) {
    const startDate = nextFixedDate(row.month, row.day, today);
    const created = await insertSeedEvent(orgId, {
      slug: `${slugify(row.name)}-${startDate.slice(0, 4)}`,
      name: row.name,
      category: row.category,
      start_date: startDate,
      end_date: startDate,
      preparation_deadline: shiftIsoDate(startDate, -row.lead),
      priority: row.priority,
      applicable_states: ["Pan-India"],
      target_marketplaces: row.marketplaces,
      description: "Fixed-date commercial calendar moment.",
      source: "seed",
      source_detail: "Baseline commercial calendar",
      year: Number(startDate.slice(0, 4)),
      confidence: 0.9,
      research_payload: { verificationStatus: "verified", campaignSeason: `${row.name} ${startDate.slice(0, 4)}` },
    });
    if (created) baseline += 1;
  }

  return { created: festivals + marketplaces + baseline, festivals, marketplaces, baseline };
}

async function automationSettings(orgId: string) {
  const { data: existing, error } = await service.from("event_automation_settings").select("*").eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing as JsonRecord;
  const { data: adminRole } = await service.from("roles").select("id").eq("organization_id", orgId).eq("slug", "admin").maybeSingle();
  const { data: links } = adminRole ? await service.from("member_roles").select("member_id").eq("role_id", adminRole.id) : { data: [] };
  const memberIds = (links || []).map((link) => link.member_id);
  const { data: admins } = memberIds.length ? await service.from("organization_members").select("email").eq("organization_id", orgId).eq("status", "active").in("id", memberIds) : { data: [] };
  const { data: created, error: createError } = await service.from("event_automation_settings").insert({
    organization_id: orgId, report_recipients: cleanEmails((admins || []).map((member) => member.email)),
  }).select("*").single();
  if (createError || !created) throw new Error(createError?.message || "Could not initialize event automation settings.");
  return created as JsonRecord;
}

async function researchEventsForOrganization(orgId: string, runKind: "manual" | "scheduled") {
  const settings = await automationSettings(orgId);
  const started = new Date().toISOString();
  const selectedStates = Array.isArray(settings.state_filters) ? settings.state_filters.map(String) : ["Pan-India", "All Indian states and union territories"];
  const model = Deno.env.get("GEMINI_RESEARCH_MODEL")?.trim() || Deno.env.get("GEMINI_ANALYSIS_MODEL")?.trim() || "gemini-3.6-flash";
  const { data: run } = await service.from("event_research_runs").insert({ organization_id: orgId, run_kind: runKind, model, status: "running", started_at: started }).select("id").single();
  try {
    const response = await geminiGroundedJson(`Use Google Search to build a verified India fashion-commerce event calendar from ${new Date().toISOString().slice(0, 10)} through the next 12 months.
Cover three groups completely:
1. Festivals — national festivals plus the culturally important state and union-territory festivals for: ${selectedStates.join(", ")}. Give every state at least its major dressing-led festivals with the exact dated occurrence in this window (lunar festivals must use the year-specific date, not a generic month).
2. Marketplace sale events — the dated sale windows for Myntra (EORS, Big Fashion Festival), Amazon (Great Indian Festival, Great Freedom Festival, Prime Day), Flipkart (Big Billion Days, Big Diwali Sale, Republic Day sale), Ajio, Nykaa Fashion and Meesho.
3. Seasonal and wedding demand peaks with their dated windows.
Return ONLY valid JSON {"events":[...]}. Each event requires name, category festival|marketplace_sale|seasonal|shopping|launch, startDate YYYY-MM-DD, endDate YYYY-MM-DD, preparationDeadline YYYY-MM-DD (normally 30-45 days earlier), priority urgent|high|normal, marketplaces[], regions[] using official state names or Pan-India, recommendedCategories[], visualThemes[], colorPalette[], description, confidence 0..1, verificationStatus verified|estimated, sourceUrls[].
Use current authoritative sources. Never fabricate an exact marketplace date: if not officially announced, use a defensible planning window, mark estimated, reduce confidence, and explain that in description. Avoid duplicate events and past dates.`);
    const discovered = Array.isArray((response.json as JsonRecord).events) ? (response.json as JsonRecord).events as JsonRecord[] : [];
    let created = 0;
    let updated = 0;
    for (const event of discovered) {
      const name = String(event.name || "").trim();
      const startDate = String(event.startDate || "");
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate < new Date().toISOString().slice(0, 10)) continue;
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${startDate.slice(0, 4)}`;
      const { data: existing } = await service.from("marketing_events").select("id").eq("organization_id", orgId).eq("slug", slug).maybeSingle();
      const sourceUrls = Array.isArray(event.sourceUrls) ? event.sourceUrls.map(String).filter(Boolean) : response.citations.map((citation) => citation.url);
      const row = {
        organization_id: orgId, slug, name, category: String(event.category || "seasonal"), start_date: startDate,
        end_date: /^\d{4}-\d{2}-\d{2}$/.test(String(event.endDate || "")) ? String(event.endDate) : startDate,
        preparation_deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(event.preparationDeadline || "")) ? String(event.preparationDeadline) : new Date(Date.parse(`${startDate}T00:00:00Z`) - 30 * 86400_000).toISOString().slice(0, 10),
        priority: ["urgent", "high", "normal"].includes(String(event.priority)) ? String(event.priority) : "normal",
        applicable_states: Array.isArray(event.regions) && event.regions.length ? event.regions.map(String) : ["Pan-India"],
        target_marketplaces: Array.isArray(event.marketplaces) ? event.marketplaces.map(String) : [],
        recommended_categories: Array.isArray(event.recommendedCategories) ? event.recommendedCategories.map(String) : [],
        visual_themes: Array.isArray(event.visualThemes) ? event.visualThemes.map(String) : [],
        color_palette: Array.isArray(event.colorPalette) ? event.colorPalette.map(String) : [],
        description: String(event.description || ""), source: "gemini_grounded_search", source_detail: "Gemini grounded commercial-calendar research",
        status: "active", year: Number(startDate.slice(0, 4)), is_recurring: false,
        confidence: Math.max(0, Math.min(1, Number(event.confidence || 0.5))),
        research_payload: { ...event, sourceUrls, verificationStatus: String(event.verificationStatus || "estimated") }, updated_at: new Date().toISOString(),
      };
      const { error } = await service.from("marketing_events").upsert(row, { onConflict: "organization_id,slug" });
      if (error) throw new Error(error.message);
      existing ? updated++ : created++;
    }
    if (run) await service.from("event_research_runs").update({ status: "completed", events_discovered: discovered.length, events_upserted: created + updated, summary: `Created ${created}; updated ${updated}.`, payload: { result: response.json, citations: response.citations }, finished_at: new Date().toISOString() }).eq("id", run.id);
    return { created, updated, citations: response.citations.length };
  } catch (error) {
    if (run) await service.from("event_research_runs").update({ status: "failed", error: errorMessage(error), finished_at: new Date().toISOString() }).eq("id", run.id);
    throw error;
  }
}

async function runEventResearchOperation(request: Request) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  return researchEventsForOrganization(workspace.organization.id, "manual");
}

// Brand tokens mirrored from tailwind.config.js so the report reads like the
// Events page it is generated from.
const REPORT_THEME = {
  primary: "#970046",
  blush: "#FBF1F5",
  line: "#F7E3EB",
  surface: "#FAF8FF",
  onSurface: "#131B2E",
  secondary: "#575F69",
  danger: "#DC2626",
  dangerSurface: "#FEF2F2",
  warning: "#D97706",
  warningSurface: "#FFF7ED",
  success: "#0F766E",
  successSurface: "#ECFDF5",
};

const REPORT_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const REPORT_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type PlanningRow = {
  name: string;
  category: string;
  categoryLabel: string;
  startDate: string;
  endDate: string;
  prepDeadline: string;
  priority: string;
  states: string;
  marketplaces: string;
  categories: string;
  themes: string;
  palette: string;
  description: string;
  confidence: number;
  verification: string;
  source: string;
  daysUntil: number;
  prepDaysLeft: number;
  prepStatus: string;
  dayLabel: string;
  monthKey: string;
  monthLabel: string;
};

function daysBetweenIso(fromIso: string, toIso: string) {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86400_000);
}

function listValue(value: unknown, fallback = "") {
  const entries = Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
  return entries.length ? entries.join(", ") : fallback;
}

// One normalized shape drives the email table and the workbook, so both always
// describe the same calendar.
function planningRows(events: JsonRecord[], todayIso: string): PlanningRow[] {
  return events
    .map((event) => {
      const startDate = String(event.start_date || "");
      const endDate = String(event.end_date || startDate);
      const prepDeadline = String(event.preparation_deadline || shiftIsoDate(startDate || todayIso, -21));
      const research = (event.research_payload && typeof event.research_payload === "object" ? event.research_payload : {}) as JsonRecord;
      const daysUntil = daysBetweenIso(todayIso, startDate);
      const prepDaysLeft = daysBetweenIso(todayIso, prepDeadline);
      const parsed = new Date(Date.parse(`${startDate}T00:00:00Z`));
      const category = String(event.category || "seasonal");
      return {
        name: String(event.name || "Untitled event"),
        category,
        categoryLabel: category.replace(/_/g, " "),
        startDate,
        endDate,
        prepDeadline,
        priority: String(event.priority || "normal"),
        states: listValue(event.applicable_states, "Pan-India"),
        marketplaces: listValue(event.target_marketplaces, "All"),
        categories: listValue(event.recommended_categories),
        themes: listValue(event.visual_themes),
        palette: listValue(event.color_palette),
        description: String(event.description || ""),
        confidence: Math.round(Math.max(0, Math.min(1, Number(event.confidence || 0))) * 100),
        verification: String(research.verificationStatus || (Number(event.confidence || 0) >= 0.9 ? "verified" : "estimated")),
        source: String(event.source || ""),
        daysUntil,
        prepDaysLeft,
        prepStatus: prepDaysLeft < 0 ? "Overdue" : prepDaysLeft <= 14 ? "Due now" : "On track",
        dayLabel: Number.isFinite(parsed.getTime()) ? REPORT_WEEKDAYS[parsed.getUTCDay()] : "",
        monthKey: startDate.slice(0, 7),
        monthLabel: Number.isFinite(parsed.getTime()) ? `${REPORT_MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}` : "Undated",
      };
    })
    .filter((row) => row.startDate)
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.name.localeCompare(right.name));
}

function priorityPill(priority: string) {
  if (priority === "urgent") return `background:${REPORT_THEME.dangerSurface};color:${REPORT_THEME.danger}`;
  if (priority === "high") return `background:${REPORT_THEME.warningSurface};color:${REPORT_THEME.warning}`;
  return `background:#EAEDFF;color:${REPORT_THEME.secondary}`;
}

function prepPill(row: PlanningRow) {
  if (row.prepDaysLeft < 0) return `background:${REPORT_THEME.dangerSurface};color:${REPORT_THEME.danger}`;
  if (row.prepDaysLeft <= 14) return `background:${REPORT_THEME.warningSurface};color:${REPORT_THEME.warning}`;
  return `background:${REPORT_THEME.successSurface};color:${REPORT_THEME.success}`;
}

function statCard(label: string, value: string | number, tone = REPORT_THEME.primary) {
  return `<td style="padding:4px" width="25%"><div style="border:1px solid ${REPORT_THEME.line};border-radius:12px;background:#ffffff;padding:12px 14px"><div style="font:700 20px/1.1 Arial,Helvetica,sans-serif;color:${tone}">${escapeHtml(value)}</div><div style="font:600 10px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${REPORT_THEME.secondary};padding-top:4px">${escapeHtml(label)}</div></div></td>`;
}

function eventRowHtml(row: PlanningRow) {
  const day = row.startDate.slice(8, 10);
  const month = REPORT_MONTHS[Number(row.startDate.slice(5, 7)) - 1]?.slice(0, 3) || "";
  const window = row.endDate && row.endDate !== row.startDate ? ` → ${escapeHtml(row.endDate)}` : "";
  const meta = [row.states, row.marketplaces ? `Marketplaces: ${row.marketplaces}` : "", row.themes ? `Themes: ${row.themes}` : ""].filter(Boolean).join(" · ");
  return `<tr>
    <td valign="top" style="padding:12px 10px;border-bottom:1px solid ${REPORT_THEME.line};width:74px">
      <div style="border-radius:10px;background:${REPORT_THEME.blush};text-align:center;padding:8px 4px">
        <div style="font:700 20px/1 Arial,Helvetica,sans-serif;color:${REPORT_THEME.primary}">${escapeHtml(day)}</div>
        <div style="font:700 9px/1.6 Arial,Helvetica,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${REPORT_THEME.secondary}">${escapeHtml(month)}</div>
      </div>
      <div style="font:600 9px/1.6 Arial,Helvetica,sans-serif;text-align:center;color:${REPORT_THEME.secondary};padding-top:4px">${escapeHtml(row.dayLabel.slice(0, 3))}</div>
    </td>
    <td valign="top" style="padding:12px 10px;border-bottom:1px solid ${REPORT_THEME.line}">
      <div style="font:700 15px/1.3 Arial,Helvetica,sans-serif;color:${REPORT_THEME.onSurface}">${escapeHtml(row.name)}${window ? `<span style="font:600 11px/1.3 Arial,Helvetica,sans-serif;color:${REPORT_THEME.secondary}">${window}</span>` : ""}</div>
      <div style="font:600 10px/1.6 Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${REPORT_THEME.primary};padding-top:2px">${escapeHtml(row.categoryLabel)}</div>
      ${meta ? `<div style="font:400 11px/1.5 Arial,Helvetica,sans-serif;color:${REPORT_THEME.secondary};padding-top:4px">${escapeHtml(meta)}</div>` : ""}
    </td>
    <td valign="top" align="right" style="padding:12px 10px;border-bottom:1px solid ${REPORT_THEME.line};width:190px">
      <span style="display:inline-block;border-radius:999px;padding:3px 9px;font:700 9px/1.6 Arial,Helvetica,sans-serif;letter-spacing:.09em;text-transform:uppercase;${priorityPill(row.priority)}">${escapeHtml(row.priority)}</span>
      <div style="font:400 11px/1.6 Arial,Helvetica,sans-serif;color:${REPORT_THEME.secondary};padding-top:6px">Prep by <strong style="color:${REPORT_THEME.onSurface}">${escapeHtml(row.prepDeadline)}</strong></div>
      <span style="display:inline-block;border-radius:999px;padding:3px 9px;margin-top:4px;font:700 9px/1.6 Arial,Helvetica,sans-serif;letter-spacing:.09em;text-transform:uppercase;${prepPill(row)}">${escapeHtml(row.prepStatus)} · ${row.daysUntil <= 0 ? "live" : `${row.daysUntil}d out`}</span>
    </td>
  </tr>`;
}

function eventReportHtml(organizationName: string, events: JsonRecord[], heading: string, options: { todayIso?: string; note?: string; attachmentName?: string; rangeLabel?: string } = {}) {
  const todayIso = options.todayIso || new Date().toISOString().slice(0, 10);
  const rows = planningRows(events, todayIso);
  const months = [...new Set(rows.map((row) => row.monthKey))];
  const prepDue = rows.filter((row) => row.prepDaysLeft <= 14).length;
  const festivals = rows.filter((row) => row.category === "festival").length;
  const marketplaceCount = rows.filter((row) => row.category === "marketplace_sale").length;
  const sections = months.map((monthKey) => {
    const monthRows = rows.filter((row) => row.monthKey === monthKey);
    return `<tr><td style="padding:22px 10px 6px">
        <div style="font:700 11px/1.6 Arial,Helvetica,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${REPORT_THEME.primary}">${escapeHtml(monthRows[0].monthLabel)}</div>
        <div style="font:400 11px/1.6 Arial,Helvetica,sans-serif;color:${REPORT_THEME.secondary}">${monthRows.length} event${monthRows.length === 1 ? "" : "s"}</div>
      </td></tr>
      <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${REPORT_THEME.line};border-radius:14px;background:#ffffff">${monthRows.map(eventRowHtml).join("")}</table></td></tr>`;
  }).join("");

  return `<div style="margin:0;padding:24px 12px;background:${REPORT_THEME.surface};font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:760px;margin:0 auto;border-collapse:collapse">
    <tr><td style="border-radius:18px;background:${REPORT_THEME.primary};padding:26px 24px">
      <div style="font:700 10px/1.6 Arial,Helvetica,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#FFD5DD">${escapeHtml(organizationName)} · campaign intelligence</div>
      <div style="font:700 26px/1.2 Arial,Helvetica,sans-serif;color:#ffffff;padding-top:6px">${escapeHtml(heading)}</div>
      <div style="font:400 13px/1.6 Arial,Helvetica,sans-serif;color:#FFD5DD;padding-top:6px">${escapeHtml(options.rangeLabel || `Planning calendar generated on ${todayIso}`)}</div>
    </td></tr>
    ${options.note ? `<tr><td style="padding:14px 4px 0"><div style="border-left:3px solid ${REPORT_THEME.primary};background:#ffffff;border-radius:10px;padding:12px 14px;font:400 13px/1.6 Arial,Helvetica,sans-serif;color:${REPORT_THEME.onSurface};white-space:pre-wrap">${escapeHtml(options.note)}</div></td></tr>` : ""}
    <tr><td style="padding:14px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
      ${statCard("Events in report", rows.length)}
      ${statCard("Prep due ≤ 14 days", prepDue, prepDue ? REPORT_THEME.warning : REPORT_THEME.success)}
      ${statCard("Festivals", festivals)}
      ${statCard("Marketplace sales", marketplaceCount)}
    </tr></table></td></tr>
    ${rows.length ? sections : `<tr><td style="padding:24px 10px"><div style="border:1px dashed ${REPORT_THEME.line};border-radius:14px;background:#ffffff;padding:28px;text-align:center;font:400 13px/1.6 Arial,Helvetica,sans-serif;color:${REPORT_THEME.secondary}">No events fall inside this window. Run event research in the Events module to refresh the roadmap.</div></td></tr>`}
    <tr><td style="padding:22px 10px 0">
      <div style="border-radius:14px;background:${REPORT_THEME.blush};padding:16px 18px;font:400 12px/1.7 Arial,Helvetica,sans-serif;color:${REPORT_THEME.secondary}">
        ${options.attachmentName ? `<strong style="color:${REPORT_THEME.onSurface}">${escapeHtml(options.attachmentName)}</strong> is attached with the full date-wise plan, prep deadlines, states, marketplaces and creative direction.<br>` : ""}
        Prepare product, references and catalog uploads before each prep deadline. Dates marked <em>estimated</em> are planning windows and should be re-checked before media spend is committed.
      </div>
    </td></tr>
    <tr><td style="padding:16px 10px 4px;font:400 11px/1.6 Arial,Helvetica,sans-serif;color:${REPORT_THEME.secondary};text-align:center">Generated by Youthnic AI Studio · Events roadmap</td></tr>
  </table>
</div>`;
}

// Date-wise planning workbook attached to every event report.
async function buildEventWorkbook(organizationName: string, events: JsonRecord[], todayIso: string) {
  const rows = planningRows(events, todayIso);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Youthnic AI Studio";
  workbook.created = new Date();

  const calendar = workbook.addWorksheet("Planning calendar", { views: [{ state: "frozen", ySplit: 1 }] });
  calendar.columns = [
    { header: "#", key: "index", width: 5 },
    { header: "Event date", key: "startDate", width: 13 },
    { header: "Day", key: "dayLabel", width: 11 },
    { header: "Window ends", key: "endDate", width: 13 },
    { header: "Days until", key: "daysUntil", width: 11 },
    { header: "Event", key: "name", width: 34 },
    { header: "Type", key: "categoryLabel", width: 18 },
    { header: "Priority", key: "priority", width: 10 },
    { header: "Prep deadline", key: "prepDeadline", width: 14 },
    { header: "Prep days left", key: "prepDaysLeft", width: 14 },
    { header: "Prep status", key: "prepStatus", width: 12 },
    { header: "States / region", key: "states", width: 30 },
    { header: "Marketplaces", key: "marketplaces", width: 20 },
    { header: "Product focus", key: "categories", width: 28 },
    { header: "Visual themes", key: "themes", width: 30 },
    { header: "Colour palette", key: "palette", width: 26 },
    { header: "Confidence %", key: "confidence", width: 13 },
    { header: "Verification", key: "verification", width: 13 },
    { header: "Source", key: "source", width: 20 },
    { header: "Notes", key: "description", width: 60 },
  ];
  rows.forEach((row, index) => calendar.addRow({ ...row, index: index + 1 }));

  const months = [...new Set(rows.map((row) => row.monthKey))];
  const summary = workbook.addWorksheet("Month summary", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.columns = [
    { header: "Month", key: "month", width: 20 },
    { header: "Events", key: "events", width: 10 },
    { header: "Festivals", key: "festivals", width: 11 },
    { header: "Marketplace sales", key: "marketplace", width: 18 },
    { header: "Urgent", key: "urgent", width: 9 },
    { header: "Prep due in window", key: "prepDue", width: 19 },
    { header: "First prep deadline", key: "firstPrep", width: 19 },
  ];
  for (const monthKey of months) {
    const monthRows = rows.filter((row) => row.monthKey === monthKey);
    summary.addRow({
      month: monthRows[0].monthLabel,
      events: monthRows.length,
      festivals: monthRows.filter((row) => row.category === "festival").length,
      marketplace: monthRows.filter((row) => row.category === "marketplace_sale").length,
      urgent: monthRows.filter((row) => row.priority === "urgent").length,
      prepDue: monthRows.filter((row) => row.prepDaysLeft <= 14).length,
      firstPrep: monthRows.map((row) => row.prepDeadline).sort()[0] || "",
    });
  }

  for (const sheet of [calendar, summary]) {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF970046" } };
    header.alignment = { vertical: "middle", horizontal: "left" };
    header.height = 22;
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.alignment = { vertical: "top", wrapText: true };
      if (rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF1F5" } };
    });
  }
  calendar.getColumn("priority").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    const value = String(cell.value || "");
    cell.font = { bold: value === "urgent", color: { argb: value === "urgent" ? "FFDC2626" : value === "high" ? "FFD97706" : "FF575F69" } };
  });
  calendar.getColumn("prepStatus").eachCell((cell, rowNumber) => {
    if (rowNumber === 1) return;
    const value = String(cell.value || "");
    cell.font = { bold: value !== "On track", color: { argb: value === "Overdue" ? "FFDC2626" : value === "Due now" ? "FFD97706" : "FF0F766E" } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${slugify(organizationName) || "youthnic"}-event-plan-${todayIso}.xlsx`;
  return { filename, content: bytesToBase64(new Uint8Array(buffer as ArrayBuffer)) };
}

async function sendTrackedEventEmail(args: { orgId: string; eventId?: string; kind: "monthly_report" | "event_reminder" | "manual_digest"; key: string; recipients: string[]; subject: string; html: string; attachments?: Array<{ filename: string; content: string }>; payload?: JsonRecord }) {
  const { data: existing } = await service.from("event_email_deliveries").select("id,status,updated_at").eq("organization_id", args.orgId).eq("delivery_kind", args.kind).eq("delivery_key", args.key).maybeSingle();
  if (existing?.status === "sent") return { sent: false, skipped: true, providerMessageId: "" };
  if (existing?.status === "pending" && Date.now() - Date.parse(existing.updated_at) < 10 * 60_000) return { sent: false, skipped: true, providerMessageId: "" };
  const row = { organization_id: args.orgId, event_id: args.eventId || null, delivery_kind: args.kind, delivery_key: args.key, recipients: args.recipients, subject: args.subject, status: "pending", error_message: "", payload: args.payload || {}, updated_at: new Date().toISOString() };
  const { data: delivery, error } = existing
    ? await service.from("event_email_deliveries").update(row).eq("id", existing.id).select("id").single()
    : await service.from("event_email_deliveries").insert(row).select("id").single();
  if (error || !delivery) {
    if (error?.code === "23505") return { sent: false, skipped: true, providerMessageId: "" };
    throw new Error(error?.message || "Could not reserve the event email delivery.");
  }
  try {
    const providerMessageId = await sendEmail({ recipients: args.recipients, subject: args.subject, html: args.html, attachments: args.attachments });
    await service.from("event_email_deliveries").update({ status: "sent", provider_message_id: providerMessageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
    return { sent: true, skipped: false, providerMessageId };
  } catch (error) {
    await service.from("event_email_deliveries").update({ status: "failed", error_message: errorMessage(error), updated_at: new Date().toISOString() }).eq("id", delivery.id);
    throw error;
  }
}

function matchesFilterList(values: unknown, selected: string[]) {
  if (!selected.length) return true;
  const entries = (Array.isArray(values) ? values : []).map((entry) => String(entry).toLowerCase());
  return selected.some((choice) => entries.includes(choice.toLowerCase()) || (choice.toLowerCase() !== "pan-india" && entries.includes("pan-india")) || entries.includes("all"));
}

// Emails the date-wise roadmap using the Events-page theme with the planning
// workbook attached. Recipients default to the configured report list.
async function sendDigestOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const orgId = workspace.organization.id;
  const organizationName = workspace.organization.name;
  const settings = await automationSettings(orgId);
  const requested = cleanEmails(args.recipients);
  const recipients = requested.length ? requested : cleanEmails(settings.report_recipients);
  if (!recipients.length) throw new Error("Add at least one recipient, or configure report recipients in Administration.");
  const today = localDateParts(String(settings.timezone || "Asia/Kolkata")).iso;
  const horizonDays = Math.max(7, Math.min(730, Math.round(Number(args.horizonDays || 365))));
  const through = shiftIsoDate(today, horizonDays);
  const { data, error } = await service.from("marketing_events").select("*").eq("organization_id", orgId).eq("status", "active").gte("start_date", today).lte("start_date", through).order("start_date");
  if (error) throw new Error(error.message);

  const types = (Array.isArray(args.types) ? args.types : []).map((entry) => String(entry).trim()).filter(Boolean);
  const states = (Array.isArray(args.states) ? args.states : []).map((entry) => String(entry).trim()).filter(Boolean);
  const marketplaces = (Array.isArray(args.marketplaces) ? args.marketplaces : []).map((entry) => String(entry).trim()).filter(Boolean);
  const eventIds = (Array.isArray(args.eventIds) ? args.eventIds : []).map((entry) => String(entry)).filter(Boolean);
  const events = ((data || []) as JsonRecord[]).filter((event) => {
    if (eventIds.length && !eventIds.includes(String(event.id))) return false;
    if (types.length && !types.includes(String(event.category))) return false;
    return matchesFilterList(event.applicable_states, states) && matchesFilterList(event.target_marketplaces, marketplaces);
  });

  const heading = String(args.heading || "").trim() || "Event planning report";
  const rangeLabel = `${events.length} event${events.length === 1 ? "" : "s"} · ${today} → ${through}`;
  const attachment = await buildEventWorkbook(organizationName, events, today);
  const subject = String(args.subject || "").trim() || `${organizationName} · event plan · ${today} → ${through}`;
  const delivery = await sendTrackedEventEmail({
    orgId,
    kind: "manual_digest",
    key: crypto.randomUUID(),
    recipients,
    subject,
    html: eventReportHtml(organizationName, events, heading, { todayIso: today, note: String(args.note || "").trim(), attachmentName: attachment.filename, rangeLabel }),
    attachments: [{ filename: attachment.filename, content: attachment.content }],
    payload: { eventCount: events.length, horizonDays, types, states, marketplaces, attachment: attachment.filename },
  });
  return { sent: delivery.sent, recipients, eventCount: events.length, attachment: attachment.filename, from: today, through };
}

async function updateAutomationSettingsOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "admin.settings");
  const recipients = cleanEmails(args.reportRecipients);
  const stateFilters = [...new Set((Array.isArray(args.stateFilters) ? args.stateFilters : []).map((entry) => String(entry).trim()).filter(Boolean))].slice(0, 40);
  if (!recipients.length) throw new Error("Add at least one valid monthly-report recipient.");
  const reminderDaysBefore = Math.max(1, Math.min(180, Math.round(Number(args.reminderDaysBefore || 30))));
  const monthlyReportDay = Math.max(1, Math.min(28, Math.round(Number(args.monthlyReportDay || 1))));
  const { data, error } = await service.from("event_automation_settings").upsert({
    organization_id: workspace.organization.id, monthly_report_enabled: args.monthlyReportEnabled !== false, monthly_report_day: monthlyReportDay,
    reminder_enabled: args.reminderEnabled !== false, reminder_days_before: reminderDaysBefore, research_enabled: args.researchEnabled !== false,
    state_filters: stateFilters.length ? stateFilters : ["Pan-India", "All Indian states and union territories"], report_recipients: recipients,
    timezone: String(args.timezone || "Asia/Kolkata").trim() || "Asia/Kolkata", updated_by_member_id: workspace.member.id, updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id" }).select("*").single();
  if (error || !data) throw new Error(error?.message || "Could not save event automation settings.");
  await service.from("audit_logs").insert({ organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email, action: "admin.event_automation.updated", resource_type: "event_automation_settings", resource_id: data.id, metadata: { monthlyReportDay, reminderDaysBefore, recipients: recipients.length, stateFilters } });
  return data;
}

async function runEventAutomationOperation(request: Request) {
  assertInternal(request);
  const { data: settingsRows, error } = await service.from("event_automation_settings").select("*,organizations(name)");
  if (error) throw new Error(error.message);
  const results: JsonRecord[] = [];
  for (const settings of settingsRows || []) {
    const orgId = String(settings.organization_id);
    const timezone = String(settings.timezone || "Asia/Kolkata");
    const today = localDateParts(timezone);
    const recipients = cleanEmails(settings.report_recipients);
    let monthlySent = false;
    let remindersSent = 0;
    let researchError = "";
    let monthlyError = "";
    const reminderErrors: string[] = [];
    try {
      if (settings.research_enabled && today.day === 1) {
        try { await researchEventsForOrganization(orgId, "scheduled"); }
        catch (error) { researchError = errorMessage(error); }
      }
      const through = new Date(Date.parse(`${today.iso}T00:00:00Z`) + 365 * 86400_000).toISOString().slice(0, 10);
      const { data: upcoming } = await service.from("marketing_events").select("*").eq("organization_id", orgId).eq("status", "active").gte("start_date", today.iso).lte("start_date", through).order("start_date");
      const organizationName = String((settings.organizations as unknown as JsonRecord | null)?.name || "Youthnic");
      if (settings.monthly_report_enabled && today.day === Number(settings.monthly_report_day || 1)) {
        try {
          const monthlyEvents = (upcoming || []) as JsonRecord[];
          const attachment = await buildEventWorkbook(organizationName, monthlyEvents, today.iso);
          const delivery = await sendTrackedEventEmail({ orgId, kind: "monthly_report", key: `${today.year}-${String(today.month).padStart(2, "0")}`, recipients, subject: `${organizationName} · monthly event report · ${today.iso}`, html: eventReportHtml(organizationName, monthlyEvents, "Monthly event report", { todayIso: today.iso, attachmentName: attachment.filename, rangeLabel: `${monthlyEvents.length} event${monthlyEvents.length === 1 ? "" : "s"} · ${today.iso} → ${through}` }), attachments: [{ filename: attachment.filename, content: attachment.content }], payload: { eventCount: monthlyEvents.length, timezone, attachment: attachment.filename } });
          monthlySent = delivery.sent;
          if (delivery.sent) await service.from("event_automation_settings").update({ last_monthly_report_at: new Date().toISOString() }).eq("id", settings.id);
        } catch (error) { monthlyError = errorMessage(error); }
      }
      if (settings.reminder_enabled) {
        const reminderDate = new Date(Date.parse(`${today.iso}T00:00:00Z`) + Number(settings.reminder_days_before || 30) * 86400_000).toISOString().slice(0, 10);
        for (const event of (upcoming || []).filter((entry) => entry.start_date === reminderDate)) {
          const leadDays = Number(settings.reminder_days_before || 30);
          const subject = `${leadDays}-day planning reminder · ${event.name}`;
          const attachment = await buildEventWorkbook(organizationName, [event as JsonRecord], today.iso);
          const html = eventReportHtml(organizationName, [event as JsonRecord], `${leadDays}-day event reminder`, { todayIso: today.iso, attachmentName: attachment.filename, rangeLabel: `${event.name} · ${event.start_date}` });
          try {
            const delivery = await sendTrackedEventEmail({ orgId, eventId: event.id, kind: "event_reminder", key: `${event.id}:${today.iso}:${settings.reminder_days_before}`, recipients, subject, html, attachments: [{ filename: attachment.filename, content: attachment.content }], payload: { eventDate: event.start_date, reminderDaysBefore: leadDays, attachment: attachment.filename } });
            if (delivery.sent) remindersSent++;
          } catch (error) { reminderErrors.push(`${event.name}: ${errorMessage(error)}`); }
        }
      }
      await service.from("event_automation_settings").update({ last_automation_at: new Date().toISOString() }).eq("id", settings.id);
      results.push({ orgId, monthlySent, remindersSent, researchError, monthlyError, reminderErrors });
    } catch (automationError) {
      results.push({ orgId, error: errorMessage(automationError), monthlySent, remindersSent, researchError, monthlyError, reminderErrors });
    }
  }
  return { processed: results.length, results };
}

async function openAiAdminPages(path: string, params: URLSearchParams) {
  const adminKey = Deno.env.get("OPENAI_ADMIN_KEY")?.trim();
  if (!adminKey) throw new Error("OPENAI_ADMIN_KEY is not configured in Supabase Edge Function secrets.");
  const buckets: JsonRecord[] = [];
  let page = "";
  do {
    const query = new URLSearchParams(params);
    if (page) query.set("page", page);
    const response = await fetch(`https://api.openai.com/v1/organization/${path}?${query}`, {
      headers: { Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json" },
    });
    const data = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) throw new Error(String((data.error as JsonRecord | undefined)?.message || `OpenAI Admin API failed (${response.status}).`));
    if (Array.isArray(data.data)) buckets.push(...data.data as JsonRecord[]);
    page = data.has_more ? String(data.next_page || "") : "";
  } while (page);
  return buckets;
}

async function syncOpenAiUsageOperation(request: Request, args: JsonRecord) {
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const workerSecret = Deno.env.get("CATALOG_WORKER_SECRET")?.trim();
  const internal = bearer === SERVICE_ROLE_KEY || Boolean(workerSecret && bearer === workerSecret);
  let organizationIds: string[] = [];
  if (internal) {
    const { data: organizations, error } = await service.from("organizations").select("id");
    if (error) throw new Error(error.message);
    organizationIds = (organizations || []).map((organization) => String(organization.id));
  } else {
    const { workspace } = await workspaceFor(request, "admin.settings");
    organizationIds = [workspace.organization.id];
  }
  if (!Deno.env.get("OPENAI_ADMIN_KEY")?.trim()) {
    if (internal) return { configured: false, syncedOrganizations: 0, message: "OPENAI_ADMIN_KEY is not configured." };
    throw new Error("OPENAI_ADMIN_KEY is not configured in Supabase Edge Function secrets.");
  }
  const days = Math.max(1, Math.min(31, Math.round(Number(args.days || 31))));
  const start = Math.floor((Date.now() - (days - 1) * 86400_000) / 1000);
  const end = Math.floor((Date.now() + 86400_000) / 1000);
  const projectId = Deno.env.get("OPENAI_PROJECT_ID")?.trim() || "";
  const usageParams = new URLSearchParams({ start_time: String(start), end_time: String(end), bucket_width: "1d", limit: String(days) });
  ["model", "size", "source", "project_id"].forEach((field) => usageParams.append("group_by", field));
  if (projectId) usageParams.append("project_ids", projectId);
  const costParams = new URLSearchParams({ start_time: String(start), end_time: String(end), bucket_width: "1d", limit: String(days) });
  ["line_item", "project_id"].forEach((field) => costParams.append("group_by", field));
  if (projectId) costParams.append("project_ids", projectId);
  const [usageBuckets, costBuckets] = await Promise.all([
    openAiAdminPages("usage/images", usageParams), openAiAdminPages("costs", costParams),
  ]);
  const snapshots: JsonRecord[] = [];
  for (const bucket of usageBuckets) {
    const usageDate = new Date(Number(bucket.start_time || 0) * 1000).toISOString().slice(0, 10);
    for (const result of (Array.isArray(bucket.results) ? bucket.results as JsonRecord[] : [])) {
      const model = String(result.model || "unknown");
      const imageSize = String(result.size || "unknown");
      const source = String(result.source || "unknown");
      const openaiProjectId = String(result.project_id || "");
      snapshots.push({ usage_date: usageDate, dimension_key: `usage:${model}:${imageSize}:${source}:${openaiProjectId}`, model, image_size: imageSize, source, openai_project_id: openaiProjectId, image_count: Number(result.images || 0), request_count: Number(result.num_model_requests || 0), actual_cost_usd: 0, currency: "usd", usage_payload: result, cost_payload: {}, synced_at: new Date().toISOString() });
    }
  }
  for (const bucket of costBuckets) {
    const usageDate = new Date(Number(bucket.start_time || 0) * 1000).toISOString().slice(0, 10);
    for (const result of (Array.isArray(bucket.results) ? bucket.results as JsonRecord[] : [])) {
      const amount = result.amount && typeof result.amount === "object" ? result.amount as JsonRecord : {};
      const lineItem = String(result.line_item || "all");
      const openaiProjectId = String(result.project_id || "");
      snapshots.push({ usage_date: usageDate, dimension_key: `cost:${lineItem}:${openaiProjectId}`, model: "billing", image_size: "n/a", source: lineItem, openai_project_id: openaiProjectId, image_count: 0, request_count: 0, actual_cost_usd: Number(amount.value || 0), currency: String(amount.currency || "usd"), usage_payload: {}, cost_payload: result, synced_at: new Date().toISOString() });
    }
  }
  for (const orgId of organizationIds) {
    if (snapshots.length) {
      const { error } = await service.from("openai_usage_daily").upsert(snapshots.map((snapshot) => ({ ...snapshot, organization_id: orgId })), { onConflict: "organization_id,usage_date,dimension_key" });
      if (error) throw new Error(error.message);
    }
    await service.from("event_automation_settings").update({ last_usage_sync_at: new Date().toISOString() }).eq("organization_id", orgId);
  }
  return {
    configured: true, syncedOrganizations: organizationIds.length, rows: snapshots.length,
    images: snapshots.reduce((total, row) => total + Number(row.image_count || 0), 0),
    requests: snapshots.reduce((total, row) => total + Number(row.request_count || 0), 0),
    costUsd: snapshots.reduce((total, row) => total + Number(row.actual_cost_usd || 0), 0),
  };
}

async function importMigrationArchiveOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request);
  if (!workspace.isAdmin) throw new Error("Only an administrator can import the migration archive.");
  const documents = Array.isArray(args.documents) ? args.documents as JsonRecord[] : [];
  if (!documents.length || documents.length > 25) throw new Error("Import batches must contain between 1 and 25 documents.");
  const rows = documents.map((document) => ({
    source_system: "convex",
    source_table: String(document.table || ""),
    source_id: String(document.id || ""),
    payload: document.payload || {},
  }));
  if (rows.some((row) => !row.source_table || !row.source_id || row.source_table.startsWith("auth"))) {
    throw new Error("The archive batch contains a forbidden or invalid source table.");
  }
  const { error } = await service.from("app_migration_archive").upsert(rows, { onConflict: "source_system,source_table,source_id" });
  if (error) throw new Error(error.message);
  return { imported: rows.length };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const body = await request.json().catch(() => ({})) as JsonRecord;
    const operation = String(body.operation || "");
    const args = (body.args && typeof body.args === "object" ? body.args : {}) as JsonRecord;
    const handlers: Record<string, () => Promise<unknown>> = {
      "studio.analyze": () => analyze(request, args),
      "studio.queue": () => queueGeneration(request, args),
      "jobs.cancel": () => cancelJob(request, args),
      "jobs.regenerate": () => regeneratePose(request, args),
      "jobs.regenerateSession": () => regenerateSession(request, args),
      "jobs.remove": () => removeJob(request, args),
      "jobs.downloadAsset": () => downloadGeneratedAsset(request, args),
      "jobs.downloadAssets": () => downloadGeneratedAssets(request, args),
      "worker": () => processWorker(request, args),
      "admin.overview": () => adminOverview(request),
      "admin.createUser": () => createUserOperation(request, args),
      "admin.updateMember": () => updateMemberOperation(request, args),
      "admin.deleteMember": () => deleteMemberOperation(request, args),
      "admin.updateRolePermissions": () => updateRolePermissionsOperation(request, args),
      "admin.updateAutomationSettings": () => updateAutomationSettingsOperation(request, args),
      "profile.update": () => updateOwnProfileOperation(request, args),
      "usage.sync": () => syncOpenAiUsageOperation(request, args),
      "files.saveReference": () => saveReferenceOperation(request, args),
      "catalog.create": () => createCatalogOperation(request, args),
      "catalog.bulkAddVariants": () => bulkAddVariantsOperation(request, args),
      "catalog.setVariantReferences": () => setVariantReferencesOperation(request, args),
      "catalog.removeVariant": () => removeVariantOperation(request, args),
      "catalog.addStyleReference": () => addCatalogStyleReferenceOperation(request, args),
      "catalog.removeStyleReference": () => removeCatalogStyleReferenceOperation(request, args),
      "catalog.schedule": () => scheduleCatalogOperation(request, args),
      "catalog.cancelSchedule": () => cancelScheduledCatalogOperation(request, args),
      "catalog.retryVariant": () => retryVariantOperation(request, args),
      "catalog.preflight": () => processCatalogPreflight(request, args),
      "catalog.process": () => processCatalog(request, args),
      "events.create": () => createEventOperation(request, args),
      "events.seed": () => seedEventsOperation(request),
      "events.research": () => runEventResearchOperation(request),
      "events.digest": () => sendDigestOperation(request, args),
      "events.automation": () => runEventAutomationOperation(request),
      "events.sendEmail": () => sendDigestOperation(request, args),
      "migration.archive": () => importMigrationArchiveOperation(request, args),
    };
    const handler = handlers[operation];
    if (!handler) return json({ error: `Unknown operation: ${operation}` }, 404);
    return json({ data: await handler() });
  } catch (error) {
    console.error("app-api request failed", errorMessage(error));
    return json({ error: errorMessage(error) }, 400);
  }
});
