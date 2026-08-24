import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import * as ExcelJS from "https://esm.sh/exceljs@4.4.0";
import { deleteFirebaseObject, downloadFirebaseObject, uploadFirebaseObject, createFirebaseUser, updateFirebaseUser, deleteFirebaseUser } from "./firebase-admin.ts";
import {
  ANALYSIS_VERSION,
  CONSISTENCY_RULES,
  assertSareeGenerationReady,
  buildCombinedAnalysisPrompt,
  normalizeAnalysis,
  normalizeStylingPlan,
  parseJsonResponse,
  sareeAnalysisIssues,
  smallHash,
  type JsonRecord,
  type StudioPose,
  type StylingPlanProfile,
} from "./profiles.ts";
import { appendRejectedAttemptHistory, buildPoseQaPrompt, parseQaResponse, qaStorageDisposition, unavailableQaResult } from "./qa.ts";
import { composeGenerationPrompt } from "./lib/generationPrompt.ts";
import {
  MAX_IMAGE_REFERENCES,
  PRODUCT_REFERENCE_ROLES,
  canUsePoseOneAnchor,
  canonicalReferences,
  isSareeReferenceSet,
  missingRequiredReferenceLabels,
  roleLabel,
  selectReferences,
} from "./lib/referencePolicy.ts";
export { composeGenerationPrompt };
import {
  assignCatalogWorkItem,
  addCatalogWorkItemComment,
  bulkGenerateCatalogWorkItems,
  createFromPlanningRequests,
  getCatalogWorkflowDetail,
  importGoogleSheet,
  importGoogleSheetDryRun,
  markListingDone,
  markListingStarted,
  reconcileExistingGenerations,
  reviewCatalogQc,
  reviewCatalogPose,
  updateCatalogWorkItem,
} from "./catalogProduction.ts";
import { isoWeekday, previousBusinessDate } from "./lib/catalogHandoffCalendar.ts";
import { selectCatalogRecipients } from "./lib/catalogRecipientSelection.ts";

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PUBLISHABLE_KEY = Deno.env.get("SB_PUBLISHABLE_KEY")?.trim() || Deno.env.get("SUPABASE_ANON_KEY")?.trim() || requiredEnv("SUPABASE_ANON_KEY");
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/app-api`;
const OPENAI_MODEL = "gpt-image-2";
const MAX_REFERENCES = MAX_IMAGE_REFERENCES;
const MAX_GENERATION_ATTEMPTS = 3;
const QA_VERSION = "saree-qa-v14-listing-grade";
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

const CATALOG_ASSET_BUCKET = "catalog-assets";
const CATALOG_ASSET_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
type CatalogStorageBackend = "firebase" | "supabase" | "external";

function configuredCatalogStorageBackend(): CatalogStorageBackend {
  const configured = String(Deno.env.get("CATALOG_ASSET_STORAGE_BACKEND") || "supabase").trim().toLowerCase();
  if (configured === "firebase" || configured === "external") return configured;
  return "supabase";
}

function supabaseCatalogPath(orgId: string, requestedPath: string) {
  const normalized = requestedPath.replace(/^\/+/, "");
  const legacyPrefix = `organizations/${orgId}/`;
  const path = normalized.startsWith(legacyPrefix) ? `${orgId}/${normalized.slice(legacyPrefix.length)}` : normalized;
  if (!path.startsWith(`${orgId}/`) || path.includes("../")) throw new Error("Catalog Storage path is outside the organization prefix.");
  return path;
}

async function signCatalogObject(orgId: string, storagePath: string, storageBackend: unknown, fallbackUrl = "") {
  if (String(storageBackend || "firebase") !== "supabase" || !storagePath) return fallbackUrl;
  const tenantPath = supabaseCatalogPath(orgId, storagePath);
  const { data, error } = await service.storage.from(CATALOG_ASSET_BUCKET).createSignedUrl(tenantPath, CATALOG_ASSET_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`Could not sign catalog asset: ${error?.message || "no signed URL returned"}`);
  return data.signedUrl;
}

async function uploadCatalogObject(args: { orgId: string; storagePath: string; blob: Blob; mimeType: string }) {
  const backend = configuredCatalogStorageBackend();
  if (backend === "firebase") {
    const stored = await uploadFirebaseObject({ storagePath: args.storagePath, blob: args.blob, mimeType: args.mimeType });
    return { ...stored, storageBackend: "firebase" as const };
  }
  if (backend === "external") throw new Error("External catalog asset storage is read-only.");
  const storagePath = supabaseCatalogPath(args.orgId, args.storagePath);
  const bucket = service.storage.from(CATALOG_ASSET_BUCKET);
  const { error } = await bucket.upload(storagePath, args.blob, {
    contentType: args.mimeType || "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  try {
    const downloadUrl = await signCatalogObject(args.orgId, storagePath, "supabase");
    return { downloadUrl, storagePath, storageBackend: "supabase" as const };
  } catch (error) {
    await bucket.remove([storagePath]);
    throw error;
  }
}

async function downloadCatalogObject(orgId: string, storagePath: string, storageBackend: unknown, fallbackUrl = "") {
  const backend = String(storageBackend || "firebase") as CatalogStorageBackend;
  if (backend === "supabase") {
    const tenantPath = supabaseCatalogPath(orgId, storagePath);
    const { data, error } = await service.storage.from(CATALOG_ASSET_BUCKET).download(tenantPath);
    if (error || !data) throw new Error(`Supabase Storage download failed: ${error?.message || "object unavailable"}`);
    return data;
  }
  if (/^https:\/\//i.test(storagePath)) {
    const response = await fetch(storagePath);
    if (!response.ok) throw new Error(`Asset download failed (${response.status}).`);
    return response.blob();
  }
  if (/^http:\/\//i.test(storagePath)) throw new Error("Catalog asset URLs must use HTTPS.");
  if (backend === "external") {
    if (!fallbackUrl) throw new Error("External asset URL is unavailable.");
    const response = await fetch(fallbackUrl);
    if (!response.ok) throw new Error(`External asset download failed (${response.status}).`);
    return response.blob();
  }
  assertCatalogReferenceOwnership(orgId, { role: "stored_asset", storagePath, storageBackend: "firebase", hash: "", filename: "stored-asset", mimeType: "", size: 0 });
  return downloadFirebaseObject(storagePath);
}

async function deleteCatalogObject(orgId: string, storagePath: string, storageBackend: unknown) {
  if (!storagePath) return;
  if (String(storageBackend || "firebase") === "supabase") {
    const tenantPath = supabaseCatalogPath(orgId, storagePath);
    const { error } = await service.storage.from(CATALOG_ASSET_BUCKET).remove([tenantPath]);
    if (error) throw new Error(`Supabase Storage deletion failed: ${error.message}`);
    return;
  }
  if (String(storageBackend || "firebase") === "external" || /^https:\/\//i.test(storagePath)) return;
  if (/^http:\/\//i.test(storagePath)) throw new Error("Catalog asset URLs must use HTTPS.");
  assertCatalogReferenceOwnership(orgId, { role: "stored_asset", storagePath, storageBackend: "firebase", hash: "", filename: "stored-asset", mimeType: "", size: 0 });
  await deleteFirebaseObject(storagePath);
}

function assertCatalogReferenceOwnership(orgId: string, reference: ReferenceInput) {
  const backend = String(reference.storageBackend || "firebase");
  const storagePath = String(reference.storagePath || "");
  const downloadUrl = String(reference.downloadUrl || "");
  if (backend === "supabase") {
    if (!storagePath) throw new Error("A Supabase catalog reference must include its private storage path.");
    supabaseCatalogPath(orgId, storagePath);
    return;
  }
  if (backend === "firebase" && storagePath) {
    const normalized = storagePath.replace(/^\/+/, "");
    if (!normalized.includes(`organizations/${orgId}/`) && !normalized.startsWith(`${orgId}/`)) {
      throw new Error("The Firebase reference path is outside the current organization.");
    }
    return;
  }
  if (!/^https:\/\//i.test(downloadUrl)) throw new Error("Reference links must use HTTPS.");
}

async function recordAiRun(args: JsonRecord) {
  const { error } = await service.from("ai_runs").insert(args);
  if (error) console.error(`Failed to record ai_run telemetry: ${error.message}`);
}

type ReferenceInput = {
  id?: string;
  role: string;
  downloadUrl?: string;
  storagePath?: string;
  storageBackend?: CatalogStorageBackend;
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

const GEMINI_PRICING: Record<string, { input: number; output: number; version: string; source: string }> = {
  "gemini-3.6-flash": { input: 0.15, output: 0.60, version: "2024-08", source: "google_standard_flash" },
  "gemini-3.1-pro-preview": { input: 1.25, output: 5.00, version: "2024-08", source: "google_standard_pro" },
};

type GeminiPurpose = "product_truth" | "shoot_planning" | "qa" | "qa_escalation";

type GeminiPolicy = {
  purpose: GeminiPurpose;
  model: string;
  thinkingLevel: "high" | "medium";
};

function resolveGeminiPolicy(args: { purpose: GeminiPurpose; garmentFamily?: string; uncertainty?: boolean; referenceCount?: number; }): GeminiPolicy {
  const PT_MODEL = Deno.env.get("GEMINI_PRODUCT_TRUTH_MODEL")?.trim() || "gemini-3.1-pro-preview";
  const PT_THINKING = (Deno.env.get("GEMINI_PRODUCT_TRUTH_THINKING_LEVEL")?.trim() as "high" | "medium") || "high";

  const SIMPLE_MODEL = Deno.env.get("GEMINI_SIMPLE_PLANNER_MODEL")?.trim() || "gemini-3.6-flash";
  const SIMPLE_THINKING = (Deno.env.get("GEMINI_SIMPLE_PLANNER_THINKING_LEVEL")?.trim() as "high" | "medium") || "high";

  const COMPLEX_MODEL = Deno.env.get("GEMINI_COMPLEX_PLANNER_MODEL")?.trim() || "gemini-3.1-pro-preview";
  const COMPLEX_THINKING = (Deno.env.get("GEMINI_COMPLEX_PLANNER_THINKING_LEVEL")?.trim() as "high" | "medium") || "high";

  const QA_MODEL = Deno.env.get("GEMINI_QA_MODEL")?.trim() || "gemini-3.6-flash";
  const QA_THINKING = (Deno.env.get("GEMINI_QA_THINKING_LEVEL")?.trim() as "high" | "medium") || "medium";

  const QA_ESCALATION_MODEL = Deno.env.get("GEMINI_QA_ESCALATION_MODEL")?.trim() || "gemini-3.1-pro-preview";
  const QA_ESCALATION_THINKING = (Deno.env.get("GEMINI_QA_ESCALATION_THINKING_LEVEL")?.trim() as "high" | "medium") || "high";

  if (args.purpose === "product_truth") return { purpose: args.purpose, model: PT_MODEL, thinkingLevel: PT_THINKING };
  if (args.purpose === "shoot_planning") {
    const isComplex = ["saree", "lehenga", "suit", "multi-piece"].some((fam) => args.garmentFamily?.toLowerCase().includes(fam)) || args.uncertainty || (args.referenceCount && args.referenceCount > 3);
    return isComplex ? { purpose: args.purpose, model: COMPLEX_MODEL, thinkingLevel: COMPLEX_THINKING } : { purpose: args.purpose, model: SIMPLE_MODEL, thinkingLevel: SIMPLE_THINKING };
  }
  if (args.purpose === "qa") {
    const isComplex = ["saree", "lehenga", "suit", "multi-piece"].some((family) => args.garmentFamily?.toLowerCase().includes(family));
    return isComplex
      ? { purpose: args.purpose, model: QA_ESCALATION_MODEL, thinkingLevel: QA_ESCALATION_THINKING }
      : { purpose: args.purpose, model: QA_MODEL, thinkingLevel: QA_THINKING };
  }
  if (args.purpose === "qa_escalation") return { purpose: args.purpose, model: QA_ESCALATION_MODEL, thinkingLevel: QA_ESCALATION_THINKING };

  return { purpose: args.purpose, model: "gemini-3.6-flash", thinkingLevel: "high" };
}

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

function assertSupabaseResults(
  results: Array<{ error?: { message?: string } | null }>,
  context: string,
) {
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`${context}: ${failed.error.message || "database operation failed"}`);
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

function localDateTimeParts(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    iso: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
    year: Number(value.year), month: Number(value.month), day: Number(value.day),
    hour: Number(value.hour), minute: Number(value.minute),
  };
}

async function sendEmail(args: { recipients: string[]; subject: string; html: string; attachments?: Array<{ filename: string; content: string }>; idempotencyKey?: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const from = Deno.env.get("RESEND_FROM")?.trim();
  if (!apiKey || !from) throw new Error("Email delivery is not configured. Add RESEND_API_KEY and RESEND_FROM to Supabase Edge Function secrets.");
  if (!args.recipients.length) throw new Error("Add at least one valid report recipient in Administration.");
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (args.idempotencyKey) headers["Idempotency-Key"] = args.idempotencyKey;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
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

async function loadReference(reference: ReferenceInput, orgId: string): Promise<LoadedReference> {
  let blob: Blob | null = null;
  assertCatalogReferenceOwnership(orgId, reference);
  if (reference.storagePath) blob = await downloadCatalogObject(orgId, reference.storagePath, reference.storageBackend, reference.downloadUrl);
  if (!blob && reference.downloadUrl) {
    const response = await fetch(reference.downloadUrl);
    if (response.ok) blob = await response.blob();
  }
  if (!blob) throw new Error(`Could not load ${reference.filename} from catalog asset storage.`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = reference.mimeType || blob.type || "image/jpeg";
  return { ...reference, mimeType, blob: new Blob([bytes], { type: mimeType }), base64: bytesToBase64(bytes) };
}

function assertRequiredProductReferences(references: ReferenceInput[], garmentFamily = "") {
  const missing = missingRequiredReferenceLabels(references, garmentFamily);
  if (missing.length) throw new Error(`Required product references are missing: ${missing.join(", ")}.`);
}

async function loadAvailableReferences(references: ReferenceInput[], orgId: string): Promise<LoadedReference[]> {
  const loaded: LoadedReference[] = [];
  const requiredRoles = isSareeReferenceSet(references)
    ? new Set(["saree_front_drape", "saree_back_drape", "saree_pallu_spread", "saree_body_detail"])
    : new Set(["front", "back"]);
  for (const reference of references) {
    try {
      loaded.push(await loadReference(reference, orgId));
    } catch (error) {
      if (requiredRoles.has(reference.role)) {
        throw new Error(
          `Could not load required ${reference.role} reference ${reference.filename}: ${errorMessage(error)}`,
        );
      }
      console.warn(
        `Skipping unavailable optional ${reference.role} reference ${reference.filename}: ${errorMessage(error)}`,
      );
    }
  }
  assertRequiredProductReferences(loaded);
  return loaded;
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
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
async function geminiJson(policy: GeminiPolicy, parts: JsonRecord[], attempt = 1): Promise<{ raw: JsonRecord; text: string; json: JsonRecord; policy: GeminiPolicy }> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(policy.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": requiredEnv("GEMINI_API_KEY") },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: policy.thinkingLevel },
      },
      safetySettings: GEMINI_SAFETY_SETTINGS,
    }),
  });
  const data = await response.json().catch(() => ({})) as JsonRecord;
  const retryableStatus = !response.ok && [408, 429, 500, 502, 503, 504].includes(response.status);
  const text = response.ok ? extractGeminiText(data) : "";
  if ((retryableStatus || (response.ok && !text)) && attempt < 3) {
    await sleep(500 * attempt);
    return geminiJson(policy, parts, attempt + 1);
  }
  if (!response.ok) throw new Error(String((data.error as JsonRecord | undefined)?.message || `Gemini failed (${response.status}).`));
  if (!text) {
    const reason = geminiBlockReason(data);
    throw new Error(`Gemini returned no structured response${reason ? ` (${reason})` : ""}.`);
  }
  return { raw: data, text, json: parseJsonResponse(text), policy };
}

async function analyze(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const references = canonicalReferences((Array.isArray(args.references) ? args.references : []) as ReferenceInput[]);
  const orgId = workspace.organization.id;
  references.forEach((reference) => assertCatalogReferenceOwnership(orgId, reference));
  assertRequiredProductReferences(references, String(args.category || ""));
  const pHash = productHash(args);
  const rHash = referenceHash(references);
  const fingerprint = smallHash(`${ANALYSIS_VERSION}|${pHash}|${rHash}`);
  // House preference is an analysis input, so it belongs in the cache identity:
  // otherwise a cached plan keeps proposing the styling a stylist corrected, for
  // up to the cache's thirty days. It stays out of the fingerprint on purpose -
  // that is queue-time validation of the references, and saving a plan writes a
  // decision, which would change the fingerprint and reject its own session.
  const housePreferences = await stylingPreferenceBrief(orgId, String(args.category || "ethnic/fusion"));
  const policy = resolveGeminiPolicy({ purpose: "product_truth", garmentFamily: String(args.category || "") });
  const cacheKey = `${pHash}:${rHash}:${ANALYSIS_VERSION}:${policy.model}:${smallHash(housePreferences)}`;
  let cacheHit = false;
  let normalized: ReturnType<typeof normalizeAnalysis> | null = null;
  const forceRefresh = args.forceRefresh === true;
  if (!forceRefresh) {
    const { data: cached, error: cachedError } = await service.from("analysis_cache").select("payload").eq("org_key", orgId).eq("cache_kind", "studio_product_analysis").eq("cache_key", cacheKey).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cachedError) throw new Error(cachedError.message);
    if (cached?.payload) {
      normalized = normalizeAnalysis(cached.payload as JsonRecord, String(args.category || "ethnic/fusion"));
      cacheHit = true;
    }
  }
  const started = Date.now();
  if (!normalized) {
    const loaded = await loadAvailableReferences(references, orgId);
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
      sceneDirection: String(args.sceneDirection || ""), referenceManifest: manifest, housePreferences,
    }) });

    const result = await geminiJson(policy, parts);
    normalized = normalizeAnalysis(result.json, String(args.category || "ethnic/fusion"));
    await service.from("analysis_cache").upsert({
      organization_id: orgId, org_key: orgId, cache_kind: "studio_product_analysis", cache_key: cacheKey,
      sku_name: String(args.skuName || ""), product_category: String(args.category || ""), payload: normalized,
      expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "org_key,cache_kind,cache_key" });
    const usage = result.raw.usageMetadata as any || {};
    const inTok = Number(usage.promptTokenCount || 0);
    const outTok = Number(usage.candidatesTokenCount || 0);
    const pricing = GEMINI_PRICING[policy.model] || GEMINI_PRICING["gemini-3.6-flash"];
    const estCost = (inTok * pricing.input + outTok * pricing.output) / 1000000;
    
    await recordAiRun({
      organization_id: orgId, job_id: "", run_kind: "product_reference_analysis", model: policy.model, provider: "gemini",
      purpose: policy.purpose, thinking_level: policy.thinkingLevel,
      input_fingerprint: fingerprint, input_summary: { referenceCount: references.length, roles: references.map((reference) => reference.role), policy },
      output_json: normalized, status: "completed", latency_ms: Date.now() - started, cost_usd: estCost, cost_source: `estimated_public_rates_${pricing.version}`,
      input_tokens: inTok, input_text_tokens: inTok, input_image_tokens: 0, output_tokens: outTok,
      total_tokens: Number(usage.totalTokenCount || 0), thoughts_token_count: Number(usage.thoughtsTokenCount || 0),
      usage_payload: { geminiAnalysis: usage },
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
    asset_role: reference.role, storage_backend: reference.storageBackend || "firebase", metadata: { hash: reference.hash, filename: reference.filename, mimeType: reference.mimeType, size: reference.size, storageBackend: reference.storageBackend || "firebase" },
  }));
  const { data: assets, error: assetError } = await service.from("planning_assets").insert(assetRows).select("id,asset_role,image_url,storage_path,storage_backend,metadata");
  if (assetError) console.error(assetError.message);
  const sessionId = `session_${crypto.randomUUID()}`;
  const sessionData = {
    skuId: String(args.skuId || requestCode), skuName: String(args.skuName || "Untitled studio product"),
    productDetails: String(args.productDetails || ""), category: String(args.category || "ethnic/fusion"),
    referenceIds: (assets || []).map((asset) => asset.id), references: (assets || []).map((asset) => ({
      id: asset.id, role: asset.asset_role, downloadUrl: asset.image_url, storagePath: asset.storage_path, storageBackend: asset.storage_backend as CatalogStorageBackend,
      hash: String((asset.metadata as JsonRecord)?.hash || ""), filename: String((asset.metadata as JsonRecord)?.filename || `${asset.asset_role}.jpg`),
      mimeType: String((asset.metadata as JsonRecord)?.mimeType || "image/jpeg"), size: Number((asset.metadata as JsonRecord)?.size || 0),
    })), productIdentity: normalized.productIdentity, creativeDirection: normalized.creativeDirection,
    modelIdentity: normalized.modelIdentity, stylingPlan: normalized.stylingPlan, posePlan: normalized.posePlan, consistencyRules: CONSISTENCY_RULES,
    analysisModel: resolveGeminiPolicy({ purpose: "product_truth", garmentFamily: String(args.category || "") }).model, analysisVersion: ANALYSIS_VERSION,
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
  return ["moderation_blocked", "invalid_api_key", "image_generation_user_error", "same_defect_repeated"].includes(code) || [400, 401, 403, 404].includes(status);
}

async function validatePose(args: {
  generated: { base64: string; mimeType: string }; references: LoadedReference[];
  approved: LoadedReference[]; session: JsonRecord; pose: StudioPose & { poseNumber: number };
}) {
  const garmentFamily = String((args.session.productIdentity as JsonRecord | undefined)?.garmentFamily || "");
  const qaRefs = selectReferences(args.references, args.approved, args.pose.id, garmentFamily, MAX_REFERENCES);
  const styling = args.session.stylingPlan ? normalizeStylingPlan(args.session.stylingPlan) : null;
  const prompt = buildPoseQaPrompt({
    poseNumber: args.pose.poseNumber, poseType: args.pose.id, poseTitle: args.pose.title, poseDirection: args.pose,
    productIdentity: args.session.productIdentity, creativeDirection: args.session.creativeDirection,
    modelIdentity: args.session.modelIdentity, garmentFamily,
    consistencyRules: [
      ...((args.session.consistencyRules as string[]) || CONSISTENCY_RULES),
      ...(styling
        ? [`APPROVED STYLING PLAN - footwear: ${styling.footwear}; jewellery: ${styling.jewellery}; ornaments: ${styling.ornaments}; makeup: ${styling.makeup}; hair: ${styling.hair}.${styling.stylingNotes ? ` Stylist notes: ${styling.stylingNotes}` : ""}`]
        : []),
    ],
    hasApprovedAnchor: args.approved.length > 0,
    hasModelReference: qaRefs.some((reference) => reference.role === "model_identity"),
    referenceManifest: qaRefs.map((reference, index) => `IMAGE ${index + 1}: ${roleLabel(reference.role)}`),
  });
  const baseParts: JsonRecord[] = [
    { text: prompt },
    { text: "IMAGE A: NEWLY GENERATED POSE UNDER TEST" },
    { inlineData: { mimeType: args.generated.mimeType, data: args.generated.base64 } },
  ];
  qaRefs.forEach((reference) => {
    baseParts.push({ text: roleLabel(reference.role) });
    baseParts.push({ inlineData: { mimeType: reference.mimeType, data: reference.base64 } });
  });

  const addUsage = (total: Record<string, number>, raw: JsonRecord) => {
    const usage = (raw.usageMetadata || {}) as Record<string, number>;
    return {
      promptTokenCount: Number(total.promptTokenCount || 0) + Number(usage.promptTokenCount || 0),
      candidatesTokenCount: Number(total.candidatesTokenCount || 0) + Number(usage.candidatesTokenCount || 0),
      totalTokenCount: Number(total.totalTokenCount || 0) + Number(usage.totalTokenCount || 0),
      thoughtsTokenCount: Number(total.thoughtsTokenCount || 0) + Number(usage.thoughtsTokenCount || 0),
    };
  };
  const run = async (policy: GeminiPolicy, independent = false) => {
    const parts = independent
      ? [...baseParts, { text: "INDEPENDENT RECHECK: disregard prior numeric scores, re-inspect each critical region separately, and return newly reasoned evidence-based scores." }]
      : baseParts;
    const result = await geminiJson(policy, parts);
    return { result, qa: parseQaResponse(result.text, { garmentFamily }) };
  };

  const complex = ["saree", "lehenga", "suit", "multi-piece"].some((family) => garmentFamily.toLowerCase().includes(family));
  const initialPolicy = resolveGeminiPolicy({ purpose: "qa", garmentFamily });
  let { result, qa } = await run(initialPolicy);
  let usageMetadata = addUsage({}, result.raw);

  if (complex) {
    if (qa.requiresIndependentRecheck) {
      const independent = await run(resolveGeminiPolicy({ purpose: "qa_escalation", garmentFamily }), true);
      result = independent.result;
      qa = independent.qa;
      usageMetadata = addUsage(usageMetadata, result.raw);
    }
    return { ...qa, usageMetadata, policy: result.policy };
  }

  const hasSevereDefects = qa.reason.includes("Critical attributes far below");
  if (qa.automaticallyVerified || hasSevereDefects) {
    return { ...qa, usageMetadata, policy: result.policy };
  }

  const confirmation = await run(resolveGeminiPolicy({ purpose: "qa_escalation", garmentFamily }), qa.requiresIndependentRecheck);
  result = confirmation.result;
  qa = confirmation.qa;
  usageMetadata = addUsage(usageMetadata, result.raw);
  return { ...qa, usageMetadata, policy: result.policy };
}
async function kickWorker(jobId?: string) {
  return fetch(FUNCTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "worker", args: jobId ? { jobId } : {} }),
  });
}

async function kickNodeOrchestrator(sessionId?: string) {
  return fetch(FUNCTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "nodeWorker", args: sessionId ? { sessionId } : {} }),
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
  assertSareeGenerationReady({ ...sessionData, posePlan: enabled });
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
  
  if (session.planning_request_id) {
    await service.from("catalog_work_items").update({
      generation_job_id: jobId,
      catalog_session_id: sessionId,
      generation_status: "queued",
      generation_started_at: now
    }).eq("planning_request_id", session.planning_request_id);
  }

  const poseRows = enabled.map((pose, index) => ({
    session_id: sessionId, generation_id: `${jobId}:pose:${index + 1}`, pose_index: index + 1,
    title: pose.title, pose_type: pose.id, instructions: pose.prompt, status: "queued", attempt_count: 0,
    generation_data: { ...pose, poseNumber: index + 1, jobId },
  }));
  const { error: poseError } = await service.from("session_generations").insert(poseRows);
  if (poseError) console.error(poseError.message);
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
    service.from("catalog_work_items").update({
      generation_status: status,
      generation_completed_at: now,
      qc_status: "needs_review",
      listing_status: failed ? "not_required" : "pending",
    }).eq("planning_request_id", job.planning_request_id),
  ]);
  const { data: member, error: memberError } = await service.from("organization_members").select("id").eq("organization_id", job.org_id).eq("firebase_uid", job.user_id).maybeSingle();
  if (memberError) throw new Error(memberError.message);
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
    success_signals: { completedPoses: completed },
    failure_signals: {
      garmentFamily: String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || ""),
      failedPoses: failed,
      feedback: poses.filter((p) => p.status === "failed").map((p) => {
        const d = (p.generation_data || {}) as JsonRecord;
        return { poseTitle: String(p.title || ""), corrections: Array.isArray(d.corrections) ? d.corrections : [String(d.correction || "")].filter(Boolean) };
      }),
    },
    pose_titles: poses.map((pose) => String(pose.title || "")), prompt_fingerprint: String(session.analysis_fingerprint || ""),
    scene_summary: String((sessionData.creativeDirection as JsonRecord | undefined)?.backgroundStyle || ""),
    footwear: String((sessionData.productIdentity as JsonRecord | undefined)?.footwearDetails || ""),
    background_style: String((sessionData.creativeDirection as JsonRecord | undefined)?.backgroundStyle || ""),
    showcase_framing: "3:4", cost_source: "estimated_from_generation_attempts",
  });
  if (job.batch_id) {
    const batchId = String(job.batch_id);
    const garmentFamily = String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || "");
    const anchor = poses.find((pose) => Number(pose.pose_index) === 1 && pose.status === "completed" && canUsePoseOneAnchor(garmentFamily, pose.qa_status));
    if (anchor?.output_url) {
      // Merged in the database for the same reason as the styling plan: a stylist
      // approving a plan at this moment must not lose the anchor, and vice versa.
      const { error: anchorError } = await service.rpc("merge_catalog_memory", {
        p_batch_id: batchId,
        p_patch: { anchorOutputUrl: anchor.output_url, anchorStoragePath: anchor.storage_path, anchorStorageBackend: anchor.storage_backend || "firebase", anchorJobId: job.job_id, anchorQaStatus: anchor.qa_status, anchorGarmentFamily: garmentFamily },
        p_require_absent: null,
      });
      // Stamping the memory as current after a failed merge would claim an anchor
      // the batch does not have, and later colourways would drift from this set
      // with nothing recording why.
      if (anchorError) console.error("Could not record the catalog anchor frame", anchorError.message);
      else await service.from("planning_batches").update({ memory_updated_at: now }).eq("id", batchId);
    }
    const { data: catalogVariants, error: catalogVariantsError } = await service.from("planning_requests").select("generation_status").eq("batch_id", batchId);
    if (catalogVariantsError) console.error(catalogVariantsError.message);
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
  const { data: poses, error: posesError } = await service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index");
  if (posesError) console.error(posesError.message);
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
        job_data: { ...((job.job_data as JsonRecord) || {}), detailedStatus: `Pose ${pose.pose_index} QA failed. Moving to next pose.` },
      }).eq("job_id", job.job_id),
      service.from("planning_requests").update({ generation_status: "queued", error_message: message.slice(0, 1000), updated_at: now }).eq("id", job.planning_request_id),
    ]);
    scheduleBackground(kickWorker(String(job.job_id)));
    return;
  }
  if (remaining.length) {
    await service.from("session_generations").update({ status: "failed", qa_status: "failed", error: "Skipped because pose 1 is the identity anchor for the set and could not be produced.", updated_at: now }).eq("session_id", job.session_id).eq("status", "queued");
  }
  const { data: finalPoses, error: finalPosesError } = await service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index");
  if (finalPosesError) console.error(finalPosesError.message);
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
    const stored = await uploadCatalogObject({ orgId: String(args.job.org_id), storagePath, blob: args.generated.blob, mimeType: args.generated.mimeType });
    return {
      attempt: args.attempt, url: stored.downloadUrl, storagePath: stored.storagePath,
      storageBackend: stored.storageBackend,
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
      job_data: { ...((args.job.job_data as JsonRecord) || {}), detailedStatus: `Pose ${args.pose.pose_index} QA failed. Retrying...` },
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
    const { data: variants, error: variantsError } = await service.from("planning_requests").select("generation_status").eq("batch_id", batchId);
    if (variantsError) console.error(variantsError.message);
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

// --- GRAPH NODE HANDLERS ---
async function handleAiVisualAnalysisNode(node: JsonRecord, sessionId: string) {
  const inputs = node.inputs as JsonRecord;
  const references = inputs.references as ReferenceInput[];
  const { data: batch, error: batchError } = await service.from("planning_batches").select("*").eq("id", inputs.batchId).maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch) throw new Error("Catalog batch not found for visual analysis.");
  const loaded = await loadAvailableReferences(references, String(batch.organization_id));
  
  const manifest: Array<{ number: number; role: string }> = [];
  const parts: JsonRecord[] = [];
  loaded.forEach((reference, index) => {
    manifest.push({ number: index + 1, role: roleLabel(reference.role) });
    parts.push({ text: `IMAGE ${index + 1}: ${roleLabel(reference.role)}` }, { inlineData: { mimeType: reference.mimeType, data: reference.base64 } });
  });

  const { data: variant, error: variantError } = await service.from("planning_requests").select("*").eq("id", inputs.variantId).eq("batch_id", inputs.batchId).maybeSingle();
  if (variantError) throw new Error(variantError.message);
  if (!variant) throw new Error("Catalog SKU not found for visual analysis.");
  const settings = (batch?.generation_settings || {}) as JsonRecord;
  const category = String(settings.category || variant?.category || "ethnic/fusion");
  const orgId = String(batch?.organization_id || "");

  parts.push({ text: buildCombinedAnalysisPrompt({
    skuName: String(variant?.sku_name), productDetails: String(variant?.product_description || ""), category,
    modelDirection: String(settings.modelDirection || ""), sceneDirection: String(settings.sceneDirection || ""), referenceManifest: manifest,
    housePreferences: await stylingPreferenceBrief(orgId, category),
  }) });

  const policy = resolveGeminiPolicy({ purpose: "product_truth", garmentFamily: category });
  const result = await geminiJson(policy, parts);
  const normalized = normalizeAnalysis(result.json, category);
  
  return { analysisResult: normalized, usage: result.raw.usageMetadata };
}
async function handleProductTruthNode(node: JsonRecord, sessionId: string) {
  const { data: edges, error: edgesError } = await service.from("generation_flow_edges").select("source_node_id").eq("target_node_id", node.id);
  if (edgesError) console.error(edgesError.message);
  const sourceId = edges?.[0]?.source_node_id;
  const { data: sourceNode, error: sourceNodeError } = await service.from("generation_flow_nodes").select("outputs").eq("id", sourceId).maybeSingle();
  if (sourceNodeError) throw new Error(sourceNodeError.message);
  
  const analysisResult = (sourceNode?.outputs as JsonRecord)?.analysisResult as ReturnType<typeof normalizeAnalysis>;
  
  // Update session with product truth
  const { data: session, error: sessionError } = await service.from("catalog_sessions").select("session_data").eq("session_id", sessionId).single();
  if (sessionError) throw new Error(sessionError.message);
  const sessionData = (session?.session_data as JsonRecord) || {};
  sessionData.productIdentity = analysisResult?.productIdentity;
  await service.from("catalog_sessions").update({ session_data: sessionData }).eq("session_id", sessionId);

  return { productIdentity: analysisResult?.productIdentity };
}

async function handleMemoryAndPlanningNode(node: JsonRecord, sessionId: string) {
  const inputs = node.inputs as JsonRecord;
  const batchId = String(inputs.batchId);
  const variantId = String(inputs.variantId);
  
  // Find original analysis
  const { data: analysisNodes, error: analysisNodesError } = await service.from("generation_flow_nodes").select("outputs").eq("session_id", sessionId).eq("node_type", "ai_visual_analysis");
  if (analysisNodesError) console.error(analysisNodesError.message);
  const analysisResult = (analysisNodes?.[0]?.outputs as JsonRecord)?.analysisResult as ReturnType<typeof normalizeAnalysis>;

  const { data: proposalBatch, error: proposalBatchError } = await service.from("planning_batches").select("catalog_memory, status, queue_status").eq("id", batchId).maybeSingle();
  if (proposalBatchError) throw new Error(proposalBatchError.message);
  let normalized = analysisResult;
  
  if (!((proposalBatch?.catalog_memory || {}) as JsonRecord).stylingPlan) {
    const { count: generatedAlready } = await service.from("planning_requests")
      .select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("generation_status", "completed");
    
    await proposeCatalogStylingPlan(batchId, { catalog_memory: proposalBatch?.catalog_memory || {} } as JsonRecord, normalized.stylingPlan, variantId);
    if (!generatedAlready) {
      await service.rpc("save_catalog_styling_plan", { p_batch_id: batchId, p_plan: normalized.stylingPlan, p_approve: false, p_member_id: null });
    } else {
      await service.rpc("save_catalog_styling_plan", { p_batch_id: batchId, p_plan: normalized.stylingPlan, p_approve: true, p_member_id: null });
    }
  }

  const { data: freshBatch, error: freshBatchError } = await service.from("planning_batches").select("catalog_memory").eq("id", batchId).maybeSingle();
  if (freshBatchError) throw new Error(freshBatchError.message);
  const freshMemory = { catalog_memory: freshBatch?.catalog_memory || {} } as JsonRecord;
  
  if (stylingPlanApproval(freshMemory).blocked) {
    await service.from("planning_batches").update({
      schedule_status: "awaiting_styling_approval", queue_status: "idle",
      schedule_error: "Review and approve the catalogue styling plan to start generating.",
      updated_at: new Date().toISOString(),
    }).eq("id", batchId);

    await service.from("catalog_sessions").update({ status: "ready", updated_at: new Date().toISOString() }).eq("session_id", sessionId);
    // Halt the orchestrator for this session by throwing an error that pauses it,
    // or by intentionally returning failed (but really it should just wait).
    // For V2, we mark it failed with a specific message. When approved, it gets retried.
    const pause = new Error("Awaiting styling approval. The graph is paused.") as Error & { code?: string };
    pause.code = "styling_approval_pause";
    throw pause;
  }

  normalized = applyCatalogMemory(freshMemory, normalized);

  // Update session data
  const { data: session, error: sessionError } = await service.from("catalog_sessions").select("session_data").eq("session_id", sessionId).single();
  if (sessionError) throw new Error(sessionError.message);
  const sessionData = (session?.session_data as JsonRecord) || {};
  sessionData.creativeDirection = normalized.creativeDirection;
  sessionData.modelIdentity = normalized.modelIdentity;
  sessionData.stylingPlan = normalized.stylingPlan;
  sessionData.posePlan = normalized.posePlan;
  await service.from("catalog_sessions").update({ session_data: sessionData }).eq("session_id", sessionId);

  return { stylingPlan: normalized.stylingPlan, posePlan: normalized.posePlan };
}
async function handlePoseReferenceNode(node: JsonRecord, sessionId: string) { 
  const inputs = node.inputs as JsonRecord;
  return { poseIndex: inputs.poseIndex, referencesLoaded: true }; 
}
async function handlePromptCompilationNode(node: JsonRecord, sessionId: string) { 
  const inputs = node.inputs as JsonRecord;
  return { compiledPrompt: `Generate pose ${inputs.poseIndex} using the styled memory.` }; 
}
async function handleGptImage2Node(_node: JsonRecord, _sessionId: string): Promise<never> {
  throw new Error("This legacy node-graph session cannot emit a verified catalog asset. Restart the SKU from Catalog Production.");
}
async function handleGeminiQaNode(_node: JsonRecord, _sessionId: string): Promise<never> {
  throw new Error("This legacy node-graph session cannot emit a verified QA result. Restart the SKU from Catalog Production.");
}
async function handleFinalImageNode(node: JsonRecord, sessionId: string) { 
  const inputs = node.inputs as JsonRecord;
  // Find output URL from GPT node
  const { data: edges, error: edgesError } = await service.from("generation_flow_edges").select("source_node_id").eq("target_node_id", node.id);
  if (edgesError) console.error(edgesError.message);
  if (edges && edges.length > 0) {
    const { data: sourceNode, error: sourceNodeError } = await service.from("generation_flow_nodes").select("outputs").eq("id", edges[0].source_node_id).single();
    if (sourceNodeError) throw new Error(sourceNodeError.message);
    if (sourceNode?.outputs?.outputUrl) {
      await service.from("session_generations").update({
        status: "completed", output_url: sourceNode.outputs.outputUrl, storage_path: sourceNode.outputs.outputUrl, updated_at: new Date().toISOString()
      }).eq("session_id", sessionId).eq("pose_index", inputs.poseIndex);
    }
  }
  return { finalized: true }; 
}
async function handleLearningNode(node: JsonRecord, sessionId: string) { 
  const inputs = node.inputs as JsonRecord;
  
  // Update planning request to completed to finish the generation lifecycle
  const { data: session, error: sessionError } = await service.from("catalog_sessions").select("planning_request_id").eq("session_id", sessionId).single();
  if (sessionError) throw new Error(sessionError.message);
  if (session?.planning_request_id) {
    const { data: planningRequest, error: planningRequestError } = await service.from("planning_requests").select("batch_id").eq("id", session.planning_request_id).maybeSingle();
    if (planningRequestError) throw new Error(planningRequestError.message);
    const completedAt = new Date().toISOString();
    const completionUpdates = await Promise.all([
      service.from("planning_requests").update({ 
        status: "completed",
        generation_status: "completed",
        completion_status: "completed",
        generation_finished_at: completedAt,
        updated_at: completedAt,
      }).eq("id", session.planning_request_id),
      service.from("catalog_sessions").update({
        status: "completed",
        updated_at: completedAt,
      }).eq("session_id", sessionId),
      service.from("catalog_work_items").update({
        generation_status: "completed",
        generation_completed_at: completedAt,
        qc_status: "needs_review",
        listing_status: "pending",
      }).eq("planning_request_id", session.planning_request_id)
    ]);
    const completionError = completionUpdates.find((result) => result.error)?.error;
    if (completionError) throw new Error(completionError.message);
    if (planningRequest?.batch_id) scheduleBackground(kickCatalogProcessor(String(planningRequest.batch_id)));
  }

  return { learned: true, catalogUpdated: true }; 
}

async function processNode(request: Request, args: JsonRecord) {
  assertInternal(request);
  const sessionId = String(args.sessionId || "");
  if (!sessionId) return { processed: false, reason: "missing_session" };

  const { data: allNodes, error: allNodesError } = await service.from("generation_flow_nodes").select("*").eq("session_id", sessionId);
  if (allNodesError) console.error(allNodesError.message);
  const { data: allEdges, error: allEdgesError } = await service.from("generation_flow_edges").select("*").eq("session_id", sessionId);
  if (allEdgesError) console.error(allEdgesError.message);
  
  if (!allNodes || !allNodes.length) return { processed: false, reason: "no_nodes" };
  
  const completedNodeIds = new Set(allNodes.filter((n) => n.status === "completed").map((n) => n.id));
  const runningNodeIds = new Set(allNodes.filter((n) => n.status === "running").map((n) => n.id));
  
  const runnableNodes = allNodes.filter((node) => {
    if (node.status !== "pending") return false;
    const incomingEdges = allEdges?.filter((e) => e.target_node_id === node.id) || [];
    return incomingEdges.every((e) => completedNodeIds.has(e.source_node_id));
  });

  if (!runnableNodes.length) {
    if (runningNodeIds.size === 0) {
      const hasFailed = allNodes.some((n) => n.status === "failed");
      if (!hasFailed) {
        await service.from("catalog_sessions").update({ status: "completed", updated_at: new Date().toISOString() }).eq("session_id", sessionId);
      }
    }
    return { processed: false, reason: "no_runnable_nodes" };
  }

  const targetNode = runnableNodes[0];
  const { data: claimed, error: claimError } = await service.from("generation_flow_nodes")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", targetNode.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (!claimed || claimError) return { processed: false, reason: "claim_failed" };

  try {
    let result = {};
    if (claimed.node_type === "ai_visual_analysis") result = await handleAiVisualAnalysisNode(claimed, sessionId);
    else if (claimed.node_type === "product_truth") result = await handleProductTruthNode(claimed, sessionId);
    else if (claimed.node_type === "memory_and_planning") result = await handleMemoryAndPlanningNode(claimed, sessionId);
    else if (claimed.node_type === "pose_reference") result = await handlePoseReferenceNode(claimed, sessionId);
    else if (claimed.node_type === "prompt_compilation") result = await handlePromptCompilationNode(claimed, sessionId);
    else if (claimed.node_type === "gpt_image_2") result = await handleGptImage2Node(claimed, sessionId);
    else if (claimed.node_type === "gemini_qa") result = await handleGeminiQaNode(claimed, sessionId);
    else if (claimed.node_type === "final_image") result = await handleFinalImageNode(claimed, sessionId);
    else if (claimed.node_type === "learning") result = await handleLearningNode(claimed, sessionId);
    else throw new Error(`Unknown node type: ${claimed.node_type}`);

    await service.from("generation_flow_nodes").update({ 
      status: "completed", 
      outputs: { ...claimed.outputs, ...result },
      completed_at: new Date().toISOString() 
    }).eq("id", claimed.id);

    scheduleBackground(kickNodeOrchestrator(sessionId));
    return { processed: true, nodeId: claimed.id };
  } catch (err) {
    const failureMessage = errorMessage(err);
    await service.from("generation_flow_nodes").update({
      status: "failed", 
      error_message: failureMessage,
      completed_at: new Date().toISOString() 
    }).eq("id", claimed.id);
    if ((err as any)?.code !== "styling_approval_pause") {
      const failedAt = new Date().toISOString();
      const { data: session } = await service.from("catalog_sessions").select("planning_request_id").eq("session_id", sessionId).maybeSingle();
      let batchId = "";
      if (session?.planning_request_id) {
        const { data: planningRequest } = await service.from("planning_requests").select("batch_id").eq("id", session.planning_request_id).maybeSingle();
        batchId = String(planningRequest?.batch_id || "");
        await Promise.all([
          service.from("planning_requests").update({
            status: "failed", generation_status: "failed", completion_status: "failed",
            error_message: failureMessage, generation_finished_at: failedAt, updated_at: failedAt,
          }).eq("id", session.planning_request_id),
          service.from("catalog_work_items").update({
            generation_status: "failed", generation_completed_at: failedAt, qc_status: "needs_review",
          }).eq("planning_request_id", session.planning_request_id),
        ]);
      }
      await service.from("catalog_sessions").update({ status: "failed", updated_at: failedAt }).eq("session_id", sessionId);
      if (batchId) scheduleBackground(kickCatalogProcessor(batchId));
    }
    return { processed: false, reason: "node_failed", error: failureMessage };
  }
}


async function resolvePoseReferences(job: JsonRecord, sessionData: JsonRecord, pose: JsonRecord) {
  const sourceInputs = (Array.isArray(sessionData.references) ? sessionData.references : []) as ReferenceInput[];
  const loadedReferences = await loadAvailableReferences(sourceInputs, String(job.org_id));
  let { data: anchorPose } = Number(pose.pose_index) > 1
    ? await service.from("session_generations").select("output_url,storage_path,storage_backend,title,qa_status").eq("session_id", job.session_id).eq("pose_index", 1).eq("status", "completed").maybeSingle()
    : { data: null };
  if (!anchorPose?.output_url && !anchorPose?.storage_path && job.batch_id) {
    const { data: batchRow } = await service.from("planning_batches").select("catalog_memory").eq("id", String(job.batch_id)).maybeSingle();
    const memory = (batchRow?.catalog_memory || {}) as JsonRecord;
    const garmentFamily = String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || "");
    if ((memory.anchorOutputUrl || memory.anchorStoragePath) && canUsePoseOneAnchor(garmentFamily, memory.anchorQaStatus)) {
      anchorPose = { output_url: String(memory.anchorOutputUrl || ""), storage_path: String(memory.anchorStoragePath || ""), storage_backend: String(memory.anchorStorageBackend || "firebase"), title: "catalog anchor", qa_status: String(memory.anchorQaStatus || "") };
    }
  }
  if (anchorPose && !canUsePoseOneAnchor(String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || ""), anchorPose.qa_status)) anchorPose = null;
  const approved: LoadedReference[] = [];
  if (anchorPose?.output_url || anchorPose?.storage_path) {
    const loaded = await loadReference({
      role: "approved_pose", downloadUrl: anchorPose.output_url, storagePath: anchorPose.storage_path, storageBackend: anchorPose.storage_backend as CatalogStorageBackend,
      hash: smallHash(String(anchorPose.output_url || anchorPose.storage_path)), filename: "approved-pose-1", mimeType: "", size: 0,
    }, String(job.org_id));
    loaded.filename = `approved-pose-1.${extensionForMimeType(loaded.mimeType)}`;
    approved.push(loaded);
  }
  const storedPoseData = (pose.generation_data || {}) as JsonRecord;
  const poseData = { ...(storedPoseData as StudioPose), poseNumber: Number(pose.pose_index) } as StudioPose & { poseNumber: number };
  const selected = selectReferences(loadedReferences, approved, poseData.id, String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || ""), MAX_REFERENCES);
  return { loadedReferences, approved, poseData, selected, storedPoseData };
}

async function compilePosePrompt(job: JsonRecord, sessionData: JsonRecord, pose: JsonRecord, poseData: any, selected: any[], storedPoseData: JsonRecord) {
  const requestedCorrection = String(pose.regeneration_instructions || "").trim();
  let qaCorrections = (Array.isArray(storedPoseData.corrections)
    ? storedPoseData.corrections.map(String)
    : [String(storedPoseData.correction || "")]).map((entry) => entry.trim()).filter(Boolean);
  const promptCorrection = () => [
    ...qaCorrections,
    requestedCorrection ? `USER REGENERATION INSTRUCTION (apply only if compatible with original product truth): ${requestedCorrection}` : "",
  ].filter(Boolean).join("\n");

  const { data: pastLearnings, error: pastLearningsError } = await service.from("generation_learnings")
    .select("failure_signals")
    .eq("organization_id", job.org_id)
    .eq("product_category", String(sessionData.category || ""))
    .order("created_at", { ascending: false })
    .limit(20);
  if (pastLearningsError) throw new Error(pastLearningsError.message);
  
  const learningsArr: string[] = [];
  const currentGarmentFamily = String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || "");
  for (const l of pastLearnings || []) {
    const fs = (l.failure_signals as JsonRecord) || {};
    const savedFamily = String(fs.garmentFamily || "");
    if (currentGarmentFamily === "saree" && savedFamily !== "saree") continue;
    if (currentGarmentFamily !== "saree" && savedFamily === "saree") continue;
    const fb = (fs.feedback as any[]) || [];
    for (const f of fb) {
      if (f.poseTitle === poseData.title && Array.isArray(f.corrections)) {
        learningsArr.push(...f.corrections.map(String));
      }
    }
  }
  const learningsStr = learningsArr.slice(0, 3).map((c) => `- Past correction: ${c}`).join("\n");

  const prompt = composeGenerationPrompt({
    skuName: String((job.job_data as JsonRecord)?.skuName || job.sku_name || "Untitled product"),
    productDetails: String((job.job_data as JsonRecord)?.productDetails || ""), pose: poseData, session: sessionData,
    references: selected, correction: promptCorrection(), learnings: learningsStr,
  });
  return { prompt, qaCorrections, promptCorrectionStr: promptCorrection() };
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
  const { data: pose, error: poseError } = await service.from("session_generations").select("*").eq("session_id", job.session_id).eq("status", "queued").order("pose_index").limit(1).maybeSingle();
  if (poseError) throw new Error(poseError.message);
  if (!pose) {
    const { data: poses, error: posesError } = await service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index");
    if (posesError) console.error(posesError.message);
    await finalizeJob(job, session, (poses || []) as JsonRecord[]);
    return { processed: true, completed: true, jobId: job.job_id };
  }
  const sessionData = session.session_data as JsonRecord;
  // Run the corrected v14 Product Truth gate before changing workflow state or
  // making any paid provider request. This also protects queued v13 jobs that
  // existed before the cache-version migration.
  assertSareeGenerationReady(sessionData);
  const now = new Date().toISOString();
  await Promise.all([
    service.from("session_generations").update({ status: "processing", attempt_count: Number(pose.attempt_count || 0), updated_at: now }).eq("session_id", job.session_id).eq("generation_id", pose.generation_id),
    service.from("generation_jobs").update({ current_pose: pose.pose_index, lock_expires_at: new Date(Date.now() + WORKER_LEASE_MS).toISOString(), updated_at: now, job_data: { ...((job.job_data as JsonRecord) || {}), detailedStatus: `Pose ${pose.pose_index} generating (Attempt ${Number(pose.attempt_count || 0) + 1})` } }).eq("job_id", job.job_id),
    service.from("planning_requests").update({ generation_status: "processing", generation_started_at: job.started_at || now, updated_at: now }).eq("id", job.planning_request_id),
  ]);
  const sourceInputs = (Array.isArray(sessionData.references) ? sessionData.references : []) as ReferenceInput[];
  const loadedReferences = await loadAvailableReferences(sourceInputs, String(job.org_id));
  let { data: anchorPose } = Number(pose.pose_index) > 1
    ? await service.from("session_generations").select("output_url,storage_path,storage_backend,title,qa_status").eq("session_id", job.session_id).eq("pose_index", 1).eq("status", "completed").maybeSingle()
    : { data: null };
  // A bulk catalog has to look like one shoot day across every colourway, but each
  // SKU is its own session, so pose 1 of SKU 2 had no anchor at all - only text
  // memory, which drifts. The batch keeps the first approved frame precisely so
  // later SKUs can be pinned to that same set and model.
  if (!anchorPose?.output_url && !anchorPose?.storage_path && job.batch_id) {
    const { data: batchRow, error: batchRowError } = await service.from("planning_batches").select("catalog_memory").eq("id", String(job.batch_id)).maybeSingle();
    if (batchRowError) throw new Error(batchRowError.message);
    const memory = (batchRow?.catalog_memory || {}) as JsonRecord;
    const garmentFamily = String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || "");
    if ((memory.anchorOutputUrl || memory.anchorStoragePath) && canUsePoseOneAnchor(garmentFamily, memory.anchorQaStatus)) {
      anchorPose = { output_url: String(memory.anchorOutputUrl || ""), storage_path: String(memory.anchorStoragePath || ""), storage_backend: String(memory.anchorStorageBackend || "firebase"), title: "catalog anchor", qa_status: String(memory.anchorQaStatus || "") };
    }
  }
  if (anchorPose && !canUsePoseOneAnchor(String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || ""), anchorPose.qa_status)) anchorPose = null;
  const approved: LoadedReference[] = [];
  if (anchorPose?.output_url || anchorPose?.storage_path) {
    // Load the reference first to determine the actual MIME type from the blob,
    // then set the filename extension to match. No mimeType hint here on purpose:
    // loadReference() falls back to the fetched blob's actual Content-Type.
    // Pose 1 is now stored as JPEG, but could be PNG or WebP for legacy data.
    const loaded = await loadReference({
      role: "approved_pose", downloadUrl: anchorPose.output_url, storagePath: anchorPose.storage_path, storageBackend: anchorPose.storage_backend as CatalogStorageBackend,
      hash: smallHash(String(anchorPose.output_url || anchorPose.storage_path)), filename: "approved-pose-1", mimeType: "", size: 0,
    }, String(job.org_id));
    // Update filename to include the correct extension based on resolved MIME type
    loaded.filename = `approved-pose-1.${extensionForMimeType(loaded.mimeType)}`;
    approved.push(loaded);
  }
  const storedPoseData = (pose.generation_data || {}) as JsonRecord;
  const poseData = { ...(storedPoseData as StudioPose), poseNumber: Number(pose.pose_index) } as StudioPose & { poseNumber: number };
  const requestedCorrection = String(pose.regeneration_instructions || "").trim();
  let qaCorrections = (Array.isArray(storedPoseData.corrections)
    ? storedPoseData.corrections.map(String)
    : [String(storedPoseData.correction || "")]).map((entry) => entry.trim()).filter(Boolean);
  // Keep only the most recent QA correction to avoid context bloat with resolved errors
  if (qaCorrections.length > 1) qaCorrections = [qaCorrections[qaCorrections.length - 1]];
  
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
    const { data: pastLearnings, error: pastLearningsError } = await service.from("generation_learnings")
      .select("failure_signals")
      .eq("organization_id", job.org_id)
      .eq("product_category", String(sessionData.category || ""))
      .order("created_at", { ascending: false })
      .limit(20);
    if (pastLearningsError) throw new Error(pastLearningsError.message);
    const learningsArr: string[] = [];
    const currentGarmentFamily = String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || "");
    for (const l of pastLearnings || []) {
      const fs = (l.failure_signals as JsonRecord) || {};
      const savedFamily = String(fs.garmentFamily || "");
      if (currentGarmentFamily === "saree" && savedFamily !== "saree") continue;
      if (currentGarmentFamily !== "saree" && savedFamily === "saree") continue;
      
      const fb = (fs.feedback as any[]) || [];
      for (const f of fb) {
        if (f.poseTitle === poseData.title && Array.isArray(f.corrections)) {
          learningsArr.push(...f.corrections.map(String));
        }
      }
    }
    const learningsStr = learningsArr.slice(0, 3).map((c) => `- Past correction: ${c}`).join("\n");

    const selected = selectReferences(loadedReferences, approved, poseData.id, String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || ""), MAX_REFERENCES);
    const prompt = composeGenerationPrompt({
      skuName: String((job.job_data as JsonRecord)?.skuName || job.sku_name || "Untitled product"),
      productDetails: String((job.job_data as JsonRecord)?.productDetails || ""), pose: poseData, session: sessionData,
      references: selected, correction: promptCorrection(), learnings: learningsStr,
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
    let qa: ReturnType<typeof parseQaResponse> & { usageMetadata?: unknown } = unavailableQaResult("Automatic QA was disabled.");
    // A QA call that cannot return a verdict - safety block, provider outage, malformed
    // response - is not evidence that the frame is wrong. The image is already generated
    // and paid for, so it ships flagged for human review instead of being destroyed and
    // regenerated three times into a total loss.
    let qaStarted = 0;
    let qaLatencyMs = 0;
    let qaUnavailable = "";
    if (job.pose_qa !== false) {
      try {
        qaStarted = Date.now();
        qa = await validatePose({ generated, references: loadedReferences, approved, session: sessionData, pose: poseData });
        qaLatencyMs = Date.now() - qaStarted;
      } catch (error) {
        qaUnavailable = errorMessage(error);
        qa = unavailableQaResult(`Automatic consistency QA could not run: ${qaUnavailable}`);
      }
    }
    await recordAiRun({
      organization_id: job.org_id, planning_request_id: job.planning_request_id, batch_id: job.batch_id || null,
      job_id: job.job_id, session_id: job.session_id, pose_index: pose.pose_index, run_kind: "image_generation", model: job.model, provider: "openai",
      input_fingerprint: smallHash(prompt), input_summary: { pose: pose.pose_index, attempt, referenceRoles: selected.map((reference) => reference.role) },
      output_json: { generated: true }, status: "completed", latency_ms: Date.now() - generatedStarted,
      provider_request_id: providerRequestId,
      input_tokens: generated.usage.inputTokens, input_text_tokens: generated.usage.inputTextTokens,
      input_image_tokens: generated.usage.inputImageTokens, output_tokens: generated.usage.outputTokens,
      total_tokens: generated.usage.totalTokens, usage_payload: { openai: generated.usage.raw },
      cost_usd: attemptCost, cost_source: generated.usage.providerReported ? "provider_reported_tokens_openai_public_rates" : "provider_not_reported",
    });
    
    if (!qaUnavailable && job.pose_qa !== false) {
       const qaUsage = (qa.usageMetadata || {}) as any;
       const inTok = Number(qaUsage?.promptTokenCount || 0);
       const outTok = Number(qaUsage?.candidatesTokenCount || 0);
       const policy = (qa as any).policy || resolveGeminiPolicy({ purpose: "qa" });
       const pricing = GEMINI_PRICING[policy.model] || GEMINI_PRICING["gemini-3.6-flash"];
       const estCost = (inTok * pricing.input + outTok * pricing.output) / 1000000;
       await recordAiRun({
         organization_id: job.org_id, planning_request_id: job.planning_request_id, batch_id: job.batch_id || null,
         job_id: job.job_id, session_id: job.session_id, pose_index: pose.pose_index, run_kind: "quality_assurance", model: policy.model, provider: "google",
         purpose: policy.purpose, thinking_level: policy.thinkingLevel,
         input_fingerprint: smallHash(prompt), input_summary: { pose: pose.pose_index, attempt, policy },
         output_json: { qa, qaVersion: QA_VERSION }, status: qa.outcome, latency_ms: qaLatencyMs,
         provider_request_id: "",
         input_tokens: inTok, input_text_tokens: inTok,
         input_image_tokens: 0, output_tokens: outTok,
         total_tokens: Number(qaUsage?.totalTokenCount || 0), thoughts_token_count: Number(qaUsage?.thoughtsTokenCount || 0),
         usage_payload: { geminiQa: qaUsage },
         cost_usd: estCost, cost_source: `estimated_public_rates_${pricing.version}`,
       });
    }
    if (!qa.pass) {
      const defect = [
        qa.correction || qa.reason,
        qa.failed.length ? `Failed checks: ${qa.failed.join(", ")}.` : "",
        qa.weakest.length ? `Weakest matches against the product references: ${qa.weakest.join(", ")} - rebuild these from the reference images rather than adjusting them by feel.` : "",
        `Product fidelity scored ${qa.productFidelity}%.`,
      ].filter(Boolean).join(" ").trim();
      const isRepeatedDefect = qaCorrections.length > 0 && qaCorrections[qaCorrections.length - 1].includes(defect);
      qaCorrections = [...qaCorrections, `Attempt ${attempt}: ${defect}`].slice(-MAX_GENERATION_ATTEMPTS);
      const archived = await archiveRejectedAttempt({ job, pose, attempt, generated, qa });
      if (archived) rejectedAttempts = appendRejectedAttemptHistory(rejectedAttempts, archived, MAX_GENERATION_ATTEMPTS);
      // The verdict is written now, not on the way out: neither deferPoseRetry nor
      // failPoseAndJob touches qa_payload, so a pose that exhausts its retries
      // would otherwise show an archived image with no fidelity breakdown.
      await service.from("session_generations").update({
        qa_status: "rejected_by_qa", qa_payload: { ...qa, attempt, qaUnavailable: "", qaVersion: QA_VERSION }, updated_at: new Date().toISOString(),
      }).eq("session_id", job.session_id).eq("generation_id", pose.generation_id);
      lastError = `Consistency QA failed: ${qa.reason}`;
      await service.from("qa_reviews").insert({
        organization_id: job.org_id, planning_request_id: job.planning_request_id, generation_job_id: job.job_id,
        pose_index: pose.pose_index, reviewer_type: "gemini_auto", score: qa.score, passed: false,
        issues: qa.failed, notes: qa.reason, qa_version: QA_VERSION, outcome: "rejected_by_qa",
        generation_epoch: Number(pose.generation_epoch || 1), attempt_number: attempt, metadata: { qa },
      });
      const qaError = new Error(lastError) as Error & { code?: string };
      qaError.code = isRepeatedDefect ? "same_defect_repeated" : "consistency_qa_failed";
      throw qaError;
    }
    const { data: latestJob, error: latestJobError } = await service.from("generation_jobs").select("status").eq("job_id", job.job_id).maybeSingle();
    if (latestJobError) throw new Error(latestJobError.message);
    if (["cancelling", "cancelled"].includes(String(latestJob?.status || ""))) return finalizeCancelledJob(job);
    const safeSku = String((job.job_data as JsonRecord)?.skuId || job.sku_name || "product").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const storagePath = `organizations/${job.org_id}/generated/${job.job_id}/${pose.pose_index}-${safeSku}-${crypto.randomUUID()}.${extensionForMimeType(generated.mimeType)}`;
    const stored = await uploadCatalogObject({ orgId: String(job.org_id), storagePath, blob: generated.blob, mimeType: generated.mimeType });
    const completedAt = new Date().toISOString();
    const { qaStatus } = qaStorageDisposition({ qaEnabled: job.pose_qa !== false, qaUnavailable: Boolean(qaUnavailable), outcome: qa.outcome });
    const usagePatch = accumulatedUsage(pose as JsonRecord, generated.usage, generated.requestId, attemptCost);
    await Promise.all([
      service.from("session_generations").update({
        status: "completed", output_url: stored.downloadUrl, storage_path: stored.storagePath, storage_backend: stored.storageBackend,
        qa_status: qaStatus, qa_payload: { ...qa, qaUnavailable, qaVersion: QA_VERSION },
        error: qaUnavailable ? `Delivered without automatic consistency QA: ${qaUnavailable}`.slice(0, 1000) : "", updated_at: completedAt,
        generation_data: { ...storedPoseData, correction: "", corrections: [], completedAt: Date.now(), mimeType: generated.mimeType },
        ...usagePatch,
      }).eq("session_id", job.session_id).eq("generation_id", pose.generation_id),
      service.from("planning_assets").insert({
        organization_id: job.org_id, planning_request_id: job.planning_request_id, sku_name: job.sku_name,
        prompt, image_url: stored.downloadUrl, storage_path: stored.storagePath, generation_job_id: job.job_id,
        sku_matched: true, asset_role: "generated", storage_backend: stored.storageBackend,
        metadata: {
          poseIndex: pose.pose_index, poseType: pose.pose_type, qa, qaStatus, qaVersion: QA_VERSION,
          model: job.model, quality: job.quality,
          providerRequestId: generated.requestId, usage: generated.usage.raw, actualCostUsd: attemptCost,
        },
      }),
      // Every QA execution state is immutable audit history. An unavailable or
      // disabled validator is recorded as unverified (never passed), so later
      // reruns do not erase why the original frame required human QC.
      service.from("qa_reviews").insert({
        organization_id: job.org_id, planning_request_id: job.planning_request_id, generation_job_id: job.job_id,
        pose_index: pose.pose_index,
        reviewer_type: job.pose_qa === false ? "qa_disabled" : qaUnavailable ? "gemini_auto_unavailable" : "gemini_auto",
        score: qa.score, passed: !qaUnavailable && job.pose_qa !== false && qa.automaticallyVerified,
        issues: qaUnavailable ? ["qa_unavailable"] : job.pose_qa === false ? ["qa_disabled"] : qa.failed,
        notes: qa.reason, qa_version: QA_VERSION, outcome: qaStatus,
        generation_epoch: Number(pose.generation_epoch || 1), attempt_number: attempt, metadata: { qa, qaUnavailable },
      }),
    ]);
    const { data: allPoses, error: allPosesError } = await service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index");
    if (allPosesError) console.error(allPosesError.message);
    const completedCount = (allPoses || []).filter((entry) => entry.status === "completed").length;
    const failedCount = (allPoses || []).filter((entry) => entry.status === "failed").length;
    const generatedAssets = (allPoses || []).filter((entry) => entry.output_url).map((entry) => ({ poseIndex: entry.pose_index, url: entry.output_url, storagePath: entry.storage_path, qaStatus: entry.qa_status }));
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
      // Supabase stays the single record of the shoot: the session carries the
      // Product DNA version it was generated against plus the per-pose fidelity
      // verdict, so a set can be audited later without replaying the job.
      service.from("catalog_sessions").update({
        session_data: {
          ...sessionData, generatedAssets, approvedAssets: generatedAssets.filter((asset) => asset.poseIndex === 1 && canUsePoseOneAnchor(String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || ""), asset.qaStatus)),
          productDnaVersion: ANALYSIS_VERSION,
          validation: {
            ...(sessionData.validation && typeof sessionData.validation === "object" ? sessionData.validation as JsonRecord : {}),
            [`pose${pose.pose_index}`]: {
              productFidelity: qa.productFidelity, scores: qa.scores, weakest: qa.weakest,
              qaStatus, qaVersion: QA_VERSION, attempt, checkedAt: Date.now(),
            },
          },
        },
        updated_at: completedAt,
      }).eq("session_id", job.session_id),
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
  const { data: job, error: jobError } = await service.from("generation_jobs").select("*").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Generation job not found.");
  if (!workspace.isAdmin && job.user_id !== workspace.user.firebaseUid) throw new Error("You can cancel only your own generation jobs.");
  if (["completed", "failed", "cancelled"].includes(String(job.status))) return { success: true };
  await service.from("generation_jobs").update({ status: "cancelling", updated_at: new Date().toISOString() }).eq("job_id", jobId);
  await finalizeCancelledJob({ ...job, status: "cancelling" });
  return { success: true };
}

async function regeneratePose(request: Request, args: JsonRecord, options: { allowManagedCatalog?: boolean } = {}) {
  const { workspace } = await workspaceFor(request, options.allowManagedCatalog ? undefined : "studio.generate");
  if (options.allowManagedCatalog && !workspace.isAdmin
    && !workspace.permissions.includes("planning.approve")
    && !workspace.permissions.includes("planning.generate_images")) {
    throw new Error("Permission required: planning.approve or planning.generate_images");
  }
  const generationId = String(args.poseId || args.generationId || "");
  const { data: pose, error: poseError } = await service.from("session_generations").select("*").eq("generation_id", generationId).single();
  if (poseError) throw new Error(poseError.message);
  if (!pose) throw new Error("Pose not found.");
  const { data: job, error: jobError } = await service.from("generation_jobs").select("*").eq("session_id", pose.session_id).eq("org_id", workspace.organization.id).single();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Generation job not found.");
  if (["queued", "processing", "cancelling"].includes(job.status)) throw new Error("Wait for the current photoshoot to finish before regenerating a pose.");
  if (!workspace.isAdmin && job.user_id !== workspace.user.firebaseUid && !options.allowManagedCatalog) throw new Error("You can regenerate only your own generation jobs.");
  const extraInstructions = String(args.extraInstructions || "").trim();
  if (extraInstructions.length > 1000) throw new Error("Regeneration instructions must be 1,000 characters or fewer.");
  const history = Array.isArray(pose.regeneration_history) ? pose.regeneration_history as JsonRecord[] : [];
  const regenerationResults = await Promise.all([
    service.from("session_generations").update({
      status: "queued", attempt_count: 0, qa_status: "pending", error: "",
      output_url: "", storage_path: "",
      generation_epoch: Math.max(1, Number(pose.generation_epoch || 1)) + 1,
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
  assertSupabaseResults(regenerationResults, "Could not queue the pose re-generation");
  scheduleBackground(kickWorker());
  return { success: true };
}

async function syncCatalogAnchorQa(
  job: JsonRecord,
  pose: JsonRecord,
  sessionData: JsonRecord,
  outcome: string,
) {
  if (!job.batch_id || Number(pose.pose_index) !== 1) return;
  const { data: batch, error: batchError } = await service.from("planning_batches")
    .select("catalog_memory").eq("id", String(job.batch_id)).maybeSingle();
  if (batchError) throw new Error(batchError.message);
  const memory = (batch?.catalog_memory || {}) as JsonRecord;
  const ownsCurrentAnchor = String(memory.anchorJobId || "") === String(job.job_id);
  const hasAnchor = Boolean(memory.anchorOutputUrl || memory.anchorStoragePath);
  const garmentFamily = String((sessionData.productIdentity as JsonRecord | undefined)?.garmentFamily || "");
  const canPromote = !hasAnchor && canUsePoseOneAnchor(garmentFamily, outcome);
  if (!ownsCurrentAnchor && !canPromote) return;
  const patch = canPromote
    ? {
      anchorOutputUrl: pose.output_url,
      anchorStoragePath: pose.storage_path,
      anchorStorageBackend: pose.storage_backend || "firebase",
      anchorJobId: job.job_id,
      anchorQaStatus: outcome,
      anchorQaVersion: QA_VERSION,
      anchorGarmentFamily: garmentFamily,
    }
    : { anchorQaStatus: outcome, anchorQaVersion: QA_VERSION };
  const { error } = await service.rpc("merge_catalog_memory", {
    p_batch_id: job.batch_id,
    p_patch: patch,
    p_require_absent: canPromote ? "anchorOutputUrl" : null,
  });
  if (error) throw new Error(error.message);
}

async function rerunPoseQa(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request);
  if (!workspace.isAdmin && !workspace.permissions.includes("admin.settings")) {
    throw new Error("Only an administrator can re-run automatic QA.");
  }
  const generationId = String(args.poseId || args.generationId || "");
  const { data: pose, error: poseError } = await service.from("session_generations").select("*").eq("generation_id", generationId).single();
  if (poseError || !pose) throw new Error(poseError?.message || "Pose not found.");
  if (!pose.output_url && !pose.storage_path) throw new Error("This pose has no preserved generated image to review.");
  const [{ data: job, error: jobError }, { data: session, error: sessionError }] = await Promise.all([
    service.from("generation_jobs").select("*").eq("session_id", pose.session_id).eq("org_id", workspace.organization.id).single(),
    service.from("catalog_sessions").select("*").eq("session_id", pose.session_id).eq("organization_id", workspace.organization.id).single(),
  ]);
  if (jobError || !job) throw new Error(jobError?.message || "Generation job not found.");
  if (sessionError || !session) throw new Error(sessionError?.message || "Generation session not found.");
  const sessionData = session.session_data as JsonRecord;
  const references = await loadAvailableReferences((Array.isArray(sessionData.references) ? sessionData.references : []) as ReferenceInput[], workspace.organization.id);
  const generated = await loadReference({
    role: "generated", downloadUrl: pose.output_url, storagePath: pose.storage_path,
    storageBackend: pose.storage_backend as CatalogStorageBackend, hash: smallHash(String(pose.output_url || pose.storage_path)),
    filename: `pose-${pose.pose_index}.${extensionForMimeType(String((pose.generation_data as JsonRecord | undefined)?.mimeType || "image/jpeg"))}`,
    mimeType: String((pose.generation_data as JsonRecord | undefined)?.mimeType || ""), size: 0,
  }, workspace.organization.id);
  const poseData = { ...((pose.generation_data || {}) as StudioPose), poseNumber: Number(pose.pose_index) } as StudioPose & { poseNumber: number };
  const reviewedAt = new Date().toISOString();
  let qa: Awaited<ReturnType<typeof validatePose>>;
  try {
    qa = await validatePose({ generated, references, approved: [], session: sessionData, pose: poseData });
  } catch (error) {
    const message = errorMessage(error);
    const unavailable = unavailableQaResult(`Automatic consistency QA could not run: ${message}`);
    const results = await Promise.all([
      service.from("qa_reviews").insert({
        organization_id: workspace.organization.id, planning_request_id: job.planning_request_id,
        generation_job_id: job.job_id, pose_index: pose.pose_index, reviewer_type: "gemini_admin_rerun",
        score: 0, passed: false, issues: ["qa_unavailable"], notes: message,
        qa_version: QA_VERSION, outcome: "unverified", generation_epoch: Number(pose.generation_epoch || 1),
        attempt_number: Number(pose.attempt_count || 1), metadata: { error: message, rerunByMemberId: workspace.member.id },
      }),
      service.from("session_generations").update({
        qa_status: "unverified",
        qa_payload: { ...unavailable, qaVersion: QA_VERSION, rerunAt: reviewedAt, previousQa: pose.qa_payload || null },
        updated_at: reviewedAt,
      }).eq("generation_id", generationId),
      service.from("audit_logs").insert({
        organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
        action: "generation.qa.rerun_unavailable", resource_type: "session_generation", resource_id: generationId,
        metadata: { jobId: job.job_id, poseIndex: pose.pose_index, qaVersion: QA_VERSION, error: message },
      }),
    ]);
    assertSupabaseResults(results, "Could not save the unavailable QA attempt");
    await syncCatalogAnchorQa(job as JsonRecord, pose as JsonRecord, sessionData, "unverified");
    return { success: false, outcome: "unverified", error: message, qaVersion: QA_VERSION };
  }
  const results = await Promise.all([
    service.from("qa_reviews").insert({
      organization_id: workspace.organization.id, planning_request_id: job.planning_request_id,
      generation_job_id: job.job_id, pose_index: pose.pose_index, reviewer_type: "gemini_admin_rerun",
      score: qa.score, passed: qa.automaticallyVerified, issues: qa.failed, notes: qa.reason,
      qa_version: QA_VERSION, outcome: qa.outcome, generation_epoch: Number(pose.generation_epoch || 1),
      attempt_number: Number(pose.attempt_count || 1), metadata: { qa, rerunByMemberId: workspace.member.id },
    }),
    service.from("session_generations").update({
      qa_status: qa.outcome, qa_payload: { ...qa, qaVersion: QA_VERSION, rerunAt: reviewedAt }, updated_at: reviewedAt,
    }).eq("generation_id", generationId),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
      action: "generation.qa.rerun", resource_type: "session_generation", resource_id: generationId,
      metadata: { jobId: job.job_id, poseIndex: pose.pose_index, qaVersion: QA_VERSION, outcome: qa.outcome },
    }),
  ]);
  assertSupabaseResults(results, "Could not save the QA rerun");
  await syncCatalogAnchorQa(job as JsonRecord, pose as JsonRecord, sessionData, qa.outcome);
  return { success: true, outcome: qa.outcome, score: qa.score, qaVersion: QA_VERSION };
}

// Requeues every pose in a failed job that didn't complete, so one bad pose (or the cascading
// "skipped because another required pose failed" poses that follow it) doesn't force the user
// to click "Regenerate" one pose at a time. Poses that already completed are left untouched -
// cheaper, and preserves the pose-1 identity anchor when it's one of the survivors.
async function regenerateSession(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const jobId = String(args.jobId || "");
  const { data: job, error: jobError } = await service.from("generation_jobs").select("*").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Generation job not found.");
  if (!workspace.isAdmin && job.user_id !== workspace.user.firebaseUid) throw new Error("You can regenerate only your own generation jobs.");
  if (job.status !== "failed") throw new Error("Only a failed generation can be regenerated as a whole session.");
  const { data: poses, error: posesError } = await service.from("session_generations").select("generation_id,status").eq("session_id", job.session_id);
  if (posesError) console.error(posesError.message);
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
function rejectedAttemptAssets(rows: JsonRecord[]) {
  return rows.flatMap((row) => {
    const data = (row.generation_data || {}) as JsonRecord;
    return (Array.isArray(data.rejectedAttempts) ? data.rejectedAttempts as JsonRecord[] : []).map((entry) => ({
      storagePath: String(entry.storagePath || ""),
      storageBackend: String(entry.storageBackend || row.storage_backend || "firebase"),
      fallbackUrl: String(entry.url || ""),
    }));
  });
}

async function jobImageAssets(job: JsonRecord) {
  const [{ data: poses }, { data: generatedAssets }] = await Promise.all([
    service.from("session_generations").select("storage_path,storage_backend,generation_data,output_url").eq("session_id", job.session_id),
    service.from("planning_assets").select("storage_path,storage_backend,image_url").eq("generation_job_id", job.job_id).eq("asset_role", "generated"),
  ]);
  const assets = [
    ...(poses || []).map((row) => ({ storagePath: String(row.storage_path || ""), storageBackend: String(row.storage_backend || "firebase"), fallbackUrl: String(row.output_url || "") })),
    ...rejectedAttemptAssets((poses || []) as JsonRecord[]),
    ...(generatedAssets || []).map((row) => ({ storagePath: String(row.storage_path || ""), storageBackend: String(row.storage_backend || "firebase"), fallbackUrl: String(row.image_url || "") })),
  ].filter((asset) => asset.storagePath);
  return [...new Map(assets.map((asset) => [asset.storagePath, asset])).values()];
}

async function removeJob(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const jobId = String(args.jobId || "");
  const { data: job, error: jobError } = await service.from("generation_jobs").select("*").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Generation job not found.");
  if (["queued", "processing", "cancelling"].includes(job.status)) throw new Error("Cancel the active generation before deleting it.");
  if (!workspace.isAdmin && job.user_id !== workspace.user.firebaseUid) throw new Error("You can delete only your own generation jobs.");
  const generatedAssets = await jobImageAssets(job);
  await service.from("planning_assets").delete().eq("generation_job_id", jobId).eq("asset_role", "generated");
  await service.from("catalog_sessions").delete().eq("session_id", job.session_id);
  await service.from("generation_jobs").delete().eq("job_id", jobId);
  const deletionResults = await Promise.allSettled(generatedAssets.map((asset) => deleteCatalogObject(workspace.organization.id, asset.storagePath, asset.storageBackend)));
  const storageDeleteFailures = deletionResults.filter((result) => result.status === "rejected").length;
  return { success: true, deletedImages: generatedAssets.length - storageDeleteFailures, storageDeleteFailures };
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
  const { data: job, error: jobError } = await service.from("generation_jobs").select("job_id,session_id,org_id").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Generation job not found.");
  const allowed = await jobImageAssets(job);
  const asset = allowed.find((candidate) => candidate.storagePath === storagePath);
  if (!asset) throw new Error("This image does not belong to the requested generation job.");
  const blob = await downloadCatalogObject(workspace.organization.id, storagePath, asset.storageBackend, asset.fallbackUrl);
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
  const { data: job, error: jobError } = await service.from("generation_jobs").select("job_id,session_id,org_id").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new Error("Generation job not found.");
  const allowed = await jobImageAssets(job);
  const assetResults = await Promise.all(storagePaths.map(async (storagePath) => {
    const asset = allowed.find((candidate) => candidate.storagePath === storagePath);
    if (!asset) return { storagePath, error: "This image does not belong to the requested generation job." };
    try {
      const blob = await downloadCatalogObject(workspace.organization.id, storagePath, asset.storageBackend, asset.fallbackUrl);
      return { storagePath, base64: await blobToBase64(blob), mimeType: blob.type || "image/png" };
    } catch (error) {
      return { storagePath, error: errorMessage(error) };
    }
  }));
  return { assets: assetResults };
}

async function downloadCatalogProductionAssets(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.view");
  const workItemId = String(args.workItemId || "");
  const requestedPaths = new Set(
    (Array.isArray(args.storagePaths) ? args.storagePaths : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  const requestedPoseIndexes = new Set(
    (Array.isArray(args.poseIndexes) ? args.poseIndexes : [])
      .map((value) => Number(value || 0))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
  if (!workItemId) throw new Error("A catalog work item is required.");
  const { data: workItem, error: workItemError } = await service.from("catalog_work_items")
    .select("id,catalog_session_id")
    .eq("id", workItemId)
    .eq("organization_id", workspace.organization.id)
    .maybeSingle();
  if (workItemError) throw new Error(workItemError.message);
  if (!workItem?.catalog_session_id) throw new Error("This work item has no generated session assets.");
  const { data: poses, error: posesError } = await service.from("session_generations")
    .select("generation_id,pose_index,title,storage_path,storage_backend,output_url,status")
    .eq("session_id", workItem.catalog_session_id)
    .eq("status", "completed")
    .order("pose_index");
  if (posesError) throw new Error(posesError.message);
  const selected = (poses || []).filter((pose) => {
    const storagePath = String(pose.storage_path || "");
    if (requestedPoseIndexes.size && !requestedPoseIndexes.has(Number(pose.pose_index || 0))) return false;
    return !requestedPaths.size || requestedPaths.has(storagePath);
  }).slice(0, 10);
  if (!selected.length) throw new Error("No completed generated assets were selected.");

  const assets = await Promise.all(selected.map(async (pose) => {
    const storagePath = String(pose.storage_path || "");
    const outputUrl = String(pose.output_url || "");
    try {
      const blob = storagePath
        ? await downloadCatalogObject(workspace.organization.id, storagePath, pose.storage_backend, outputUrl)
        : await downloadCatalogObject(workspace.organization.id, outputUrl, "external", outputUrl);
      return {
        storagePath,
        poseIndex: Number(pose.pose_index || 0),
        title: String(pose.title || ""),
        base64: await blobToBase64(blob),
        mimeType: blob.type || "image/png",
      };
    } catch (error) {
      return {
        storagePath,
        poseIndex: Number(pose.pose_index || 0),
        title: String(pose.title || ""),
        error: errorMessage(error),
      };
    }
  }));
  return { assets };
}

async function adminGenerationFlowList(request: Request) {
  const { workspace } = await workspaceFor(request);
  if (!workspace.isAdmin && !workspace.permissions.includes("admin.settings")) throw new Error("You do not have access to the admin console.");
  
  const { data: jobs, error } = await service.from("generation_jobs")
    .select("job_id, session_id, sku_name, status, model, provider, actual_cost_usd, started_at, batch_id, current_pose")
    .eq("org_id", workspace.organization.id)
    .order("started_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  const { data: sessions, error: sessionError } = await service.from("catalog_sessions")
    .select("session_id, planning_request_id, status, created_at, session_data")
    .eq("organization_id", workspace.organization.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (sessionError) throw new Error(sessionError.message);
  
  // Combine both V1 jobs and V2 sessions. Map V2 sessions to look like jobs for the UI list.
  const mappedSessions = (sessions || []).map((s: any) => {
    const data = s.session_data || {};
    return {
      job_id: s.session_id, // Reuse job_id field for session_id to satisfy frontend
      session_id: s.session_id,
      sku_name: data.skuName || data.skuId || "Unknown",
      status: s.status,
      model: "V2 Node Graph",
      provider: "Antigravity Node Engine",
      actual_cost_usd: 0,
      started_at: s.created_at,
      batch_id: s.planning_request_id, // Close enough for the list UI
      current_pose: null,
      is_v2: true
    };
  });

  const combined = [...(jobs || []), ...mappedSessions].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()).slice(0, 50);

  return { jobs: combined };
}

async function historyGenerationFlowGet(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request);
  
  const jobId = String(args.jobId || "");
  if (!jobId) throw new Error("jobId is required.");

  const operationalWorkflow = await getCatalogWorkflowDetail(service, workspace, { jobId });
  if (operationalWorkflow) return operationalWorkflow;

  if (jobId.startsWith("session_")) {
    const [session, nodes, edges] = await Promise.all([
      service.from("catalog_sessions").select("*").eq("session_id", jobId).eq("organization_id", workspace.organization.id).single(),
      service.from("generation_flow_nodes").select("*").eq("session_id", jobId).order("created_at"),
      service.from("generation_flow_edges").select("*").eq("session_id", jobId)
    ]);
    
    if (session.error) throw new Error("Session not found.");
    if (nodes.error) throw new Error(nodes.error.message);
    if (edges.error) throw new Error(edges.error.message);
    
    return {
      is_v2: true,
      session: session.data,
      nodes: nodes.data || [],
      edges: edges.data || []
    };
  }

  const { data: job, error: jobError } = await service.from("generation_jobs").select("*").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (jobError || !job) throw new Error("Job not found.");
  
  if (!workspace.isAdmin && !workspace.permissions.includes("admin.settings") && job.user_id !== workspace.user.firebaseUid) {
    throw new Error("You do not have permission to view diagnostics for this job.");
  }

  const [session, poses, aiRuns, qaReviews, learning] = await Promise.all([
    service.from("catalog_sessions").select("*").eq("session_id", job.session_id).maybeSingle(),
    service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index"),
    service.from("ai_runs").select("*").eq("job_id", jobId).order("created_at"),
    service.from("qa_reviews").select("*").eq("generation_job_id", jobId).order("created_at"),
    service.from("generation_learnings").select("*").eq("job_id", jobId).order("created_at", { ascending: false })
  ]);

  for (const result of [session, poses, aiRuns, qaReviews, learning]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    summary: job,
    session: session.data?.session_data ?? null,
    poses: poses.data || [],
    aiRuns: aiRuns.data || [],
    qaReviews: qaReviews.data || [],
    learnings: learning.data || [],
    learning: learning.data?.[0] ?? null,
  };
}

async function adminGenerationFlowGet(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request);
  if (!workspace.isAdmin && !workspace.permissions.includes("admin.settings")) throw new Error("You do not have access to the admin console.");
  
  const jobId = String(args.jobId || "");
  if (!jobId) throw new Error("jobId is required.");

  if (jobId.startsWith("session_")) {
    const [session, nodes, edges] = await Promise.all([
      service.from("catalog_sessions").select("*").eq("session_id", jobId).eq("organization_id", workspace.organization.id).single(),
      service.from("generation_flow_nodes").select("*").eq("session_id", jobId).order("created_at"),
      service.from("generation_flow_edges").select("*").eq("session_id", jobId)
    ]);
    
    if (session.error) throw new Error("Session not found.");
    if (nodes.error) throw new Error(nodes.error.message);
    if (edges.error) throw new Error(edges.error.message);
    
    return {
      is_v2: true,
      session: session.data,
      nodes: nodes.data || [],
      edges: edges.data || []
    };
  }

  const { data: job, error: jobError } = await service.from("generation_jobs").select("*").eq("job_id", jobId).eq("org_id", workspace.organization.id).single();
  if (jobError || !job) throw new Error("Job not found.");

  const [session, poses, aiRuns, qaReviews, learning] = await Promise.all([
    service.from("catalog_sessions").select("*").eq("session_id", job.session_id).maybeSingle(),
    service.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index"),
    service.from("ai_runs").select("*").eq("job_id", jobId).order("created_at"),
    service.from("qa_reviews").select("*").eq("generation_job_id", jobId).order("created_at"),
    service.from("generation_learnings").select("*").eq("job_id", jobId).order("created_at", { ascending: false })
  ]);

  for (const result of [session, poses, aiRuns, qaReviews, learning]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    summary: job,
    session: session.data?.session_data ?? null,
    poses: poses.data || [],
    aiRuns: aiRuns.data || [],
    qaReviews: qaReviews.data || [],
    learnings: learning.data || [],
    learning: learning.data?.[0] ?? null,
  };
}

async function adminOverview(request: Request) {
  const { workspace } = await workspaceFor(request);
  if (!workspace.isAdmin && !workspace.permissions.some((permission) => permission.startsWith("admin."))) throw new Error("You do not have access to the admin console.");
  const orgId = workspace.organization.id;
  const [membersResult, rolesResult, permissionsResult, rolePermissionsResult, memberRolesResult, teamsResult, teamMembershipsResult, auditsResult, automationResult, deliveriesResult, usageResult, aiRunsResult] = await Promise.all([
    service.from("organization_members").select("*").eq("organization_id", orgId).order("display_name"),
    service.from("roles").select("*").eq("organization_id", orgId).order("name"),
    service.from("permissions").select("*").order("module").order("key"),
    service.from("role_permissions").select("*"),
    service.from("member_roles").select("*"),
    service.from("organization_teams").select("*").eq("organization_id", orgId).order("active", { ascending: false }).order("name"),
    service.from("organization_team_memberships").select("*").eq("organization_id", orgId),
    service.from("audit_logs").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(30),
    service.from("event_automation_settings").select("*").eq("organization_id", orgId).maybeSingle(),
    service.from("event_email_deliveries").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(10),
    service.from("openai_usage_daily").select("usage_date,image_count,request_count,actual_cost_usd,synced_at").eq("organization_id", orgId).order("usage_date", { ascending: false }).limit(100),
    service.from("ai_runs").select("job_id, session_id, pose_index, run_kind, provider, model, input_tokens, output_tokens, cost_usd, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(200),
  ]);
  for (const result of [membersResult, rolesResult, permissionsResult, rolePermissionsResult, memberRolesResult, teamsResult, teamMembershipsResult, auditsResult, automationResult, deliveriesResult, usageResult, aiRunsResult]) if (result.error) throw new Error(result.error.message);
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
  const teams = (teamsResult.data || []).map((team) => ({
    ...team,
    memberships: (teamMembershipsResult.data || [])
      .filter((membership) => membership.team_id === team.id && membership.active)
      .map((membership) => ({
        ...membership,
        member: members.find((member) => member.id === membership.member_id) || null,
      }))
      .sort((left, right) => {
        if (left.membership_role !== right.membership_role) return left.membership_role === "lead" ? -1 : 1;
        return String(left.member?.display_name || "").localeCompare(String(right.member?.display_name || ""));
      }),
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
    members, roles, teams, permissions, recentAuditLogs: auditsResult.data || [],
    automationSettings: automationResult.data,
    recentEventDeliveries: deliveriesResult.data || [],
    openaiUsage: {
      images: (usageResult.data || []).reduce((total, row) => total + Number(row.image_count || 0), 0),
      requests: (usageResult.data || []).reduce((total, row) => total + Number(row.request_count || 0), 0),
      costUsd: (usageResult.data || []).reduce((total, row) => total + Number(row.actual_cost_usd || 0), 0),
      lastSyncedAt: (usageResult.data || []).map((row) => row.synced_at).filter(Boolean).sort().at(-1) || null,
    },
    recentAiRuns: aiRunsResult.data || [],
  };
}

async function ensureRoles(orgId: string, roleIds: string[]) {
  if (!roleIds.length) throw new Error("Select at least one valid role.");
  const { data: roles, error } = await service.from("roles").select("*").eq("organization_id", orgId).in("id", roleIds);
  if (error || !roles || roles.length !== new Set(roleIds).size) throw new Error("One or more selected roles are invalid.");
  return roles;
}

async function upsertOrganizationTeamOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "admin.users.manage");
  const orgId = workspace.organization.id;
  const teamId = String(args.teamId || "").trim();
  const name = String(args.name || "").trim().replace(/\s+/g, " ");
  const description = String(args.description || "").trim().slice(0, 500);
  const teamType = ["planning", "generation", "review", "listing", "general"].includes(String(args.teamType))
    ? String(args.teamType)
    : "general";
  const active = args.active !== false;
  const memberIds = [...new Set((Array.isArray(args.memberIds) ? args.memberIds : []).map(String).filter(Boolean))];
  const requestedLeadMemberId = String(args.leadMemberId || "").trim();
  const leadMemberId = active && requestedLeadMemberId ? requestedLeadMemberId : null;
  if (name.length < 2 || name.length > 100) throw new Error("Team name must contain between 2 and 100 characters.");
  if (teamId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(teamId)) throw new Error("Choose a valid organization team.");
  if (leadMemberId && !memberIds.includes(leadMemberId)) throw new Error("The team lead must also be selected as a team member.");

  let slug = slugify(name).slice(0, 80).replace(/-+$/g, "");
  if (!slug) throw new Error("Team name must contain at least one letter or number.");
  if (teamId) {
    const { data: current, error: currentError } = await service.from("organization_teams")
      .select("id,slug,is_system").eq("organization_id", orgId).eq("id", teamId).maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) throw new Error("Organization team not found.");
    if (current.is_system && !active) throw new Error("Built-in workflow teams cannot be archived.");
    slug = String(current.slug);
  }

  const effectiveMemberIds = active ? memberIds : [];
  if (effectiveMemberIds.length) {
    const { data: members, error: membersError } = await service.from("organization_members")
      .select("id").eq("organization_id", orgId).eq("status", "active").in("id", effectiveMemberIds);
    if (membersError) throw new Error(membersError.message);
    if ((members || []).length !== effectiveMemberIds.length) throw new Error("Every team member must be active in this workspace.");
  }

  const { data: savedTeamId, error } = await service.rpc("upsert_organization_team", {
    p_organization_id: orgId,
    p_team_id: teamId || null,
    p_name: name,
    p_slug: slug,
    p_description: description,
    p_team_type: teamType,
    p_active: active,
    p_member_ids: effectiveMemberIds,
    p_lead_member_id: leadMemberId,
    p_actor_member_id: workspace.member.id,
    p_actor_email: workspace.user.email,
  });
  if (error) {
    if (error.code === "23505") throw new Error("A team with this name already exists in the workspace.");
    throw new Error(error.message);
  }
  return { success: true, teamId: String(savedTeamId), memberCount: effectiveMemberIds.length };
}

async function countActiveAdmins(orgId: string) {
  const { data: adminRole, error: adminRoleError } = await service.from("roles").select("id").eq("organization_id", orgId).eq("slug", "admin").maybeSingle();
  if (adminRoleError) throw new Error(adminRoleError.message);
  if (!adminRole) return 0;
  const { data: links, error: linksError } = await service.from("member_roles").select("member_id").eq("role_id", adminRole.id);
  if (linksError) console.error(linksError.message);
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
    if (roleError) console.error(roleError.message);
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
  const { data: member, error: memberError } = await service.from("organization_members").select("*").eq("id", memberId).eq("organization_id", workspace.organization.id).single();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("Organization member not found.");
  if (member.id === workspace.member.id && status !== "active") throw new Error("You cannot disable your own administrator account.");
  const { data: currentLinks, error: currentLinksError } = await service.from("member_roles").select("role_id,roles(slug)").eq("member_id", memberId);
  if (currentLinksError) console.error(currentLinksError.message);
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
  const { data: member, error } = await service.from("organization_members").select("profile,notification_preferences").eq("id", workspace.member.id).eq("organization_id", workspace.organization.id).single();
  if (error || !member) throw new Error("Your organization profile could not be loaded.");
  const currentProfile = member.profile && typeof member.profile === "object" ? member.profile as JsonRecord : {};
  const currentNotifications = member.notification_preferences && typeof member.notification_preferences === "object" ? member.notification_preferences as JsonRecord : {};
  const notificationPreferences = {
    ...currentNotifications,
    catalog_assignments_in_app: args.catalogAssignmentsInApp !== false,
    catalog_handoff_email: args.catalogHandoffEmail !== false,
  };
  const updatedAt = new Date().toISOString();
  const [, memberUpdate, preferenceUpdate, auditInsert] = await Promise.all([
    updateFirebaseUser({ uid: workspace.user.firebaseUid, displayName }),
    service.from("organization_members").update({
      display_name: displayName,
      profile: { ...currentProfile, jobTitle, phone },
      notification_preferences: notificationPreferences,
      updated_at: updatedAt,
    }).eq("id", workspace.member.id).eq("organization_id", workspace.organization.id),
    service.from("organization_member_notification_preferences").upsert({
      organization_id: workspace.organization.id,
      member_id: workspace.member.id,
      catalog_assignments_in_app: notificationPreferences.catalog_assignments_in_app,
      catalog_handoff_email: notificationPreferences.catalog_handoff_email,
      updated_by_member_id: workspace.member.id,
      updated_at: updatedAt,
    }, { onConflict: "organization_id,member_id" }),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
      action: "profile.updated", resource_type: "organization_member", resource_id: workspace.member.id,
      metadata: { changed: ["displayName", "jobTitle", "phone", "catalogAssignmentsInApp", "catalogHandoffEmail"] },
    }),
  ]);
  if (memberUpdate.error) throw new Error(memberUpdate.error.message);
  if (preferenceUpdate.error) throw new Error(preferenceUpdate.error.message);
  if (auditInsert.error) throw new Error(auditInsert.error.message);
  return { success: true, displayName, jobTitle, phone, notificationPreferences };
}

async function deleteMemberOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "admin.users.manage");
  const memberId = String(args.memberId || "");
  if (memberId === workspace.member.id) throw new Error("You cannot delete your own administrator account.");
  const { data: member, error: memberError } = await service.from("organization_members").select("*").eq("id", memberId).eq("organization_id", workspace.organization.id).single();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("Organization member not found.");
  const { data: links, error: linksError } = await service.from("member_roles").select("role_id,roles(slug)").eq("member_id", memberId);
  if (linksError) console.error(linksError.message);
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
  const { data: role, error: roleError } = await service.from("roles").select("*").eq("id", roleId).eq("organization_id", workspace.organization.id).single();
  if (roleError) throw new Error(roleError.message);
  if (!role) throw new Error("Role not found.");
  if (role.slug === "admin") throw new Error("The Admin role always has full access and cannot be restricted.");
  const { data: permissions, error: permissionsError } = await service.from("permissions").select("id,key").in("key", keys);
  if (permissionsError) console.error(permissionsError.message);
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

async function assertActiveCatalogMembers(orgId: string, memberIds: unknown[]) {
  const uniqueIds = [...new Set(memberIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!uniqueIds.length) return;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uniqueIds.some((id) => !uuid.test(id))) throw new Error("One or more selected catalog owners are invalid.");
  const { data, error } = await service.from("organization_members").select("id")
    .eq("organization_id", orgId).eq("status", "active").in("id", uniqueIds);
  if (error) throw new Error(error.message);
  if ((data || []).length !== uniqueIds.length) throw new Error("Every catalog owner must be an active member of this workspace.");
}

async function assertCatalogEvent(orgId: string, eventId: unknown) {
  const id = String(eventId || "").trim();
  if (!id) return;
  const { data, error } = await service.from("marketing_events").select("id")
    .eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The selected campaign event does not belong to this workspace.");
}

function optionalCatalogTimestamp(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const raw = typeof value === "number" || /^\d+$/.test(String(value)) ? Number(value) : String(value);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return date.toISOString();
}

// Best-effort cleanup for the batch-level reference entries mutate_planning_batch_reference_images
// just replaced or removed from planning_batches.reference_images. A failure here never rolls
// back or blocks the reference-image update that already committed - it only leaves an orphaned
// object. Existing Firebase references and new Supabase references share this cleanup path.
async function cleanupOrphanedBatchReferences(orgId: string, removed: unknown) {
  const entries = Array.isArray(removed) ? removed as JsonRecord[] : [];
  const assetsByPath = new Map<string, { storagePath: string; storageBackend: string }>();
  for (const entry of entries) {
    const storagePath = String(entry.storagePath || entry.storage_path || "");
    if (storagePath) assetsByPath.set(storagePath, { storagePath, storageBackend: String(entry.storageProvider || entry.storageBackend || entry.storage_backend || "firebase") });
  }
  const assets = [...assetsByPath.values()];
  if (!assets.length) return;
  const results = await Promise.allSettled(assets.map((asset) => deleteCatalogObject(orgId, asset.storagePath, asset.storageBackend)));
  const failures = results.filter((result) => result.status === "rejected").length;
  if (failures) console.warn(`Could not delete ${failures} orphaned catalog reference object(s) from catalog storage.`);
}

async function saveReferenceOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request);
  if (!hasAnyPermission(workspace, ["studio.generate", "planning.manage"])) throw new Error("You do not have permission to upload product references.");
  const batchId = String(args.catalogId || "");
  const role = String(args.role || "reference");
  const storageProvider = ["firebase", "supabase", "external"].includes(String(args.storageProvider))
    ? String(args.storageProvider) as CatalogStorageBackend
    : "firebase";
  const reference = {
    id: crypto.randomUUID(), role, downloadUrl: String(args.downloadUrl || ""), storagePath: String(args.storagePath || ""),
    hash: String(args.hash || ""), filename: String(args.filename || "reference.jpg"), mimeType: String(args.mimeType || "image/jpeg"),
    size: Number(args.size || 0), storageProvider,
  };
  assertCatalogReferenceOwnership(workspace.organization.id, { ...reference, storageBackend: storageProvider });
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
    scheduleBackground(cleanupOrphanedBatchReferences(workspace.organization.id, removed));
    // The batch memory holds the scene, model and anchor frame derived from the
    // previous references, and applyCatalogMemory replays it over every later
    // analysis. Leaving it in place is why uploading a new reference appeared to
    // change nothing: the catalog kept photographing the old set.
    await Promise.all([
      service.from("planning_requests").update({ analysis_status: "stale", updated_at: new Date().toISOString() }).eq("batch_id", batchId).not("front_image_url", "is", null).not("back_image_url", "is", null),
      service.from("planning_batches").update({ catalog_memory: {}, memory_source_request_id: null, memory_updated_at: null }).eq("id", batchId),
    ]);
    scheduleBackground(kickCatalogPreflight(batchId));
    return `${role}:${reference.id}`;
  }
  const { data: planningRequest, error: planningRequestError } = await service.from("planning_requests").select("id").eq("batch_id", batchId).eq("sku_name", String(args.skuId || "")).maybeSingle();
  if (planningRequestError) throw new Error(planningRequestError.message);
  if (!planningRequest) throw new Error("The catalog colourway was not found for this upload.");
  const { data: asset, error } = await service.from("planning_assets").insert({
    organization_id: workspace.organization.id, planning_request_id: planningRequest.id, sku_name: String(args.skuId || ""), prompt: "",
    image_url: reference.downloadUrl, storage_path: reference.storagePath, sku_matched: true, asset_role: role,
    storage_backend: reference.storageProvider, metadata: reference,
  }).select("id").single();
  if (error || !asset) throw new Error(error?.message || "Could not save the product reference.");
  return asset.id;
}

async function createCatalogOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const name = String(args.name || "").trim();
  if (!name) throw new Error("A catalog name is required.");
  await Promise.all([
    assertActiveCatalogMembers(workspace.organization.id, [args.generationAssignedMemberId, args.listingAssignedMemberId]),
    assertCatalogEvent(workspace.organization.id, args.eventId),
  ]);
  const now = new Date().toISOString();
  const deadlineAt = optionalCatalogTimestamp(args.deadlineAt, "Listing deadline");
  const preferredGenerationAt = optionalCatalogTimestamp(args.preferredGenerationAt, "Preferred generation time");
  const generationSettings = {
    modelDirection: String(args.modelDirection || ""), sceneDirection: String(args.sceneDirection || ""),
    category: String(args.category || "ethnic/fusion"), aspectRatio: String(args.aspectRatio || "3:4"),
    imageSize: String(args.imageSize || "2K"), quality: "medium", poseQa: args.poseQa !== false,
    lookAndMood: String(args.lookAndMood || ""), stylingRequirements: String(args.stylingRequirements || ""),
    lighting: String(args.lighting || ""), composition: String(args.composition || ""),
    poseDirection: String(args.poseDirection || ""),
    marketplaceRequirements: String(args.marketplaceRequirements || ""),
    marketplaces: Array.isArray(args.marketplaces) ? args.marketplaces.map(String).filter(Boolean).slice(0, 20) : [],
    specialInstructions: String(args.specialInstructions || ""), deadlineAt,
    listingAssignedMemberId: args.listingAssignedMemberId || null,
  };
  const { data, error } = await service.from("planning_batches").insert({
    organization_id: workspace.organization.id, batch_code: `CAT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, name,
    total_skus: 0, generated_count: 0, pending_count: 0, failed_count: 0, status: "active", created_by_member_id: workspace.member.id,
    catalog_key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), queue_status: "idle",
    campaign_season: String(args.campaign || ""), scheduled_at: preferredGenerationAt,
    schedule_status: "none", source_event_id: args.eventId || null, event_id: args.eventId || null, generation_settings: generationSettings,
    priority: ["low", "normal", "high", "urgent"].includes(String(args.priority)) ? String(args.priority) : "normal",
    assigned_member_id: args.generationAssignedMemberId || null,
    created_at: now, updated_at: now,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message || "Could not create the catalog.");
  return data.id;
}

async function bulkAddVariantsOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const batchId = String(args.catalogId || "");
  const batch = await catalogBatch(workspace, batchId);
  const variants = Array.isArray(args.variants) ? args.variants as JsonRecord[] : [];
  if (!variants.length) return { created: 0 };
  if (variants.length > 1_000) throw new Error("A catalog can add at most 1,000 SKUs in one request.");
  const { data: existing, error: existingError } = await service.from("planning_requests").select("sku_name").eq("batch_id", batchId);
  if (existingError) throw new Error(existingError.message);
  const existingSkus = new Set((existing || []).map((row) => String(row.sku_name).toLowerCase()));
  const clean: JsonRecord[] = [];
  for (const variant of variants) {
    const sku = String(variant.sku || "").trim();
    const normalizedSku = sku.toLowerCase();
    if (!sku || existingSkus.has(normalizedSku)) continue;
    existingSkus.add(normalizedSku);
    clean.push(variant);
  }
  if (!clean.length) return { created: 0 };
  const basePosition = existing?.length || 0;
  const settings = (batch.generation_settings || {}) as JsonRecord;
  const defaultPriority = ["low", "normal", "high", "urgent"].includes(String(args.priority || batch.priority)) ? String(args.priority || batch.priority) : "normal";
  const defaultAssignee = args.generationAssignedMemberId || batch.assigned_member_id || null;
  await assertActiveCatalogMembers(workspace.organization.id, [
    defaultAssignee,
    ...clean.map((variant) => variant.generationAssignedMemberId),
  ]);
  const defaultNotes = String(args.specialInstructions || settings.specialInstructions || "");
  const deadlineAt = optionalCatalogTimestamp(args.deadlineAt || settings.deadlineAt, "Listing deadline");
  const { error } = await service.from("planning_requests").insert(clean.map((variant, index) => ({
    organization_id: workspace.organization.id, created_by_member_id: workspace.member.id, batch_id: batchId,
    sku_name: String(variant.sku).trim(), color_label: String(variant.colorLabel || ""), product_description: "",
    photoshoot_type: "catalog_colourway_5_pose", category: "", status: "draft", request_code: `SKU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    generation_status: "pending", completion_status: "pending", validation_status: "pending", queue_position: basePosition + index + 1,
    priority: ["low", "normal", "high", "urgent"].includes(String(variant.priority)) ? String(variant.priority) : defaultPriority,
    assigned_member_id: variant.generationAssignedMemberId || defaultAssignee,
    notes: String(variant.specialInstructions || defaultNotes),
    expected_shoot_date: deadlineAt ? deadlineAt.slice(0, 10) : null,
  })));
  if (error) throw new Error(error.message);
  const total = basePosition + clean.length;
  await service.from("planning_batches").update({ total_skus: total, pending_count: total, updated_at: new Date().toISOString() }).eq("id", batchId);
  return { created: clean.length };
}

async function setVariantReferencesOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const requestId = String(args.skuId || "");
  const { data: variant, error: variantError } = await service.from("planning_requests").select("*").eq("id", requestId).eq("organization_id", workspace.organization.id).single();
  if (variantError) throw new Error(variantError.message);
  if (!variant) throw new Error("Colourway not found.");
  const roleArgs: Array<[string, string, string]> = [
    ["frontReferenceId", "front_image_url", "front_image_path"], ["backReferenceId", "back_image_url", "back_image_path"],
    ["fabricPatternReferenceId", "", ""], ["additionalProductReferenceId", "", ""],
    ["sareeFrontDrapeReferenceId", "front_image_url", "front_image_path"], ["sareeBackDrapeReferenceId", "back_image_url", "back_image_path"],
    ["sareeBodyDetailReferenceId", "", ""], ["sareePalluSpreadReferenceId", "", ""],
    ["sareeBorderTasselsReferenceId", "", ""], ["sareeBlouseFrontReferenceId", "", ""], ["sareeBlouseBackPieceReferenceId", "", ""],
  ];
  if (args.referenceId) roleArgs.push(["referenceId", "", ""]);
  const patch: JsonRecord = { updated_at: new Date().toISOString() };
  for (const [key, urlColumn, pathColumn] of roleArgs) {
    if (!args[key]) continue;
    const { data: asset, error: assetError } = await service.from("planning_assets").select("*").eq("id", String(args[key])).eq("planning_request_id", requestId).single();
    if (assetError) throw new Error(assetError.message);
    if (!asset) throw new Error("Uploaded reference not found.");
    const resolvedUrlColumn = urlColumn || (asset.asset_role === "saree_front_drape" ? "front_image_url" : asset.asset_role === "saree_back_drape" ? "back_image_url" : "");
    const resolvedPathColumn = pathColumn || (asset.asset_role === "saree_front_drape" ? "front_image_path" : asset.asset_role === "saree_back_drape" ? "back_image_path" : "");
    if (resolvedUrlColumn) patch[resolvedUrlColumn] = asset.image_url;
    if (resolvedPathColumn) patch[resolvedPathColumn] = asset.storage_path;
  }
  const front = String(patch.front_image_url || variant.front_image_url || "");
  const back = String(patch.back_image_url || variant.back_image_url || "");
  const { data: referenceAssets, error: referenceAssetsError } = await service.from("planning_assets").select("asset_role,image_url,storage_path").eq("planning_request_id", requestId).in("asset_role", [...PRODUCT_REFERENCE_ROLES]);
  if (referenceAssetsError) throw new Error(referenceAssetsError.message);
  const inputRoles = (referenceAssets || []).map((asset) => ({
    role: String(asset.asset_role), downloadUrl: String(asset.image_url || ""), storagePath: String(asset.storage_path || ""), hash: "", filename: "", mimeType: "", size: 0,
  }));
  const missingReferences = missingRequiredReferenceLabels(inputRoles, isSareeReferenceSet(inputRoles) ? "saree" : String(variant.category || ""));
  const referencesReady = missingReferences.length === 0 && Boolean(front && back);
  patch.validation_status = referencesReady ? "ready" : "pending";
  patch.validation_report = referencesReady ? { ready: true, reasons: [] } : { ready: false, reasons: missingReferences.map((label) => `${label} image is required.`) };
  patch.analysis_status = referencesReady ? "stale" : "pending";
  patch.analysis_fingerprint = "";
  const { error } = await service.from("planning_requests").update(patch).eq("id", requestId);
  if (error) throw new Error(error.message);
  if (referencesReady) {
    const batchId = String(variant.batch_id || "");
    scheduleBackground(kickCatalogPreflight(batchId, requestId));
    const [{ data: batch }, { data: batchVariants }] = await Promise.all([
      service.from("planning_batches").select("scheduled_at,schedule_status").eq("id", batchId).maybeSingle(),
      service.from("planning_requests").select("validation_status").eq("batch_id", batchId),
    ]);
    const allReady = Boolean(batchVariants?.length) && (batchVariants || []).every((entry) => entry.validation_status === "ready");
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
  const { data: variant, error: variantError } = await service.from("planning_requests").select("batch_id,status").eq("id", requestId).eq("organization_id", workspace.organization.id).single();
  if (variantError) throw new Error(variantError.message);
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
  scheduleBackground(cleanupOrphanedBatchReferences(workspace.organization.id, removed));
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
  const { data: variants, error: variantsError } = await service.from("planning_requests").select("id,front_image_url,back_image_url").eq("batch_id", batchId);
  if (variantsError) console.error(variantsError.message);
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

async function deleteCatalogOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const batchId = String(args.catalogId || "");
  // Ensure the batch belongs to this workspace before deleting
  const batch = await catalogBatch(workspace, batchId);
  
  if (String(batch.queue_status) === "running") throw new Error("A catalog that is currently scheduling cannot be deleted. Wait for it to finish or stall.");
  
  // Check for active generation jobs that might be currently running in workers
  const { data: activeJobs, error: activeJobsError } = await service.from("generation_jobs").select("id").eq("batch_id", batchId).in("status", ["queued", "processing"]).limit(1);
  if (activeJobsError) console.error(activeJobsError.message);
  if (activeJobs && activeJobs.length > 0) {
    throw new Error("This catalog currently has active generation jobs. Please cancel them in the History tab before deleting.");
  }
  
  // Delete all associated generation jobs to prevent orphaned job history
  const { error: jobsError } = await service.from("generation_jobs").delete().eq("batch_id", batchId);
  if (jobsError) console.error("Could not delete associated jobs: " + jobsError.message);
  
  // Delete all colorway requests
  const { error: requestsError } = await service.from("planning_requests").delete().eq("batch_id", batchId);
  if (requestsError) console.error("Could not delete associated requests: " + requestsError.message);
  
  const { error } = await service.from("planning_batches").delete().eq("id", batchId);
  if (error) throw new Error("Could not delete catalog: " + error.message);
  return { success: true };
}

async function stopCatalogGenerationOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const batchId = String(args.catalogId || "");
  await catalogBatch(workspace, batchId);
  
  const b = await service.from("planning_batches").update({ queue_status: "idle", updated_at: new Date().toISOString() }).eq("id", batchId);
  if (b.error) throw new Error(b.error.message);

  const j = await service.from("generation_jobs").update({ status: "cancelled", error_message: "Force stopped from Planning tab.", updated_at: new Date().toISOString() }).eq("batch_id", batchId).in("status", ["queued", "processing"]);
  if (j.error) throw new Error(j.error.message);

  const r = await service.from("planning_requests").update({ generation_status: "failed", error_message: "Force stopped from Planning tab.", updated_at: new Date().toISOString() }).eq("batch_id", batchId).in("generation_status", ["pending", "processing"]);
  if (r.error) throw new Error(r.error.message);
  
  return { success: true };
}

async function retryVariantOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const requestId = String(args.skuId || "");
  const { data: variant, error: variantError } = await service.from("planning_requests").select("batch_id,retry_count").eq("id", requestId).eq("organization_id", workspace.organization.id).single();
  if (variantError) throw new Error(variantError.message);
  if (!variant) throw new Error("Colourway not found.");
  await service.from("planning_requests").update({ status: "draft", generation_status: "pending", completion_status: "pending", error_message: "", retry_count: Number(variant.retry_count || 0) + 1, updated_at: new Date().toISOString() }).eq("id", requestId);
  scheduleBackground(kickCatalogProcessor(variant.batch_id));
  return { success: true };
}

async function analyzeCatalogVariant(batch: JsonRecord, variant: JsonRecord, references: ReferenceInput[]) {
  const loaded = await loadAvailableReferences(references, String(batch.organization_id));
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
    housePreferences: await stylingPreferenceBrief(String(batch.organization_id), String(settings.category || variant.category || "ethnic/fusion")),
  }) });
  const policy = resolveGeminiPolicy({ purpose: "product_truth", garmentFamily: String(settings.category || variant.category || "ethnic/fusion") });
  const result = await geminiJson(policy, parts);
  const normalized = normalizeAnalysis(result.json, String(settings.category || variant.category || "ethnic/fusion"));
  return applyCatalogMemory(batch, normalized);
}

async function catalogReferenceInputs(batch: JsonRecord, variant: JsonRecord) {
  const { data: assets, error: assetsError } = await service.from("planning_assets").select("*").eq("planning_request_id", variant.id).order("created_at");
  if (assetsError) console.error(assetsError.message);
  const productRefs: ReferenceInput[] = (assets || [])
    .filter((asset) => (PRODUCT_REFERENCE_ROLES as readonly string[]).includes(asset.asset_role))
    .map((asset) => ({
      id: asset.id, role: asset.asset_role, downloadUrl: asset.image_url, storagePath: asset.storage_path, storageBackend: asset.storage_backend as CatalogStorageBackend,
      hash: String((asset.metadata as JsonRecord)?.hash || asset.id), filename: String((asset.metadata as JsonRecord)?.filename || `${asset.asset_role}.jpg`),
      mimeType: String((asset.metadata as JsonRecord)?.mimeType || "image/jpeg"), size: Number((asset.metadata as JsonRecord)?.size || 0),
    }));
  for (const [role, urlKey, pathKey] of [
    ["front", "front_image_url", "front_image_path"],
    ["back", "back_image_url", "back_image_path"],
  ] as const) {
    if (productRefs.some((reference) => reference.role === role)) continue;
    const downloadUrl = String(variant[urlKey] || "");
    const storagePath = String(variant[pathKey] || "");
    if (!downloadUrl && !storagePath) continue;
    productRefs.push({
      id: `${variant.id}:${role}`,
      role,
      downloadUrl,
      storagePath,
      storageBackend: "firebase",
      hash: smallHash(`${downloadUrl}|${storagePath}`),
      filename: `${role}.jpg`,
      mimeType: "image/jpeg",
      size: 0,
    });
  }
  // batch.reference_images holds every batch-level shared reference (style_reference and, now,
  // model_identity) tagged with its own role - preserve that tag instead of collapsing
  // everything to "style_reference", or a model-identity upload would silently be treated as
  // creative direction only and never reach the FACE & IDENTITY LOCK in the generation prompt.
  const sharedRefs: ReferenceInput[] = (Array.isArray(batch.reference_images) ? batch.reference_images as JsonRecord[] : []).map((entry) => ({
    id: String(entry.id || ""), role: String(entry.role || "style_reference"), downloadUrl: String(entry.downloadUrl || entry.image_url || ""), storagePath: String(entry.storagePath || entry.storage_path || ""), storageBackend: String(entry.storageProvider || entry.storageBackend || entry.storage_backend || "firebase") as CatalogStorageBackend,
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
  // The catalogue's approved styling plan outranks whatever this SKU's own
  // analysis proposed: one catalogue is one stylist's set of decisions, and a
  // per-SKU proposal is exactly the drift the plan exists to prevent.
  if (memory.stylingPlan) normalized.stylingPlan = normalizeStylingPlan(memory.stylingPlan);
  if (Array.isArray(memory.posePlan) && memory.posePlan.length > 0) {
    const memoryPoses = memory.posePlan as StudioPose[];
    normalized.posePlan = normalized.posePlan.map(skuPose => {
      const catPose = memoryPoses.find(p => p.id === skuPose.id);
      if (!catPose) return skuPose;
      // Lock shared shoot identity but preserve SKU-specific facts (visibility, reference, details)
      return {
        ...skuPose,
        framing: catPose.framing !== undefined ? catPose.framing : skuPose.framing,
        cameraAngle: catPose.cameraAngle !== undefined ? catPose.cameraAngle : skuPose.cameraAngle,
        bodyPosition: catPose.bodyPosition !== undefined ? catPose.bodyPosition : skuPose.bodyPosition,
        expression: catPose.expression !== undefined ? catPose.expression : skuPose.expression,
        consistencyNotes: catPose.consistencyNotes !== undefined ? catPose.consistencyNotes : skuPose.consistencyNotes,
        purpose: catPose.purpose !== undefined ? catPose.purpose : skuPose.purpose,
      };
    });
  }
  return normalized;
}

async function proposeCatalogStylingPlan(batchId: string, _batch: JsonRecord, stylingPlan: StylingPlanProfile, variantId: string) {
  // Guarded in the database, not here: two colourways can reach preflight at the
  // same time, and a read-then-write would let the second overwrite the first
  // one's proposal - or clobber an anchor frame recorded in between.
  const { error } = await service.rpc("merge_catalog_memory", {
    p_batch_id: batchId,
    p_patch: {
      stylingPlan,
      // Kept unedited alongside the working copy: comparing what the AI proposed
      // with what the stylist approved is the raw material the memory needs, and
      // it is unrecoverable once the plan is edited in place.
      stylingPlanProposed: stylingPlan,
      stylingPlanProposedAt: new Date().toISOString(),
      stylingPlanSourceRequestId: variantId,
    },
    p_require_absent: "stylingPlan",
  });
  if (error) throw new Error(error.message);
}

const STYLING_FIELDS: Array<keyof StylingPlanProfile> = ["footwear", "jewellery", "ornaments", "makeup", "hair", "stylingNotes", "themeInterpretation"];

function stylingPlanDiff(proposed: StylingPlanProfile, approved: StylingPlanProfile) {
  return STYLING_FIELDS.filter((field) => String(proposed[field] || "").trim() !== String(approved[field] || "").trim());
}

async function recordStylingDecision(args: {
  orgId: string; scope: "studio" | "catalog"; batchId?: string | null; planningRequestId?: string | null;
  sessionId?: string; category: string; themeSummary: string; proposed: StylingPlanProfile; approved: StylingPlanProfile;
  approvedFlag: boolean; memberId: string;
}) {
  const changed = stylingPlanDiff(args.proposed, args.approved);
  const { error } = await service.from("styling_decisions").insert({
    organization_id: args.orgId, scope: args.scope, batch_id: args.batchId || null, planning_request_id: args.planningRequestId || null,
    session_id: args.sessionId || "", category: args.category || "", theme_summary: args.themeSummary.slice(0, 400),
    ai_plan: args.proposed, approved_plan: args.approved, changed_fields: changed, approved: args.approvedFlag,
    decided_by_member_id: args.memberId,
  });
  // Memory is an enhancement, never a reason to fail the stylist's save.
  if (error) console.error("Could not record the styling decision", error.message);
}

// Reads the memory back. Only fields a human actually rewrote are worth carrying
// forward - an unchanged proposal says nothing about preference - and only the
// most recent correction per field, so the brief stays a few hundred characters
// no matter how long the history grows.
async function stylingPreferenceBrief(orgId: string, category: string) {
  const { data, error } = await service.from("styling_decisions")
    .select("approved_plan,ai_plan,changed_fields,created_at")
    .eq("organization_id", orgId).eq("category", category).eq("approved", true)
    .order("created_at", { ascending: false }).limit(25);
  if (error || !data?.length) return "";
  const preferences: string[] = [];
  const counts = new Map<string, number>();
  for (const row of data) {
    for (const field of (row.changed_fields || []) as string[]) counts.set(field, (counts.get(field) || 0) + 1);
  }
  for (const field of STYLING_FIELDS) {
    if (!counts.get(field)) continue;
    const latest = data.find((row) => ((row.changed_fields || []) as string[]).includes(field));
    const approved = String(((latest?.approved_plan || {}) as JsonRecord)[field] || "").trim();
    const proposed = String(((latest?.ai_plan || {}) as JsonRecord)[field] || "").trim();
    if (!approved) continue;
    preferences.push(`- ${field}: the stylist has rewritten this ${counts.get(field)} time(s); most recently "${proposed.slice(0, 120)}" became "${approved.slice(0, 160)}".`);
  }
  return preferences.length ? preferences.join("\n") : "";
}

async function saveCatalogStylingPlanOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "planning.manage");
  const batch = await catalogBatch(workspace, String(args.catalogId || ""));
  const memory = (batch.catalog_memory || {}) as JsonRecord;
  const plan = normalizeStylingPlan(args.stylingPlan ?? memory.stylingPlan, { preserveEmpty: Boolean(args.stylingPlan) });
  const approve = args.approve === true;
  const now = new Date().toISOString();
  // Whether this save revokes approval is decided inside the database, under a row
  // lock: comparing against a snapshot here let an overlapping edit and approval
  // reach different conclusions and leave an unreviewed plan marked approved.
  const { data: saveResult, error: mergeError } = await service.rpc("save_catalog_styling_plan", {
    p_batch_id: batch.id, p_plan: plan, p_approve: approve, p_member_id: workspace.member.id,
  });
  if (mergeError) throw new Error(mergeError.message);
  if (!saveResult) throw new Error("Catalog not found.");
  const revokeApproval = Boolean((saveResult as JsonRecord).revoked);
  const update: JsonRecord = { updated_at: now };
  if (approve) {
    update.schedule_error = "";
    // Releasing the gate has to hand the batch back to whichever runner owns it:
    // the scheduler only claims rows still marked scheduled.
    if (batch.schedule_status === "awaiting_styling_approval") {
      update.schedule_status = batch.scheduled_at && Date.parse(String(batch.scheduled_at)) > Date.now() ? "scheduled" : "running";
    }
  }
  if (revokeApproval) {
    update.schedule_error = "Styling plan was edited. Approve it again to resume generating.";
  }
  const { error } = await service.from("planning_batches").update(update).eq("id", batch.id);
  if (error) throw new Error(error.message);
  await service.from("audit_logs").insert({
    organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
    action: approve ? "catalog.styling_plan.approved" : "catalog.styling_plan.updated",
    resource_type: "planning_batch", resource_id: String(batch.id),
    // Diffed against the memory the write itself returned, not the pre-read
    // snapshot, so the record matches what actually landed.
    metadata: { edited: stylingPlanDiff(normalizeStylingPlan(((saveResult as JsonRecord).memory as JsonRecord)?.stylingPlanProposed), plan), revoked: revokeApproval },
  });
  await recordStylingDecision({
    orgId: workspace.organization.id, scope: "catalog", batchId: String(batch.id),
    planningRequestId: memory.stylingPlanSourceRequestId ? String(memory.stylingPlanSourceRequestId) : null,
    category: String(((batch.generation_settings || {}) as JsonRecord).category || ""),
    themeSummary: plan.themeInterpretation,
    proposed: normalizeStylingPlan(((saveResult as JsonRecord).memory as JsonRecord)?.stylingPlanProposed),
    approved: plan, approvedFlag: approve, memberId: workspace.member.id,
  });
  if (approve) scheduleBackground(kickCatalogProcessor(String(batch.id)));
  return { success: true, stylingPlan: plan, approved: approve, approvalRevoked: revokeApproval };
}

async function updateSessionStylingPlanOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "studio.generate");
  const sessionId = String(args.sessionId || "");
  const { data: session, error: sessionError } = await service.from("catalog_sessions").select("*").eq("session_id", sessionId).eq("organization_id", workspace.organization.id).maybeSingle();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error("The generation session was not found.");
  if (!["ready", "analyzed"].includes(String(session.status || "ready"))) throw new Error("This session is already generating; regenerate a pose instead.");
  const sessionData = (session.session_data || {}) as JsonRecord;
  const plan = normalizeStylingPlan(args.stylingPlan ?? sessionData.stylingPlan, { preserveEmpty: Boolean(args.stylingPlan) });
  // Styling is not part of the product analysis, so the fingerprint stays put and
  // queueing still validates against the analysis the references produced.
  const { error } = await service.from("catalog_sessions").update({
    session_data: { ...sessionData, stylingPlan: plan, stylingPlanProposed: sessionData.stylingPlanProposed || sessionData.stylingPlan || plan, stylingPlanEditedAt: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq("session_id", sessionId);
  if (error) throw new Error(error.message);
  if (session.planning_request_id) {
    // Each column is patched from its own stored value: writing ai_analysis into
    // both would replace garment_analysis rather than update it.
    const { data: planningRequest, error: planningRequestError } = await service.from("planning_requests").select("ai_analysis,garment_analysis").eq("id", session.planning_request_id).maybeSingle();
    if (planningRequestError) throw new Error(planningRequestError.message);
    const analysis = (planningRequest?.ai_analysis || {}) as JsonRecord;
    const garment = (planningRequest?.garment_analysis || {}) as JsonRecord;
    if (Object.keys(analysis).length || Object.keys(garment).length) {
      await service.from("planning_requests").update({
        ...(Object.keys(analysis).length ? { ai_analysis: { ...analysis, stylingPlan: plan } } : {}),
        ...(Object.keys(garment).length ? { garment_analysis: { ...garment, stylingPlan: plan } } : {}),
        updated_at: new Date().toISOString(),
      }).eq("id", session.planning_request_id);
    }
  }
  await recordStylingDecision({
    orgId: workspace.organization.id, scope: "studio", planningRequestId: session.planning_request_id ? String(session.planning_request_id) : null,
    sessionId, category: String(sessionData.category || ""), themeSummary: plan.themeInterpretation,
    proposed: normalizeStylingPlan(sessionData.stylingPlanProposed || sessionData.stylingPlan || plan),
    approved: plan, approvedFlag: true, memberId: workspace.member.id,
  });
  return { success: true, stylingPlan: plan };
}

// A catalogue only waits when it actually has a plan to look at. Batches created
// before styling plans existed have none, and must keep running untouched.
function stylingPlanApproval(batch: JsonRecord) {
  const memory = (batch.catalog_memory || {}) as JsonRecord;
  return {
    hasPlan: Boolean(memory.stylingPlan),
    approved: Boolean(memory.stylingPlanApprovedAt),
    blocked: Boolean(memory.stylingPlan) && !memory.stylingPlanApprovedAt,
  };
}

async function processCatalogPreflight(request: Request, args: JsonRecord) {
  if (!internalWorkerAuthorized(request)) throw new Error("Catalog preflight authorization failed.");
  let batchId = String(args.batchId || "");
  let requestedId = String(args.requestId || "");
  if (!batchId) {
    const { data: candidate, error: candidateError } = await service.from("planning_requests").select("id,batch_id")
      .in("analysis_status", ["pending", "stale", "failed"]).not("batch_id", "is", null)
      .not("front_image_url", "is", null).not("back_image_url", "is", null).order("updated_at").limit(1).maybeSingle();
    if (candidateError) throw new Error(candidateError.message);
    if (!candidate?.batch_id) return { processed: false, reason: "no_pending_preflight" };
    batchId = String(candidate.batch_id);
    requestedId = String(candidate.id);
  }
  const { data: batch, error: batchError } = await service.from("planning_batches").select("*").eq("id", batchId).maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch) return { processed: false, reason: "catalog_missing" };
  let variantsQuery = service.from("planning_requests").select("*").eq("batch_id", batchId).not("front_image_url", "is", null).not("back_image_url", "is", null).order("queue_position");
  if (requestedId) variantsQuery = variantsQuery.eq("id", requestedId);
  else variantsQuery = variantsQuery.in("analysis_status", ["pending", "stale", "failed"]);
  const { data: variants } = await variantsQuery;
  const variant = (variants || []).find((entry) => !["analyzing"].includes(String(entry.analysis_status || "")));
  if (!variant) return { processed: false, reason: "no_ready_variant" };
  const { references } = await catalogReferenceInputs(batch as JsonRecord, variant as JsonRecord);
  const preflightCategory = String(((batch.generation_settings || {}) as JsonRecord).category || variant.category || "");
  const authorityReady = missingRequiredReferenceLabels(references, preflightCategory).length === 0;
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
      recordAiRun({
        organization_id: batch.organization_id, planning_request_id: variant.id, batch_id: batchId,
        job_id: "", run_kind: "catalog_product_preflight", model: resolveGeminiPolicy({ purpose: "product_truth" }).model,
        provider: "gemini", input_fingerprint: hashes.fingerprint,
        input_summary: { referenceCount: references.length, referenceRoles: references.map((entry) => entry.role) },
        output_json: normalized, status: "completed", latency_ms: Date.now() - started,
        cost_usd: 0, cost_source: "provider_cost_not_available",
      }),
    ]);
    // Proposed after the analysis is safely stored, and never inside its Promise.all:
    // a failed proposal used to reject alongside it, marking a successful analysis as
    // a Gemini failure and buying a second one on the next run.
    try {
      await proposeCatalogStylingPlan(batchId, batch as JsonRecord, normalized.stylingPlan, variant.id);
    } catch (error) {
      console.error("Could not propose the catalogue styling plan", errorMessage(error));
    }
    if (!args.requestId) scheduleBackground(kickCatalogPreflight(batchId));
    return { processed: true, requestId: variant.id, fingerprint: hashes.fingerprint };
  } catch (error) {
    await service.from("planning_requests").update({
      analysis_status: "failed", error_message: `Automatic Gemini preflight failed: ${errorMessage(error)}`.slice(0, 1000), updated_at: new Date().toISOString(),
    }).eq("id", variant.id);
    return { processed: false, reason: "analysis_failed", requestId: variant.id, error: errorMessage(error) };
  }
}

async function generateCatalogFlowGraph(batch: JsonRecord, variant: JsonRecord, references: ReferenceInput[], sessionId: string) {
  const nodes: any[] = [];
  const edges: any[] = [];

  const addNode = (type: string, inputs: any = {}) => {
    const id = crypto.randomUUID();
    nodes.push({ id, session_id: sessionId, node_type: type, inputs, status: "pending" });
    return id;
  };

  const addEdge = (source: string, target: string) => {
    edges.push({ id: crypto.randomUUID(), session_id: sessionId, source_node_id: source, target_node_id: target });
  };

  const analysisId = addNode("ai_visual_analysis", { references, batchId: batch.id, variantId: variant.id });
  const truthId = addNode("product_truth", { variantId: variant.id });
  addEdge(analysisId, truthId);

  const memoryId = addNode("memory_and_planning", { batchId: batch.id, variantId: variant.id });
  addEdge(truthId, memoryId);

  const settings = (batch.generation_settings || {}) as JsonRecord;
  const posePlan = Array.isArray(settings.posePlan) && settings.posePlan.length > 0
    ? settings.posePlan 
    : Array.from({ length: 5 }, (_, i) => ({ title: `Pose ${i + 1}`, id: `pose-${i+1}`, prompt: `Generate pose ${i + 1}` }));

  const poseRows = posePlan.map((pose: any, index: number) => ({
    session_id: sessionId, generation_id: `${sessionId}:pose:${index + 1}`, pose_index: index + 1,
    title: pose.title, pose_type: pose.id, instructions: pose.prompt, status: "queued", attempt_count: 0,
    generation_data: { ...pose, poseNumber: index + 1, jobId: sessionId },
  }));
  await service.from("session_generations").insert(poseRows);

  const finalImageIds: string[] = [];

  for (let i = 0; i < posePlan.length; i++) {
    const poseIndex = i + 1;
    const refId = addNode("pose_reference", { poseIndex });
    addEdge(memoryId, refId);

    const promptId = addNode("prompt_compilation", { poseIndex });
    addEdge(refId, promptId);

    const genId = addNode("gpt_image_2", { poseIndex, attempt: 1 });
    addEdge(promptId, genId);

    const qaId = addNode("gemini_qa", { poseIndex, attempt: 1 });
    addEdge(genId, qaId);

    const finalId = addNode("final_image", { poseIndex });
    addEdge(qaId, finalId);
    finalImageIds.push(finalId);
  }

  const learnId = addNode("learning", {});
  for (const finalId of finalImageIds) {
    addEdge(finalId, learnId);
  }

  if (nodes.length > 0) {
    await service.from("generation_flow_nodes").insert(nodes);
    await service.from("generation_flow_edges").insert(edges);
    // Kickstart the orchestrator without marking the node as running, so the worker can pick it up
    await kickNodeOrchestrator(sessionId);
  }
}

async function queueCatalogVariantGeneration(
  batch: JsonRecord,
  variant: JsonRecord,
  variants: JsonRecord[],
  batchId: string,
  generationSettings: JsonRecord,
) {
  const { productRefs, references } = await catalogReferenceInputs(batch, variant);
  assertRequiredProductReferences(references, String((batch.generation_settings as JsonRecord | undefined)?.category || variant.category || ""));

  const analysisHashes = catalogAnalysisFingerprint(batch, variant, references);
  const category = String(generationSettings.category || variant.category || "ethnic/fusion");
  const storedNormalized = variant.ai_analysis
    ? normalizeAnalysis(variant.ai_analysis as JsonRecord, category)
    : null;
  const hasCurrentAnalysis = variant.analysis_status === "ready"
    && variant.analysis_fingerprint === analysisHashes.fingerprint
    && Boolean(storedNormalized)
    && sareeAnalysisIssues({ ...storedNormalized, references }).length === 0;
  const analysisStartedAt = Date.now();
  let normalized = hasCurrentAnalysis
    ? applyCatalogMemory(batch, storedNormalized!)
    : await analyzeCatalogVariant(batch, variant, references);

  const { data: workflowItem, error: workflowItemError } = await service.from("catalog_work_items")
    .select("id,special_instructions,campaign_season,marketplaces")
    .eq("organization_id", batch.organization_id)
    .eq("planning_request_id", variant.id)
    .maybeSingle();
  if (workflowItemError) throw new Error(workflowItemError.message);
  const { data: workflowDirection, error: workflowDirectionError } = workflowItem
    ? await service.from("catalog_creative_directions").select("*")
      .eq("organization_id", batch.organization_id).eq("work_item_id", workflowItem.id).maybeSingle()
    : { data: null, error: null };
  if (workflowDirectionError) throw new Error(workflowDirectionError.message);
  if (workflowDirection) {
    const direction = workflowDirection as JsonRecord;
    const poseDirections = Array.isArray(direction.pose_direction) ? direction.pose_direction.map((entry) => String(entry || "").trim()) : [];
    const instructionSummary = [
      workflowItem?.special_instructions ? `Special instructions: ${workflowItem.special_instructions}` : "",
      workflowItem?.campaign_season ? `Campaign or event: ${workflowItem.campaign_season}` : "",
      Array.isArray(workflowItem?.marketplaces) && workflowItem.marketplaces.length ? `Marketplaces: ${workflowItem.marketplaces.join(", ")}` : "",
      direction.marketplace_requirements ? `Marketplace requirements: ${direction.marketplace_requirements}` : "",
    ].filter(Boolean).join("\n");
    normalized.creativeDirection = {
      ...normalized.creativeDirection,
      ...(direction.background_backdrop ? { backgroundStyle: String(direction.background_backdrop), studioEnvironment: String(direction.background_backdrop) } : {}),
      ...(direction.lighting ? { lighting: String(direction.lighting) } : {}),
      ...(direction.composition ? { composition: String(direction.composition) } : {}),
      ...(direction.look_and_mood ? { mood: String(direction.look_and_mood), editorialCommercialFeel: String(direction.look_and_mood) } : {}),
      ...(direction.styling_requirements ? { modelStyling: String(direction.styling_requirements) } : {}),
    };
    normalized.stylingPlan = {
      ...normalized.stylingPlan,
      ...(direction.styling_requirements ? { stylingNotes: String(direction.styling_requirements) } : {}),
      ...(direction.model_direction ? { themeInterpretation: String(direction.model_direction) } : {}),
    };
    normalized.posePlan = normalized.posePlan.map((pose, index) => ({
      ...pose,
      prompt: [pose.prompt, poseDirections[index] ? `SKU pose direction: ${poseDirections[index]}` : "", instructionSummary].filter(Boolean).join("\n"),
    }));
  }

  if (!hasCurrentAnalysis) {
    const analyzedAt = new Date().toISOString();
    const { error: analysisUpdateError } = await service.from("planning_requests").update({
      analysis_status: "ready",
      analysis_fingerprint: analysisHashes.fingerprint,
      analysis_updated_at: analyzedAt,
      garment_analysis: normalized,
      ai_analysis: normalized,
      pose_plan: normalized.posePlan,
      validation_status: "ready",
      error_message: "",
      updated_at: analyzedAt,
    }).eq("id", variant.id);
    if (analysisUpdateError) throw new Error(analysisUpdateError.message);
    await recordAiRun({
      organization_id: batch.organization_id,
      planning_request_id: variant.id,
      batch_id: batchId,
      job_id: "",
      run_kind: "catalog_product_preflight",
      model: resolveGeminiPolicy({ purpose: "product_truth" }).model,
      provider: "gemini",
      input_fingerprint: analysisHashes.fingerprint,
      input_summary: { referenceCount: references.length, referenceRoles: references.map((entry) => entry.role) },
      output_json: normalized,
      status: "completed",
      latency_ms: Date.now() - analysisStartedAt,
      cost_usd: 0,
      cost_source: "provider_cost_not_available",
    });
  }

  const memory = (batch.catalog_memory || {}) as JsonRecord;
  if (!memory.stylingPlan) {
    await proposeCatalogStylingPlan(batchId, batch, normalized.stylingPlan, String(variant.id));
    const generatedAlready = variants.some((entry) => entry.generation_status === "completed");
    const { data: saveResult, error: saveError } = await service.rpc("save_catalog_styling_plan", {
      p_batch_id: batchId,
      p_plan: normalized.stylingPlan,
      p_approve: generatedAlready,
      p_member_id: null,
    });
    if (saveError) throw new Error(saveError.message);
    const savedMemory = ((saveResult || {}) as JsonRecord).memory as JsonRecord | undefined;
    batch = { ...batch, catalog_memory: savedMemory || batch.catalog_memory };
    normalized = applyCatalogMemory(batch, normalized);
    if (!generatedAlready) {
      const { error: waitingError } = await service.from("planning_batches").update({
        schedule_status: "awaiting_styling_approval",
        queue_status: "idle",
        schedule_error: "Review and approve the catalogue styling plan to start generating.",
        updated_at: new Date().toISOString(),
      }).eq("id", batchId);
      if (waitingError) throw new Error(waitingError.message);
      return { processed: false, reason: "styling_plan_approval_required", batchId, planningRequestId: variant.id };
    }
  }

  const poses = normalized.posePlan.filter((pose) => pose.enabled !== false && pose.prompt?.trim());
  if (poses.length !== 5 || poses.map((pose) => pose.id).join(",") !== "full_front,angled,back,creative,closeup") {
    throw new Error("Catalog analysis did not produce the required ordered five-pose plan.");
  }

  assertSareeGenerationReady({
    productIdentity: normalized.productIdentity,
    posePlan: poses,
    references,
  });

  const sessionId = `session_${crypto.randomUUID()}`;
  const jobId = `job_${crypto.randomUUID()}`;
  const queuedAt = new Date().toISOString();
  const allowedModels = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
  const model = allowedModels.includes(String(generationSettings.model)) ? String(generationSettings.model) : OPENAI_MODEL;
  const quality = ["low", "medium", "high"].includes(String(generationSettings.quality)) ? String(generationSettings.quality) : "medium";
  const sessionData = {
    skuId: String(variant.request_code || variant.id),
    skuName: String(variant.sku_name),
    productDetails: String(variant.product_description || ""),
    category,
    referenceIds: productRefs.map((entry) => entry.id),
    references,
    productIdentity: normalized.productIdentity,
    creativeDirection: normalized.creativeDirection,
    modelIdentity: normalized.modelIdentity,
    stylingPlan: normalized.stylingPlan,
    posePlan: poses,
    consistencyRules: CONSISTENCY_RULES,
    workflowDirection: workflowDirection || null,
    analysisModel: resolveGeminiPolicy({ purpose: "product_truth" }).model,
    analysisVersion: ANALYSIS_VERSION,
    generatedAssets: [],
    approvedAssets: [],
  };
  const { error: sessionInsertError } = await service.from("catalog_sessions").insert({
    session_id: sessionId,
    job_id: jobId,
    user_id: "catalog-worker",
    organization_id: batch.organization_id,
    planning_request_id: variant.id,
    status: "ready",
    analysis_fingerprint: analysisHashes.fingerprint,
    product_hash: analysisHashes.pHash,
    reference_hash: analysisHashes.rHash,
    session_data: sessionData,
  });
  if (sessionInsertError) throw new Error(sessionInsertError.message);

  const jobData = {
    skuId: String(variant.request_code || variant.id),
    skuName: String(variant.sku_name),
    productDetails: String(variant.product_description || ""),
    category,
    backgroundStyle: String((workflowDirection as JsonRecord | null)?.background_backdrop || generationSettings.sceneDirection || ""),
    modelIdentityDirection: String((workflowDirection as JsonRecord | null)?.model_direction || generationSettings.modelDirection || ""),
    references,
    analysisFingerprint: analysisHashes.fingerprint,
  };
  const { error: jobInsertError } = await service.from("generation_jobs").insert({
    job_id: jobId,
    user_id: "catalog-worker",
    user_email: "",
    org_id: batch.organization_id,
    batch_id: batchId,
    status: "queued",
    readiness_status: "ready",
    readiness_reasons: [],
    sku_name: variant.sku_name,
    session_id: sessionId,
    job_data: jobData,
    planning_request_id: variant.id,
    total_poses: 5,
    provider: "openai",
    model,
    aspect_ratio: String(generationSettings.aspectRatio || "3:4"),
    image_size: String(generationSettings.imageSize || "2K"),
    quality,
    pose_qa: generationSettings.poseQa !== false,
    estimated_cost_usd: 0.25,
    created_at: queuedAt,
    updated_at: queuedAt,
  });
  if (jobInsertError) throw new Error(jobInsertError.message);

  const { error: poseInsertError } = await service.from("session_generations").insert(poses.map((pose, index) => ({
    session_id: sessionId,
    generation_id: `${jobId}:pose:${index + 1}`,
    pose_index: index + 1,
    title: pose.title,
    pose_type: pose.id,
    instructions: pose.prompt,
    status: "queued",
    attempt_count: 0,
    generation_data: { ...pose, poseNumber: index + 1, jobId },
  })));
  if (poseInsertError) throw new Error(poseInsertError.message);

  const queueUpdates = await Promise.all([
    service.from("catalog_sessions").update({ status: "generating", updated_at: queuedAt }).eq("session_id", sessionId),
    service.from("planning_requests").update({
      status: "generating",
      generation_status: "queued",
      generation_job_id: jobId,
      queued_at: queuedAt,
      updated_at: queuedAt,
    }).eq("id", variant.id),
    service.from("catalog_work_items").update({
      generation_job_id: jobId,
      catalog_session_id: sessionId,
      generation_status: "queued",
      generation_started_at: queuedAt,
      generation_completed_at: null,
      qc_status: "not_started",
      listing_status: "not_required",
    }).eq("organization_id", batch.organization_id).eq("planning_request_id", variant.id),
  ]);
  const queueError = queueUpdates.find((result) => result.error)?.error;
  if (queueError) throw new Error(queueError.message);

  scheduleBackground(kickWorker());
  return { processed: true, sessionId, jobId, planningRequestId: variant.id };
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
    // Recover stalled cron runs: if a batch has been 'running' for more than 5 minutes (Edge Functions time out at 60s),
    // it means the worker crashed or timed out. Reset it to 'scheduled' so it can be claimed again.
    const { error: recoveryError } = await service.from("planning_batches")
      .update({ schedule_status: "scheduled", queue_status: "idle", schedule_started_at: null })
      .eq("schedule_status", "running")
      .lt("schedule_started_at", new Date(Date.now() - 5 * 60000).toISOString());
    if (recoveryError) console.error("Could not recover stalled catalog batches", recoveryError);

    const { data } = await service.rpc("claim_due_catalog_batch");
    batch = Array.isArray(data) ? (data[0] as JsonRecord | undefined) || null : data as JsonRecord | null;
  }
  if (!batch || !["running", "scheduled"].includes(String(batch.schedule_status))) return { processed: false, reason: "no_due_catalog" };
  const batchId = String(batch.id);
  const generationSettings = (batch.generation_settings || {}) as JsonRecord;
  const selectedRequestIds = Array.isArray(generationSettings.catalogProductionRequestIds)
    ? [...new Set((generationSettings.catalogProductionRequestIds as unknown[]).map(String).filter(Boolean))]
    : [];
  const selectedRequestIdSet = new Set(selectedRequestIds);
  const { data: activeJobs, error: activeJobsError } = await service.from("generation_jobs").select("job_id").eq("batch_id", batchId).in("status", ["queued", "processing", "cancelling"]).limit(1);
  if (activeJobsError) console.error(activeJobsError.message);
  if (activeJobs?.length) return { processed: false, reason: "active_job" };
  const { data: variants, error: variantsError } = await service.from("planning_requests").select("*").eq("batch_id", batchId).order("queue_position", { ascending: true });
  if (variantsError) console.error(variantsError.message);
  const targetVariants = selectedRequestIds.length
    ? (variants || []).filter((row) => selectedRequestIdSet.has(String(row.id)))
    : variants || [];
  if (selectedRequestIds.length && targetVariants.length !== selectedRequestIds.length) {
    const missingIds = selectedRequestIds.filter((id) => !targetVariants.some((v) => String(v.id) === id));
    await service.from("planning_batches").update({
      schedule_error: `Skipped ${missingIds.length} missing or moved request(s) from this batch selection.`,
      updated_at: new Date().toISOString(),
    }).eq("id", batchId);
  }
  const batchRequestIds = (variants || []).map((row) => String(row.id));
  const { data: activeSessions, error: activeSessionsError } = batchRequestIds.length
    ? await service.from("catalog_sessions").select("session_id").in("planning_request_id", batchRequestIds).eq("status", "generating").limit(1)
    : { data: [], error: null };
  if (activeSessionsError) console.error(activeSessionsError.message);
  if (activeSessions?.length) return { processed: false, reason: "active_session" };

  const staleVariantIds = targetVariants
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
  const variant = targetVariants.find((row) => row.front_image_url && row.back_image_url && !["completed", "queued", "processing", "failed"].includes(String(row.generation_status)));
  if (!variant) {
    const completed = (variants || []).filter((row) => row.generation_status === "completed").length;
    const failed = (variants || []).filter((row) => row.generation_status === "failed").length;
    const pending = Math.max(0, (variants || []).length - completed - failed);
    const batchUpdate: JsonRecord = {
      generated_count: completed,
      failed_count: failed,
      pending_count: pending,
      queue_status: failed ? "failed" : pending ? "idle" : "completed",
      schedule_status: failed ? "failed" : pending ? "none" : "completed",
      schedule_finished_at: new Date().toISOString(),
      status: failed || pending ? "active" : "completed",
      updated_at: new Date().toISOString(),
    };
    if (selectedRequestIds.length) {
      const nextGenerationSettings = { ...generationSettings };
      delete nextGenerationSettings.catalogProductionRequestIds;
      batchUpdate.generation_settings = nextGenerationSettings;
    }
    await service.from("planning_batches").update(batchUpdate).eq("id", batchId);
    return { processed: false, reason: "catalog_complete" };
  }
  // Nothing is generated against a styling plan nobody has seen. The batch waits
  // here, with the reason surfaced on the row, until the plan is approved.
  const approval = stylingPlanApproval(batch);
  if (approval.blocked) {
    await service.from("planning_batches").update({
      schedule_status: "awaiting_styling_approval",
      // Left at "running" by the claim RPC, a paused batch reads as generating in
      // the UI while nothing is queued behind it.
      queue_status: "idle",
      schedule_error: "Review and approve the catalogue styling plan to start generating.",
      updated_at: new Date().toISOString(),
    }).eq("id", batchId);
    return { processed: false, reason: "styling_plan_unapproved", batchId };
  }
  try {
    return await queueCatalogVariantGeneration(batch, variant as JsonRecord, (variants || []) as JsonRecord[], batchId, generationSettings);
  } catch (error) {
    const failedAt = new Date().toISOString();
    const failureMessage = errorMessage(error);
    await Promise.all([
      service.from("generation_jobs").update({
        status: "failed",
        error_code: "catalog_queue_failed",
        error_message: failureMessage,
        completed_at: failedAt,
        updated_at: failedAt,
      }).eq("batch_id", batchId).eq("planning_request_id", variant.id).in("status", ["queued", "processing"]),
      service.from("catalog_sessions").update({ status: "failed", updated_at: failedAt })
        .eq("planning_request_id", variant.id).in("status", ["ready", "generating"]),
      service.from("planning_requests").update({
        status: "failed",
        generation_status: "failed",
        completion_status: "failed",
        error_message: failureMessage,
        generation_finished_at: failedAt,
        updated_at: failedAt,
      }).eq("id", variant.id),
      service.from("catalog_work_items").update({
        generation_status: "failed",
        updated_at: failedAt,
      }).eq("planning_request_id", variant.id),
    ]);
    scheduleBackground(kickCatalogProcessor(batchId));
    return { processed: false, reason: "variant_failed", error: failureMessage };
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
  const { data: existing, error: existingError } = await service.from("marketing_events").select("id").eq("organization_id", orgId).eq("slug", String(row.slug)).maybeSingle();
  if (existingError) throw new Error(existingError.message);
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
      source: "marketplace_monitor",
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
  const { data: adminRole, error: adminRoleError } = await service.from("roles").select("id").eq("organization_id", orgId).eq("slug", "admin").maybeSingle();
  if (adminRoleError) throw new Error(adminRoleError.message);
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
  const { data: run, error: runError } = await service.from("event_research_runs").insert({ organization_id: orgId, run_kind: runKind, model, status: "running", started_at: started }).select("id").single();
  if (runError) throw new Error(runError.message);
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
      const { data: existing, error: existingError } = await service.from("marketing_events").select("id").eq("organization_id", orgId).eq("slug", slug).maybeSingle();
      if (existingError) throw new Error(existingError.message);
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
        description: String(event.description || ""), source: "weekly_research", source_detail: "Gemini grounded commercial-calendar research",
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
  const { data: existing, error: existingError } = await service.from("event_email_deliveries").select("id,status,updated_at").eq("organization_id", args.orgId).eq("delivery_kind", args.kind).eq("delivery_key", args.key).maybeSingle();
  if (existingError) throw new Error(existingError.message);
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

function catalogProductionReportHtml(organizationName: string, reportDate: string, rows: JsonRecord[]) {
  const itemRows = rows.map((row) => {
    const poses = Array.isArray(row.poses) ? row.poses as JsonRecord[] : [];
    const poseLinks = poses.map((pose) => {
      const url = String(pose.finalAssetUrl || pose.originalUrl || pose.previewUrl || "");
      const label = `Pose ${Number(pose.poseIndex || 0) || ""}`.trim();
      return /^https?:\/\//i.test(url)
        ? `<a href="${escapeHtml(url)}" style="color:#970046;text-decoration:none;font-weight:700">${escapeHtml(label)}</a>`
        : escapeHtml(label);
    }).join(" · ") || "No pose links recorded";
    const folderLink = /^https?:\/\//i.test(String(row.folderLink || ""))
      ? `<a href="${escapeHtml(row.folderLink)}" style="display:inline-block;margin-top:7px;color:#970046;text-decoration:none;font-weight:700">Open approved package →</a>`
      : "";
    const campaign = [row.campaign, row.marketplaces].filter(Boolean).join(" · ") || "Not specified";
    const priorityDeadline = `${String(row.priority || "normal").toUpperCase()}${row.deadlineAt ? ` · due ${new Date(String(row.deadlineAt)).toLocaleString("en-IN")}` : ""}`;
    return `<tr>
      <td style="padding:14px;border-bottom:1px solid #e7e2ee;vertical-align:top">
        <div style="font:700 13px/1.4 Arial,sans-serif;color:#211a24">${escapeHtml(row.skuCode || "SKU")} · ${escapeHtml(row.skuName)}</div>
        <div style="padding-top:4px;font:400 11px/1.5 Arial,sans-serif;color:#655d6b">${escapeHtml(row.batchName || "Standalone requirement")}</div>
        ${folderLink}
      </td>
      <td style="padding:14px;border-bottom:1px solid #e7e2ee;vertical-align:top;font:400 12px/1.6 Arial,sans-serif;color:#655d6b">${escapeHtml(campaign)}<br><strong>${escapeHtml(priorityDeadline)}</strong></td>
      <td style="padding:14px;border-bottom:1px solid #e7e2ee;vertical-align:top;font:400 12px/1.7 Arial,sans-serif;color:#655d6b">${poseLinks}</td>
      <td style="padding:14px;border-bottom:1px solid #e7e2ee;vertical-align:top;font:400 12px/1.6 Arial,sans-serif;color:#655d6b">${escapeHtml(row.approvedAt)}<br>${escapeHtml(row.remarks || "No important remarks")}</td>
    </tr>`;
  }).join("");
  return `<div style="margin:0;padding:24px 12px;background:#faf8ff;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:960px;margin:0 auto;border-collapse:collapse">
      <tr><td style="border-radius:18px;background:#4f2457;padding:26px">
        <div style="font:700 11px/1.5 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#f0c9f2">Catalog approval handoff</div>
        <div style="font:700 24px/1.3 Arial,sans-serif;color:#ffffff;padding-top:5px">Approved five-pose packages</div>
        <div style="font:400 13px/1.6 Arial,sans-serif;color:#eadfea;padding-top:6px">${escapeHtml(organizationName)} · business date ${escapeHtml(reportDate)} · ${rows.length} SKU${rows.length === 1 ? "" : "s"}</div>
      </td></tr>
      <tr><td style="padding:14px 8px 0;font:400 12px/1.6 Arial,sans-serif;color:#655d6b">These SKU sets passed final human review and are ready for marketplace listing. Late, weekend, and holiday approvals are included in the next configured business-day digest.</td></tr>
      <tr><td style="padding-top:16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e7e2ee;border-radius:14px;background:#ffffff;overflow:hidden">
        <thead><tr style="background:#f0eaf2">
          <th align="left" style="padding:12px;font:700 10px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#655d6b">Requirement / SKU</th>
          <th align="left" style="padding:12px;font:700 10px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#655d6b">Campaign / deadline</th>
          <th align="left" style="padding:12px;font:700 10px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#655d6b">Approved assets</th>
          <th align="left" style="padding:12px;font:700 10px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#655d6b">Approval / remarks</th>
        </tr></thead><tbody>${itemRows}</tbody>
      </table></td></tr>
    </table>
  </div>`;
}

async function catalogMemberHandoffEmails(orgId: string, requestedMemberIds: string[]) {
  const memberIds = [...new Set(requestedMemberIds.filter(Boolean))];
  if (!memberIds.length) return [];
  const [membersResult, preferencesResult] = await Promise.all([
    service.from("organization_members")
      .select("id,email,notification_preferences").eq("organization_id", orgId).eq("status", "active").in("id", memberIds),
    service.from("organization_member_notification_preferences")
      .select("member_id,catalog_handoff_email").eq("organization_id", orgId).in("member_id", memberIds),
  ]);
  if (membersResult.error || preferencesResult.error) throw new Error(membersResult.error?.message || preferencesResult.error?.message || "Could not resolve team notification preferences.");
  const preferenceByMember = new Map((preferencesResult.data || []).map((preference) => [String(preference.member_id), preference.catalog_handoff_email !== false]));
  return cleanEmails((membersResult.data || [])
    .filter((member) => preferenceByMember.has(String(member.id))
      ? preferenceByMember.get(String(member.id))
      : (member.notification_preferences as JsonRecord | null)?.catalog_handoff_email !== false)
    .map((member) => member.email));
}

async function catalogRoleRecipients(orgId: string, roleSlug: string) {
  const { data: roles, error: rolesError } = await service.from("roles").select("id").eq("organization_id", orgId).eq("slug", roleSlug);
  if (rolesError) throw new Error(rolesError.message);
  const roleIds = (roles || []).map((role) => role.id);
  if (!roleIds.length) return [];
  const { data: memberRoles, error: memberRolesError } = await service.from("member_roles").select("member_id").in("role_id", roleIds);
  if (memberRolesError) throw new Error(memberRolesError.message);
  const memberIds = [...new Set((memberRoles || []).map((row) => String(row.member_id)).filter(Boolean))];
  return catalogMemberHandoffEmails(orgId, memberIds);
}

async function catalogTeamRecipients(orgId: string, teamId: string) {
  if (!teamId) return [];
  const { data: team, error: teamError } = await service.from("organization_teams")
    .select("id").eq("organization_id", orgId).eq("id", teamId).eq("active", true).maybeSingle();
  if (teamError) throw new Error(teamError.message);
  if (!team) return [];
  const { data: memberships, error: membershipsError } = await service.from("organization_team_memberships")
    .select("member_id").eq("organization_id", orgId).eq("team_id", teamId).eq("active", true);
  if (membershipsError) throw new Error(membershipsError.message);
  const memberIds = [...new Set((memberships || []).map((row) => String(row.member_id)).filter(Boolean))];
  return catalogMemberHandoffEmails(orgId, memberIds);
}

async function catalogHandoffSettings(orgId: string) {
  const { data: existing, error } = await service.from("catalog_handoff_settings").select("*").eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing as JsonRecord;
  const legacy = await automationSettings(orgId);
  const { data: listingTeam, error: listingTeamError } = await service.from("organization_teams")
    .select("id").eq("organization_id", orgId).eq("slug", "marketplace-listing").eq("active", true).maybeSingle();
  if (listingTeamError) throw new Error(listingTeamError.message);
  const { data, error: createError } = await service.from("catalog_handoff_settings").insert({
    organization_id: orgId,
    timezone: String(legacy.timezone || "Asia/Kolkata"),
    recipient_role_slug: "listing-team",
    recipient_team_id: listingTeam?.id || null,
    custom_recipients: cleanEmails(legacy.report_recipients),
  }).select("*").single();
  if (createError || !data) throw new Error(createError?.message || "Could not initialize catalog handoff settings.");
  return data as JsonRecord;
}

async function catalogDigestRows(orgId: string, settings: JsonRecord, handoffIds?: string[]) {
  let handoffsQuery = service.from("catalog_listing_handoffs").select("*").eq("organization_id", orgId);
  if (handoffIds?.length) handoffsQuery = handoffsQuery.in("id", handoffIds);
  else handoffsQuery = handoffsQuery.eq("status", "ready");
  const { data: handoffs, error: handoffError } = await handoffsQuery.order("approved_at").limit(500);
  if (handoffError) throw new Error(handoffError.message);
  const timezone = String(settings.timezone || "Asia/Kolkata");
  const todayIso = localDateParts(timezone).iso;
  const eligible = (handoffs || []).filter((handoff) => handoffIds?.length || localDateParts(timezone, new Date(handoff.approved_at)).iso < todayIso);
  if (!eligible.length) return [];

  const eligibleIds = eligible.map((handoff) => String(handoff.id));
  const workItemIds = [...new Set(eligible.map((handoff) => String(handoff.work_item_id)))];
  const [deliveryItemsResult, workItemsResult, handoffAssetsResult] = await Promise.all([
    service.from("catalog_report_delivery_items").select("handoff_id,delivery_id,sent_at").eq("organization_id", orgId).in("handoff_id", eligibleIds),
    service.from("catalog_work_items").select("*").eq("organization_id", orgId).in("id", workItemIds),
    service.from("catalog_listing_handoff_assets").select("handoff_id,asset_version_id,pose_index").eq("organization_id", orgId).in("handoff_id", eligibleIds).order("pose_index"),
  ]);
  for (const result of [deliveryItemsResult, workItemsResult, handoffAssetsResult]) if (result.error) throw new Error(result.error.message);
  const includedHandoffs = new Set((deliveryItemsResult.data || []).map((item) => String(item.handoff_id)));
  const filtered = handoffIds?.length ? eligible : eligible.filter((handoff) => !includedHandoffs.has(String(handoff.id)));
  if (!filtered.length) return [];

  const assetVersionIds = [...new Set((handoffAssetsResult.data || []).map((asset) => String(asset.asset_version_id)))];
  const { data: versions, error: versionsError } = assetVersionIds.length
    ? await service.from("catalog_pose_asset_versions").select("*").eq("organization_id", orgId).in("id", assetVersionIds)
    : { data: [], error: null };
  if (versionsError) throw new Error(versionsError.message);
  const resolvedVersions = await Promise.all((versions || []).map(async (version) => {
    const signedUrl = await signCatalogObject(orgId, String(version.storage_path || ""), version.storage_backend, String(version.original_url || version.preview_url || ""));
    return {
      ...version,
      preview_url: signedUrl || version.preview_url,
      original_url: signedUrl || version.original_url,
      final_asset_url: version.final_asset_url ? signedUrl || version.final_asset_url : version.final_asset_url,
    };
  }));
  const batchIds = [...new Set((workItemsResult.data || []).map((item) => String(item.planning_batch_id || "")).filter(Boolean))];
  const { data: batches, error: batchesError } = batchIds.length
    ? await service.from("planning_batches").select("id,name,campaign_season").eq("organization_id", orgId).in("id", batchIds)
    : { data: [], error: null };
  if (batchesError) throw new Error(batchesError.message);
  const appUrl = (Deno.env.get("APP_URL") || Deno.env.get("SITE_URL") || "").replace(/\/$/, "");

  return filtered.map((handoff) => {
    const item = (workItemsResult.data || []).find((candidate) => candidate.id === handoff.work_item_id) || {};
    const batch = ((batches || []).find((candidate) => candidate.id === item.planning_batch_id) || {}) as JsonRecord;
    const links = (handoffAssetsResult.data || [])
      .filter((asset) => asset.handoff_id === handoff.id)
      .map((asset) => {
        const version = resolvedVersions.find((candidate) => candidate.id === asset.asset_version_id) || {};
        return {
          poseIndex: asset.pose_index,
          versionNumber: version.version_number,
          previewUrl: version.preview_url,
          originalUrl: version.original_url,
          finalAssetUrl: version.final_asset_url,
        };
      })
      .sort((left, right) => Number(left.poseIndex) - Number(right.poseIndex));
    return {
      handoffId: handoff.id,
      workItemId: item.id,
      batchName: batch.name || item.campaign_season || "Standalone requirement",
      skuCode: item.request_code,
      skuName: item.sku_name,
      campaign: item.campaign_season || batch.campaign_season || "",
      marketplaces: Array.isArray(item.marketplaces) ? item.marketplaces.join(", ") : item.portal || item.marketplace_brand || "",
      folderKey: handoff.folder_key,
      folderLink: appUrl ? `${appUrl}/planning?tab=production&workItem=${item.id}` : "",
      poses: links,
      approvedAt: new Date(handoff.approved_at).toLocaleString("en-IN", { timeZone: timezone }),
      approvedAtIso: handoff.approved_at,
      priority: item.priority,
      deadlineAt: item.deadline_at,
      remarks: item.remarks || item.special_instructions || handoff.remarks || "",
    };
  }).filter((row) => row.poses.length === 5);
}

function catalogRecipients(settings: JsonRecord, listingRecipients: string[]) {
  const custom = cleanEmails(settings.custom_recipients);
  const mode = String(settings.recipient_mode || "listing_team");
  return selectCatalogRecipients(mode, listingRecipients, custom);
}

async function sendTrackedCatalogReport(args: {
  orgId: string;
  reportDate: string;
  recipients: string[];
  subject: string;
  html: string;
  payload: JsonRecord;
  rows: JsonRecord[];
  triggerType: "scheduled" | "manual" | "retry" | "resend";
  actorMemberId?: string;
  forceResend?: boolean;
  existingDeliveryId?: string;
}) {
  const deliveryKey = `daily:${args.reportDate}`;
  let existingQuery = service.from("catalog_report_deliveries").select("*").eq("organization_id", args.orgId);
  existingQuery = args.existingDeliveryId
    ? existingQuery.eq("id", args.existingDeliveryId)
    : existingQuery.eq("delivery_key", deliveryKey);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.status === "sent" && !args.forceResend) return { sent: false, skipped: true, deliveryId: existing.id };
  if (existing?.status === "pending" && Date.now() - Date.parse(existing.updated_at) < 10 * 60_000) return { sent: false, skipped: true, deliveryId: existing.id };
  const attemptNumber = Number(existing?.attempt_count || 0) + 1;
  const now = new Date().toISOString();
  const row = {
    organization_id: args.orgId,
    report_date: args.reportDate,
    delivery_key: existing?.delivery_key || deliveryKey,
    delivery_kind: args.triggerType === "scheduled" ? "daily" : "manual",
    recipients: args.recipients,
    subject: args.subject,
    status: "pending",
    error_message: "",
    payload: args.payload,
    attempt_count: attemptNumber,
    last_attempt_at: now,
    next_retry_at: null,
    created_by_member_id: args.actorMemberId || null,
    updated_at: now,
  };
  const { data: delivery, error } = existing
    ? await service.from("catalog_report_deliveries").update(row).eq("id", existing.id).select("id").single()
    : await service.from("catalog_report_deliveries").insert(row).select("id").single();
  if (error || !delivery) {
    if (error?.code === "23505") return { sent: false, skipped: true, deliveryId: existing?.id };
    throw new Error(error?.message || "Could not reserve the catalog report delivery.");
  }

  const deliveryItems = args.rows.map((digestRow) => ({
    organization_id: args.orgId,
    delivery_id: delivery.id,
    handoff_id: digestRow.handoffId,
    work_item_id: digestRow.workItemId,
  }));
  if (deliveryItems.length && !args.forceResend) {
    const { error: itemsError } = await service.from("catalog_report_delivery_items")
      .upsert(deliveryItems, { onConflict: "handoff_id", ignoreDuplicates: true });
    if (itemsError) {
      await service.from("catalog_report_deliveries").update({ status: "failed", error_message: itemsError.message, updated_at: new Date().toISOString() }).eq("id", delivery.id);
      throw new Error(`Could not reserve idempotent handoff items: ${itemsError.message}`);
    }
  }
  if (!args.forceResend || args.triggerType === "retry") {
    const handoffIds = args.rows.map((digestRow) => String(digestRow.handoffId));
    const workItemIds = args.rows.map((digestRow) => String(digestRow.workItemId));
    const [reservedItemsResult, handoffsResult, workItemsResult] = await Promise.all([
      service.from("catalog_report_delivery_items").select("handoff_id")
        .eq("organization_id", args.orgId).eq("delivery_id", delivery.id).in("handoff_id", handoffIds),
      service.from("catalog_listing_handoffs").select("id,status")
        .eq("organization_id", args.orgId).in("id", handoffIds),
      service.from("catalog_work_items").select("id,qc_status,final_approved_at,listing_sent_at")
        .eq("organization_id", args.orgId).in("id", workItemIds),
    ]);
    assertSupabaseResults([reservedItemsResult, handoffsResult, workItemsResult], "Could not validate the catalog handoff reservation");
    const reservedIds = new Set((reservedItemsResult.data || []).map((item) => String(item.handoff_id)));
    const readyIds = new Set((handoffsResult.data || []).filter((handoff) => handoff.status === "ready").map((handoff) => String(handoff.id)));
    const approvedIds = new Set((workItemsResult.data || [])
      .filter((item) => item.qc_status === "passed" && item.final_approved_at && !item.listing_sent_at)
      .map((item) => String(item.id)));
    const reservationIsCurrent = args.rows.every((digestRow) => reservedIds.has(String(digestRow.handoffId))
      && readyIds.has(String(digestRow.handoffId)) && approvedIds.has(String(digestRow.workItemId)));
    if (!reservationIsCurrent) {
      const skippedAt = new Date().toISOString();
      const skippedResults = await Promise.all([
        service.from("catalog_report_delivery_items").delete().eq("organization_id", args.orgId).eq("delivery_id", delivery.id),
        service.from("catalog_report_deliveries").update({
          status: "skipped", error_message: "Approval state changed before delivery; no email was sent.", updated_at: skippedAt,
        }).eq("organization_id", args.orgId).eq("id", delivery.id),
        service.from("catalog_report_delivery_attempts").insert({
          organization_id: args.orgId, delivery_id: delivery.id, attempt_number: attemptNumber,
          trigger_type: args.triggerType, status: "skipped", recipients: args.recipients,
          actor_member_id: args.actorMemberId || null, completed_at: skippedAt,
          error_message: "Approval state changed before delivery; no email was sent.",
          metadata: { itemCount: args.rows.length, reason: "approval_state_changed" },
        }),
      ]);
      assertSupabaseResults(skippedResults, "Could not record the skipped catalog handoff");
      return { sent: false, skipped: true, deliveryId: delivery.id, reason: "approval_state_changed" };
    }
  }
  const { data: attempt, error: attemptError } = await service.from("catalog_report_delivery_attempts").insert({
    organization_id: args.orgId,
    delivery_id: delivery.id,
    attempt_number: attemptNumber,
    trigger_type: args.triggerType,
    status: "pending",
    recipients: args.recipients,
    actor_member_id: args.actorMemberId || null,
    metadata: { itemCount: args.rows.length },
  }).select("id").single();
  if (attemptError || !attempt) throw new Error(attemptError?.message || "Could not record the delivery attempt.");
  let providerMessageId = "";
  try {
    const providerIdempotencyKey = args.triggerType === "resend"
      ? `catalog-handoff-${delivery.id}-resend-${attemptNumber}`
      : `catalog-handoff-${delivery.id}`;
    providerMessageId = await sendEmail({
      recipients: args.recipients,
      subject: args.subject,
      html: args.html,
      idempotencyKey: providerIdempotencyKey,
    });
  } catch (sendError) {
    const failedAt = new Date().toISOString();
    const nextRetryAt = new Date(Date.now() + Math.min(60, 15 * attemptNumber) * 60_000).toISOString();
    const trackingResults = await Promise.all([
      service.from("catalog_report_deliveries").update({
        status: "failed", error_message: errorMessage(sendError), next_retry_at: nextRetryAt, updated_at: failedAt,
      }).eq("id", delivery.id),
      service.from("catalog_report_delivery_attempts").update({
        status: "failed", error_message: errorMessage(sendError), completed_at: failedAt,
      }).eq("id", attempt.id),
    ]);
    assertSupabaseResults(trackingResults, "Could not record the failed catalog email attempt");
    throw sendError;
  }
  const sentAt = new Date().toISOString();
  const completionResults = await Promise.all([
    service.from("catalog_report_deliveries").update({
      status: "sent", provider_message_id: providerMessageId, sent_at: sentAt, error_message: "", updated_at: sentAt,
    }).eq("id", delivery.id),
    service.from("catalog_report_delivery_attempts").update({
      status: "sent", provider_message_id: providerMessageId, completed_at: sentAt,
    }).eq("id", attempt.id),
    service.from("catalog_report_delivery_items").update({ sent_at: sentAt }).eq("delivery_id", delivery.id),
    service.from("catalog_listing_handoffs").update({ status: "sent", sent_at: sentAt, updated_at: sentAt })
      .eq("organization_id", args.orgId).in("id", args.rows.map((digestRow) => String(digestRow.handoffId))),
    service.from("catalog_work_items").update({ listing_sent_at: sentAt, listing_status: "pending" })
      .eq("organization_id", args.orgId).in("id", args.rows.map((digestRow) => String(digestRow.workItemId))),
    service.from("catalog_work_item_events").insert(args.rows.map((digestRow) => ({
      organization_id: args.orgId,
      work_item_id: digestRow.workItemId,
      event_type: "sent_to_listing_team",
      actor_member_id: args.actorMemberId || null,
      source: args.triggerType === "scheduled" ? "automation" : "user",
      stage_code: "sent_to_listing_team",
      message: `Included in Listing Team handoff ${args.reportDate}`,
      metadata: { deliveryId: delivery.id, attemptNumber },
    }))),
  ]);
  assertSupabaseResults(completionResults, "Catalog email was accepted but delivery tracking could not be finalized");
  return { sent: true, skipped: false, deliveryId: delivery.id, providerMessageId };
}

async function catalogDigestContext(orgId: string, organizationName: string, options: { handoffIds?: string[] } = {}) {
  const settings = await catalogHandoffSettings(orgId);
  const timezone = String(settings.timezone || "Asia/Kolkata");
  const today = localDateTimeParts(timezone);
  const weekdays = Array.isArray(settings.business_weekdays) ? settings.business_weekdays.map(Number) : [1, 2, 3, 4, 5];
  const holidays = Array.isArray(settings.holiday_dates) ? settings.holiday_dates.map(String) : [];
  const reportDate = previousBusinessDate(today.iso, weekdays, holidays);
  const recipientRoleSlug = String(settings.recipient_role_slug || "listing-team");
  const recipientTeamId = String(settings.recipient_team_id || "");
  const groupRecipients = recipientTeamId
    ? await catalogTeamRecipients(orgId, recipientTeamId)
    : await catalogRoleRecipients(orgId, recipientRoleSlug);
  const recipients = catalogRecipients(settings, groupRecipients);
  const rows = await catalogDigestRows(orgId, settings, options.handoffIds);
  const subject = `${organizationName} · ${rows.length} approved catalog package${rows.length === 1 ? "" : "s"} · ${reportDate}`;
  return { settings, timezone, today, weekdays, holidays, reportDate, recipientTeamId, recipientRoleSlug, groupRecipients, recipients, rows, subject };
}

async function runCatalogProductionAutomationOperation(request: Request) {
  assertInternal(request);
  const { data: organizations, error } = await service.from("organizations").select("id,name");
  if (error) throw new Error(error.message);
  const results: JsonRecord[] = [];
  for (const organization of organizations || []) {
    const orgId = String(organization.id);
    try {
      const { data: failedDelivery, error: failedDeliveryError } = await service.from("catalog_report_deliveries")
        .select("id,report_date,next_retry_at,subject")
        .eq("organization_id", orgId)
        .eq("status", "failed")
        .lte("next_retry_at", new Date().toISOString())
        .order("next_retry_at")
        .limit(1)
        .maybeSingle();
      if (failedDeliveryError) throw new Error(failedDeliveryError.message);
      if (failedDelivery) {
        const { data: failedItems, error: failedItemsError } = await service.from("catalog_report_delivery_items")
          .select("handoff_id").eq("organization_id", orgId).eq("delivery_id", failedDelivery.id);
        if (failedItemsError) throw new Error(failedItemsError.message);
        const retryHandoffIds = (failedItems || []).map((item) => String(item.handoff_id));
        if (retryHandoffIds.length) {
          const retryContext = await catalogDigestContext(orgId, String(organization.name || "Youthnic"), { handoffIds: retryHandoffIds });
          if (!retryContext.recipients.length) throw new Error("No active member in the configured recipient team or custom handoff recipient is available.");
          if (!retryContext.rows.length) {
            await service.from("catalog_report_deliveries").update({
              status: "failed",
              error_message: "Retry paused because the previously selected handoff no longer has a complete five-pose package.",
              next_retry_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
              updated_at: new Date().toISOString(),
            }).eq("id", failedDelivery.id).eq("organization_id", orgId);
            results.push({ orgId, reportDate: String(failedDelivery.report_date), sent: false, retry: true, reason: "incomplete_five_pose_package" });
            continue;
          }
          const retryReportDate = String(failedDelivery.report_date);
          const retrySubject = `${organization.name} · ${retryContext.rows.length} approved catalog package${retryContext.rows.length === 1 ? "" : "s"} · ${retryReportDate}`;
          const retry = await sendTrackedCatalogReport({
            orgId,
            reportDate: retryReportDate,
            recipients: retryContext.recipients,
            subject: retrySubject,
            html: catalogProductionReportHtml(String(organization.name || "Youthnic"), retryReportDate, retryContext.rows),
            payload: { itemCount: retryContext.rows.length, workItemIds: retryContext.rows.map((row) => row.workItemId), handoffIds: retryHandoffIds, timezone: retryContext.timezone, recipientTeamId: retryContext.recipientTeamId, recipientRoleSlug: retryContext.recipientRoleSlug, retry: true },
            rows: retryContext.rows,
            triggerType: "retry",
            forceResend: true,
            existingDeliveryId: String(failedDelivery.id),
          });
          results.push({ orgId, reportDate: retryReportDate, sent: retry.sent, retry: true, itemCount: retryContext.rows.length });
          continue;
        }
      }
      const context = await catalogDigestContext(orgId, String(organization.name || "Youthnic"));
      if (context.settings.enabled === false) {
        results.push({ orgId, sent: false, reason: "disabled" });
        continue;
      }
      const isBusinessDay = context.weekdays.includes(isoWeekday(context.today.iso)) && !context.holidays.includes(context.today.iso);
      const sendTime = String(context.settings.send_local_time || "10:00").slice(0, 5);
      if (!isBusinessDay || context.today.time < sendTime) {
        results.push({ orgId, sent: false, reason: !isBusinessDay ? "non_business_day" : "before_send_time", localTime: context.today.time, sendTime });
        continue;
      }
      if (!context.rows.length) {
        results.push({ orgId, reportDate: context.reportDate, sent: false, reason: "no_final_approvals" });
        continue;
      }
      if (!context.recipients.length) throw new Error("No active member in the configured recipient team or custom handoff recipient is available.");
      const delivery = await sendTrackedCatalogReport({
        orgId,
        reportDate: context.reportDate,
        recipients: context.recipients,
        subject: context.subject,
        html: catalogProductionReportHtml(String(organization.name || "Youthnic"), context.reportDate, context.rows),
        payload: {
          itemCount: context.rows.length,
          workItemIds: context.rows.map((row) => row.workItemId),
          handoffIds: context.rows.map((row) => row.handoffId),
          timezone: context.timezone,
          recipientTeamId: context.recipientTeamId,
          recipientRoleSlug: context.recipientRoleSlug,
          teamRecipients: context.groupRecipients.length,
        },
        rows: context.rows,
        triggerType: "scheduled",
      });
      results.push({ orgId, reportDate: context.reportDate, sent: delivery.sent, skipped: delivery.skipped, itemCount: context.rows.length, recipients: context.recipients.length });
    } catch (automationError) {
      results.push({ orgId, error: errorMessage(automationError) });
    }
  }
  return { processed: results.length, results };
}

async function catalogHandoffAdminOperation(request: Request) {
  const { workspace } = await workspaceFor(request, "catalog.handoff.manage");
  const context = await catalogDigestContext(workspace.organization.id, workspace.organization.name);
  const { data: deliveries, error } = await service.from("catalog_report_deliveries")
    .select("*").eq("organization_id", workspace.organization.id).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  const deliveryIds = (deliveries || []).map((delivery) => String(delivery.id));
  const [attemptsResult, itemsResult, teamsResult, teamMembershipsResult] = await Promise.all([
    deliveryIds.length
      ? service.from("catalog_report_delivery_attempts").select("*").eq("organization_id", workspace.organization.id).in("delivery_id", deliveryIds).order("attempt_number", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    deliveryIds.length
      ? service.from("catalog_report_delivery_items").select("*").eq("organization_id", workspace.organization.id).in("delivery_id", deliveryIds)
      : Promise.resolve({ data: [], error: null }),
    service.from("organization_teams").select("id,slug,name,description,team_type,active")
      .eq("organization_id", workspace.organization.id).eq("active", true).order("name"),
    service.from("organization_team_memberships").select("team_id")
      .eq("organization_id", workspace.organization.id).eq("active", true),
  ]);
  if (attemptsResult.error || itemsResult.error || teamsResult.error || teamMembershipsResult.error) throw new Error(attemptsResult.error?.message || itemsResult.error?.message || teamsResult.error?.message || teamMembershipsResult.error?.message || "Could not load delivery history.");
  return {
    settings: context.settings,
    recipientTeams: (teamsResult.data || []).map((team) => ({
      ...team,
      memberCount: (teamMembershipsResult.data || []).filter((membership) => membership.team_id === team.id).length,
    })),
    preview: { reportDate: context.reportDate, recipients: context.recipients, rows: context.rows, subject: context.subject },
    deliveries: (deliveries || []).map((delivery) => ({
      ...delivery,
      attempts: (attemptsResult.data || []).filter((attempt) => attempt.delivery_id === delivery.id),
      itemCount: (itemsResult.data || []).filter((item) => item.delivery_id === delivery.id).length,
    })),
  };
}

async function updateCatalogHandoffSettingsOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "catalog.handoff.manage");
  const timezone = String(args.timezone || "Asia/Kolkata").trim();
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new Error("Choose a valid IANA timezone."); }
  const sendLocalTime = String(args.sendLocalTime || "10:00").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendLocalTime)) throw new Error("Send time must use HH:mm format.");
  const businessWeekdays = [...new Set((Array.isArray(args.businessWeekdays) ? args.businessWeekdays : []).map(Number).filter((day) => day >= 1 && day <= 7))].sort();
  if (!businessWeekdays.length) throw new Error("Select at least one business weekday.");
  const holidayDates = [...new Set((Array.isArray(args.holidayDates) ? args.holidayDates : []).map(String).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
  const recipientMode = ["listing_team", "custom", "listing_team_and_custom"].includes(String(args.recipientMode)) ? String(args.recipientMode) : "listing_team";
  const customRecipients = cleanEmails(args.customRecipients);
  if (recipientMode === "custom" && !customRecipients.length) throw new Error("Add at least one custom recipient.");
  const recipientRoleSlug = String(args.recipientRoleSlug || "listing-team").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(recipientRoleSlug)) throw new Error("The legacy recipient fallback is invalid.");
  let recipientTeamId = String(args.recipientTeamId || "").trim();
  if (!recipientTeamId && recipientMode !== "custom") {
    const { data: defaultTeam, error: defaultTeamError } = await service.from("organization_teams").select("id")
      .eq("organization_id", workspace.organization.id).eq("slug", "marketplace-listing").eq("active", true).maybeSingle();
    if (defaultTeamError) throw new Error(defaultTeamError.message);
    recipientTeamId = String(defaultTeam?.id || "");
  }
  if (recipientTeamId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipientTeamId)) throw new Error("Choose a valid recipient team.");
    const { data: recipientTeam, error: recipientTeamError } = await service.from("organization_teams").select("id")
      .eq("organization_id", workspace.organization.id).eq("id", recipientTeamId).eq("active", true).maybeSingle();
    if (recipientTeamError) throw new Error(recipientTeamError.message);
    if (!recipientTeam) throw new Error("The selected recipient team is not active in this workspace.");
  }
  if (recipientMode !== "custom" && !recipientTeamId) throw new Error("Choose an active recipient team.");
  const row = {
    organization_id: workspace.organization.id,
    enabled: args.enabled !== false,
    timezone,
    send_local_time: sendLocalTime,
    recipient_mode: recipientMode,
    recipient_role_slug: recipientRoleSlug,
    recipient_team_id: recipientTeamId || null,
    custom_recipients: customRecipients,
    business_weekdays: businessWeekdays,
    holiday_dates: holidayDates,
    late_approval_policy: "next_business_digest",
    updated_by_member_id: workspace.member.id,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await service.from("catalog_handoff_settings").upsert(row, { onConflict: "organization_id" }).select("*").single();
  if (error || !data) throw new Error(error?.message || "Could not update handoff settings.");
  await service.from("audit_logs").insert({
    organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
    action: "catalog.handoff_settings.updated", resource_type: "catalog_handoff_settings", resource_id: data.id,
    metadata: { timezone, sendLocalTime, recipientMode, recipientTeamId: recipientTeamId || null, recipientRoleSlug, recipientCount: customRecipients.length, businessWeekdays, holidayDates },
  });
  return data;
}

async function sendCatalogHandoffDigestOperation(request: Request, args: JsonRecord) {
  const { workspace } = await workspaceFor(request, "catalog.handoff.manage");
  const resendDeliveryId = String(args.deliveryId || "").trim();
  let handoffIds: string[] | undefined;
  let forceResend = false;
  let resendReportDate = "";
  if (resendDeliveryId) {
    const { data: delivery, error } = await service.from("catalog_report_deliveries").select("id,report_date")
      .eq("organization_id", workspace.organization.id).eq("id", resendDeliveryId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!delivery) throw new Error("Delivery record not found.");
    resendReportDate = String(delivery.report_date);
    const { data: deliveryItems, error: itemsError } = await service.from("catalog_report_delivery_items").select("handoff_id")
      .eq("organization_id", workspace.organization.id).eq("delivery_id", delivery.id);
    if (itemsError) throw new Error(itemsError.message);
    handoffIds = (deliveryItems || []).map((item) => String(item.handoff_id));
    if (!handoffIds.length) {
      const { data: deliveryPayload } = await service.from("catalog_report_deliveries").select("payload")
        .eq("organization_id", workspace.organization.id).eq("id", delivery.id).maybeSingle();
      handoffIds = Array.isArray(deliveryPayload?.payload?.handoffIds)
        ? deliveryPayload.payload.handoffIds.map(String)
        : [];
    }
    if (!handoffIds?.length) throw new Error("This delivery has no SKU handoff items to resend.");
    forceResend = true;
  }
  const context = await catalogDigestContext(workspace.organization.id, workspace.organization.name, { handoffIds });
  if (!context.rows.length) throw new Error("No approved, undelivered five-pose packages are ready.");
  if (!context.recipients.length) throw new Error("No active member in the configured recipient team or custom handoff recipient is available.");
  const effectiveReportDate = resendReportDate || context.reportDate;
  const effectiveSubject = `${workspace.organization.name} · ${context.rows.length} approved catalog package${context.rows.length === 1 ? "" : "s"} · ${effectiveReportDate}`;
  const result = await sendTrackedCatalogReport({
    orgId: workspace.organization.id,
    reportDate: effectiveReportDate,
    recipients: context.recipients,
    subject: effectiveSubject,
    html: catalogProductionReportHtml(workspace.organization.name, effectiveReportDate, context.rows),
    payload: {
      itemCount: context.rows.length,
      workItemIds: context.rows.map((row) => row.workItemId),
      handoffIds: context.rows.map((row) => row.handoffId),
      timezone: context.timezone,
      recipientTeamId: context.recipientTeamId,
      recipientRoleSlug: context.recipientRoleSlug,
      manual: true,
    },
    rows: context.rows,
    triggerType: forceResend ? "resend" : "manual",
    actorMemberId: workspace.member.id,
    forceResend,
    existingDeliveryId: resendDeliveryId || undefined,
  });
  await service.from("audit_logs").insert({
    organization_id: workspace.organization.id, actor_member_id: workspace.member.id, actor_email: workspace.user.email,
    action: forceResend ? "catalog.handoff_digest.resent" : "catalog.handoff_digest.sent",
    resource_type: "catalog_report_delivery", resource_id: String(result.deliveryId || ""),
    metadata: { itemCount: context.rows.length, recipientCount: context.recipients.length, reportDate: effectiveReportDate },
  });
  return result;
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
      const { data: upcoming, error: upcomingError } = await service.from("marketing_events").select("*").eq("organization_id", orgId).eq("status", "active").gte("start_date", today.iso).lte("start_date", through).order("start_date");
      if (upcomingError) console.error(upcomingError.message);
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
      "jobs.rerunQa": () => rerunPoseQa(request, args),
      "jobs.regenerateSession": () => regenerateSession(request, args),
      "jobs.remove": () => removeJob(request, args),
      "jobs.downloadAsset": () => downloadGeneratedAsset(request, args),
      "jobs.downloadAssets": () => downloadGeneratedAssets(request, args),
      "worker": () => processWorker(request, args),
      "nodeWorker": () => processNode(request, args),
      "admin.overview": () => adminOverview(request),
      "admin.generationFlow.list": () => adminGenerationFlowList(request),
      "admin.generationFlow.get": () => adminGenerationFlowGet(request, args),
      "history.generationFlow.get": () => historyGenerationFlowGet(request, args),
      "admin.createUser": () => createUserOperation(request, args),
      "admin.updateMember": () => updateMemberOperation(request, args),
      "admin.deleteMember": () => deleteMemberOperation(request, args),
      "admin.upsertTeam": () => upsertOrganizationTeamOperation(request, args),
      "admin.updateRolePermissions": () => updateRolePermissionsOperation(request, args),
      "admin.updateAutomationSettings": () => updateAutomationSettingsOperation(request, args),
      "profile.update": () => updateOwnProfileOperation(request, args),
      "usage.sync": () => syncOpenAiUsageOperation(request, args),
      "files.saveReference": () => saveReferenceOperation(request, args),
      "catalog.create": () => createCatalogOperation(request, args),
      "catalog.bulkAddVariants": () => bulkAddVariantsOperation(request, args),
      "catalog.setVariantReferences": () => setVariantReferencesOperation(request, args),
      "catalog.removeVariant": () => removeVariantOperation(request, args),
      "catalog.delete": () => deleteCatalogOperation(request, args),
      "catalog.stopGeneration": () => stopCatalogGenerationOperation(request, args),
      "catalog.addStyleReference": () => addCatalogStyleReferenceOperation(request, args),
      "catalog.removeStyleReference": () => removeCatalogStyleReferenceOperation(request, args),
      "catalog.schedule": () => scheduleCatalogOperation(request, args),
      "catalog.cancelSchedule": () => cancelScheduledCatalogOperation(request, args),
      "catalog.retryVariant": () => retryVariantOperation(request, args),
      "catalog.saveStylingPlan": () => saveCatalogStylingPlanOperation(request, args),
      "studio.updateStylingPlan": () => updateSessionStylingPlanOperation(request, args),
      "catalog.preflight": () => processCatalogPreflight(request, args),
      "catalog.process": () => processCatalog(request, args),
      "events.create": () => createEventOperation(request, args),
      "events.seed": () => seedEventsOperation(request),
      "events.research": () => runEventResearchOperation(request),
      "events.digest": () => sendDigestOperation(request, args),
      "events.automation": () => runEventAutomationOperation(request),
      "events.sendEmail": () => sendDigestOperation(request, args),
      "migration.archive": () => importMigrationArchiveOperation(request, args),
      "catalogProduction.importGoogleSheetDryRun": async () => {
        const { workspace } = await workspaceFor(request, "planning.manage");
        return importGoogleSheetDryRun(service, workspace, args);
      },
      "catalogProduction.importGoogleSheet": async () => {
        const { workspace } = await workspaceFor(request, "planning.manage");
        return importGoogleSheet(service, workspace, args);
      },
      "catalogProduction.createFromPlanning": async () => {
        const { workspace } = await workspaceFor(request, "planning.manage");
        return createFromPlanningRequests(service, workspace, args);
      },
      "catalogProduction.workflow.get": async () => {
        const { workspace } = await workspaceFor(request, "planning.view");
        const workflow = await getCatalogWorkflowDetail(service, workspace, args);
        if (!workflow) throw new Error("Catalog workflow item not found.");
        return workflow;
      },
      "catalogProduction.update": async () => {
        const { workspace } = await workspaceFor(request, "planning.manage");
        return updateCatalogWorkItem(service, workspace, args);
      },
      "catalogProduction.comment": async () => {
        const { workspace } = await workspaceFor(request, "planning.view");
        return addCatalogWorkItemComment(service, workspace, args);
      },
      "catalogProduction.assign": async () => {
        const { workspace } = await workspaceFor(request, "catalog.assign");
        return assignCatalogWorkItem(service, workspace, args);
      },
      "catalogProduction.reviewQc": async () => {
        const { workspace } = await workspaceFor(request, "planning.approve");
        return reviewCatalogQc(service, workspace, args);
      },
      "catalogProduction.reviewPose": async () => {
        const { workspace } = await workspaceFor(request, "planning.approve");
        return reviewCatalogPose(service, workspace, args);
      },
      "catalogProduction.regeneratePose": async () => {
        const { workspace } = await workspaceFor(request);
        if (!workspace.isAdmin && !workspace.permissions.includes("planning.approve") && !workspace.permissions.includes("planning.generate_images")) {
          throw new Error("Permission required: planning.approve or planning.generate_images");
        }
        const workItemId = String(args.workItemId || "");
        const poseId = String(args.poseId || args.generationId || "");
        if (!workItemId || !poseId) throw new Error("A catalog item and pose are required.");
        const { data: item, error: itemError } = await service.from("catalog_work_items")
          .select("id,catalog_session_id,qc_status,listing_status,listing_sent_at")
          .eq("organization_id", workspace.organization.id).eq("id", workItemId).maybeSingle();
        if (itemError) throw new Error(itemError.message);
        if (!item) throw new Error("Catalog work item not found.");
        if (item.listing_sent_at || ["in_progress", "completed"].includes(String(item.listing_status || ""))) {
          throw new Error("This asset package has already been handed to the Listing Team and cannot be regenerated in place. Create a new catalog revision instead.");
        }
        if (item.qc_status === "passed") {
          throw new Error("Request changes on the approved pose before starting re-generation.");
        }
        const { data: pose, error: poseError } = await service.from("session_generations").select("generation_id,pose_index")
          .eq("session_id", item.catalog_session_id).eq("generation_id", poseId).maybeSingle();
        if (poseError) throw new Error(poseError.message);
        if (!pose) throw new Error("This pose does not belong to the selected catalog item.");
        const result = await regeneratePose(request, { poseId, extraInstructions: args.extraInstructions }, { allowManagedCatalog: true });
        const now = new Date().toISOString();
        const regenerationResults = await Promise.all([
          service.from("catalog_work_items").update({
            status: "in_progress", generation_status: "generating", qc_status: "not_started", listing_status: "not_required",
            listing_started_at: null, listing_completed_at: null, completed_at: null,
            blocked_reason: "", failure_code: "", final_approved_at: null, final_approved_by_member_id: null,
            generation_started_at: now, generation_completed_at: null,
          }).eq("organization_id", workspace.organization.id).eq("id", workItemId),
          service.from("catalog_work_item_events").insert({
            organization_id: workspace.organization.id, work_item_id: workItemId,
            event_type: "pose_regeneration_started", actor_member_id: workspace.member.id,
            source: "user", stage_code: "generation_in_progress",
            message: String(args.extraInstructions || "Pose re-generation requested"),
            metadata: { poseId, poseIndex: pose.pose_index },
          }),
          service.from("audit_logs").insert({
            organization_id: workspace.organization.id, actor_member_id: workspace.member.id,
            actor_email: workspace.user.email, action: "catalog.pose.regeneration_started",
            resource_type: "catalog_work_item", resource_id: workItemId,
            metadata: { poseId, poseIndex: pose.pose_index, instructions: String(args.extraInstructions || "") },
          }),
        ]);
        assertSupabaseResults(regenerationResults, "Could not record the pose re-generation workflow state");
        return result;
      },
      "catalogProduction.startListing": async () => {
        const { workspace } = await workspaceFor(request, "planning.view");
        const canCompleteListing = workspace.isAdmin
          || workspace.permissions.includes("catalog.listing.complete")
          || workspace.roles.some((role) => role.slug === "listing-team");
        if (!canCompleteListing) throw new Error("Only the Listing Team or a planning manager can start listing work.");
        return markListingStarted(service, workspace, args);
      },
      "catalogProduction.markListingDone": async () => {
        const { workspace } = await workspaceFor(request, "planning.view");
        const canCompleteListing = workspace.isAdmin
          || workspace.permissions.includes("catalog.listing.complete")
          || workspace.roles.some((role) => role.slug === "listing-team");
        if (!canCompleteListing) throw new Error("Only the Listing Team or a planning manager can complete listing work.");
        return markListingDone(service, workspace, args);
      },
      "catalogProduction.downloadAssets": () => downloadCatalogProductionAssets(request, args),
      "catalogProduction.reconcile": async () => {
        const { workspace } = await workspaceFor(request, "planning.manage");
        return reconcileExistingGenerations(service, workspace, args);
      },
      "catalogProduction.handoffs.admin": () => catalogHandoffAdminOperation(request),
      "catalogProduction.handoffs.updateSettings": () => updateCatalogHandoffSettingsOperation(request, args),
      "catalogProduction.handoffs.send": () => sendCatalogHandoffDigestOperation(request, args),
      "catalogProduction.bulkGenerate": async () => {
        const { workspace } = await workspaceFor(request, "planning.generate_images");
        const result = await bulkGenerateCatalogWorkItems(service, workspace, args);
        const scheduleOutcomes: Array<{ batchId: string; success: boolean; error?: string }> = [];
        for (const batchId of result.batchIdsToSchedule) {
          try {
            await scheduleCatalogOperation(request, { catalogId: batchId });
            scheduleOutcomes.push({ batchId, success: true });
          } catch (err: any) {
            scheduleOutcomes.push({ batchId, success: false, error: err.message });
          }
        }
        return { ...result, scheduleOutcomes };
      },
      "catalogProduction.automation": () => runCatalogProductionAutomationOperation(request),
    };
    const handler = handlers[operation];
    if (!handler) return json({ error: `Unknown operation: ${operation}` }, 404);
    return json({ data: await handler() });
  } catch (error) {
    console.error("app-api request failed", errorMessage(error));
    return json({ error: errorMessage(error) }, 400);
  }
});
