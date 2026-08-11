import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Id<_Table extends string> = string;
export type BackendEndpoint = string;

export const api = {
  analysis: { analyzeReferences: "analysis.analyzeReferences" },
  files: { saveReference: "files.saveReference" },
  generation: { queueSku: "generation.queueSku", regeneratePose: "generation.regeneratePose" },
  jobs: { list: "jobs.list", get: "jobs.get", getQueuePosition: "jobs.getQueuePosition", cancel: "jobs.cancel", remove: "jobs.remove" },
  notifications: { list: "notifications.list", markRead: "notifications.markRead", markAllRead: "notifications.markAllRead" },
  catalog: {
    list: "catalog.list", get: "catalog.get", createCatalog: "catalog.createCatalog", bulkAddVariants: "catalog.bulkAddVariants",
    setVariantReferences: "catalog.setVariantReferences", removeVariant: "catalog.removeVariant", scheduleCatalog: "catalog.scheduleCatalog",
    cancelScheduledCatalog: "catalog.cancelScheduledCatalog", addCatalogStyleReference: "catalog.addCatalogStyleReference",
    removeCatalogStyleReference: "catalog.removeCatalogStyleReference", retryVariant: "catalog.retryVariant",
  },
  eventIntelligence: { roadmap: "eventIntelligence.roadmap", runResearch: "eventIntelligence.runResearch", seedCalendar: "eventIntelligence.seedCalendar" },
  eventDigest: { sendDigestNow: "eventDigest.sendDigestNow" },
  events: { create: "events.create" },
  admin: { overview: "admin.overview", updateRolePermissions: "admin.updateRolePermissions", updateAutomationSettings: "admin.updateAutomationSettings", syncOpenAiUsage: "admin.syncOpenAiUsage" },
  authActions: { createUser: "authActions.createUser", updateMemberAccess: "authActions.updateMemberAccess", deleteMember: "authActions.deleteMember" },
  profile: { update: "profile.update" },
} as const;

function refreshBackend() {
  window.dispatchEvent(new Event("supabase-backend-refresh"));
}

function messageFromFunctionError(error: unknown) {
  if (!error) return "Supabase request failed.";
  const candidate = error as { message?: string; context?: Response };
  return candidate.message || "Supabase request failed.";
}

export async function invokeAppApi<T = unknown>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("app-api", { body: { operation, args } });
  if (error) {
    let message = messageFromFunctionError(error);
    try {
      const body = await (error as { context?: Response }).context?.clone().json() as { error?: string } | undefined;
      if (body?.error) message = body.error;
    } catch {
      // Keep the provider error supplied by supabase-js.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(String(data.error));
  return (data?.data ?? data) as T;
}

function milliseconds(value: unknown) {
  const parsed = typeof value === "number" ? value : Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function jobSummary(row: Record<string, any>, members: Record<string, any>[] = [], generatedThumbnailUrl = "") {
  const jobData = record(row.job_data);
  const references = Array.isArray(jobData.references) ? jobData.references : [];
  const member = members.find((entry) => entry.firebase_uid === row.user_id);
  return {
    _id: row.job_id,
    skuId: jobData.skuId || row.sku_name || row.planning_request_id,
    skuName: row.sku_name || jobData.skuName || "Untitled product",
    status: row.status,
    createdAt: milliseconds(row.created_at),
    totalPoses: Number(row.total_poses || 5),
    completedPoses: Number(row.completed_poses || 0),
    failedPoses: Number(row.failed_poses || 0),
    currentPose: Number(row.current_pose || 0),
    actualCost: Number(row.actual_cost_usd || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    totalTokens: Number(row.total_tokens || 0),
    thumbnailUrl: generatedThumbnailUrl || references.find((entry: Record<string, any>) => entry.role === "front")?.downloadUrl || references[0]?.downloadUrl || null,
    productDetails: String(jobData.productDetails || ""),
    creatorName: member?.display_name || (row.user_id === "catalog-worker" ? "Automatic catalog" : row.user_email || "Workspace member"),
    creatorEmail: row.user_email || member?.email || "",
  };
}

async function listJobs(args: Record<string, any>) {
  const pageSize = Math.min(50, Math.max(1, Number(args.pageSize || 10)));
  const page = Math.max(1, Number(args.page || 1));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const search = String(args.search || "").replace(/[%_]/g, "").trim().toLowerCase();
  const status = String(args.status || "").trim();
  let jobsQuery = supabase
    .from("generation_jobs")
    .select("*", { count: "exact" })
    .eq("org_id", String(args.organizationId));
  if (status) jobsQuery = jobsQuery.eq("status", status);
  if (search) jobsQuery = jobsQuery.ilike("history_search", `%${search}%`);
  jobsQuery = jobsQuery.order("created_at", { ascending: false }).range(from, to);
  const [jobsResult, membersResult] = await Promise.all([
    jobsQuery,
    supabase.from("organization_members").select("firebase_uid,display_name,email").eq("organization_id", String(args.organizationId)),
  ]);
  if (jobsResult.error) throw jobsResult.error;
  const rows = jobsResult.data || [];
  const jobIds = rows.map((row) => row.job_id);
  const thumbnailsResult = jobIds.length
    ? await supabase
      .from("planning_assets")
      .select("generation_job_id,image_url,metadata,created_at")
      .in("generation_job_id", jobIds)
      .eq("asset_role", "generated")
      .order("created_at")
    : { data: [], error: null };
  if (thumbnailsResult.error) throw thumbnailsResult.error;
  const thumbnails = thumbnailsResult.data || [];
  const total = jobsResult.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items: rows.map((row) => {
      const jobThumbnails = thumbnails.filter((entry) => entry.generation_job_id === row.job_id);
      const poseOne = jobThumbnails.find((entry) => Number(record(entry.metadata).poseIndex) === 1);
      return jobSummary(row, membersResult.data || [], poseOne?.image_url || jobThumbnails[0]?.image_url || "");
    }),
    page,
    pageSize,
    total,
    totalPages,
  };
}

async function getJob(jobId: string) {
  const { data: job, error } = await supabase.from("generation_jobs").select("*").eq("job_id", jobId).maybeSingle();
  if (error) throw error;
  if (!job) return null;
  const [posesResult, sessionResult, assetsResult] = await Promise.all([
    supabase.from("session_generations").select("*").eq("session_id", job.session_id).order("pose_index"),
    supabase.from("catalog_sessions").select("*").eq("session_id", job.session_id).maybeSingle(),
    supabase.from("planning_assets").select("*").eq("generation_job_id", jobId).eq("asset_role", "generated").order("created_at"),
  ]);
  if (posesResult.error) throw posesResult.error;
  if (assetsResult.error) throw assetsResult.error;
  const summary = jobSummary(job);
  const generatedAssets = assetsResult.data || [];
  const poseRows = posesResult.data || [];
  const defaultTitles = [
    "Full Front Product View",
    "Professional Side / 3/4 View",
    "Full Back View",
    "Creative Gen-Z Fashion Pose",
    "Close-Up Product Detail",
  ];
  const mappedPoses = poseRows.map((pose) => {
    const asset = generatedAssets.find((entry) => Number(record(entry.metadata).poseIndex) === Number(pose.pose_index));
    const assetMetadata = record(asset?.metadata);
    const assetUsage = record(assetMetadata.usage);
    const assetUsageDetails = record(assetUsage.input_tokens_details);
    const outputUrl = pose.status === "completed" ? (pose.output_url || asset?.image_url || null) : (pose.output_url || null);
    return {
      _id: pose.generation_id,
      poseNumber: Number(pose.pose_index),
      title: pose.title || defaultTitles[Math.max(0, Number(pose.pose_index) - 1)] || `Pose ${pose.pose_index}`,
      status: pose.status || (outputUrl ? "completed" : "queued"),
      qaStatus: pose.qa_status,
      outputUrl,
      storagePath: pose.storage_path || asset?.storage_path || "",
      error: pose.error || null,
      completedAt: milliseconds(pose.updated_at || asset?.created_at),
      providerRequestId: pose.provider_request_id || assetMetadata.providerRequestId || "",
      inputTokens: Number(pose.input_tokens || assetUsage.input_tokens || 0),
      inputTextTokens: Number(pose.input_text_tokens || assetUsageDetails.text_tokens || 0),
      inputImageTokens: Number(pose.input_image_tokens || assetUsageDetails.image_tokens || 0),
      outputTokens: Number(pose.output_tokens || assetUsage.output_tokens || 0),
      totalTokens: Number(pose.total_tokens || assetUsage.total_tokens || 0),
      actualCost: Number(pose.actual_cost_usd || assetMetadata.actualCostUsd || 0),
      usageReported: Boolean(record(pose.usage_payload).providerReported || assetUsage.input_tokens || assetUsage.output_tokens),
    };
  });
  const knownPoseNumbers = new Set(mappedPoses.map((pose) => pose.poseNumber));
  for (const asset of generatedAssets) {
    const metadata = record(asset.metadata);
    const poseNumber = Number(metadata.poseIndex || 0);
    if (!poseNumber || knownPoseNumbers.has(poseNumber) || !asset.image_url) continue;
    const usage = record(metadata.usage);
    const usageDetails = record(usage.input_tokens_details);
    mappedPoses.push({
      _id: asset.id,
      poseNumber,
      title: defaultTitles[Math.max(0, poseNumber - 1)] || `Pose ${poseNumber}`,
      status: "completed",
      qaStatus: record(metadata.qa).passed === false ? "failed" : "passed",
      outputUrl: asset.image_url,
      storagePath: asset.storage_path || "",
      error: null,
      completedAt: milliseconds(asset.created_at),
      providerRequestId: metadata.providerRequestId || "",
      inputTokens: Number(usage.input_tokens || 0),
      inputTextTokens: Number(usageDetails.text_tokens || 0),
      inputImageTokens: Number(usageDetails.image_tokens || 0),
      outputTokens: Number(usage.output_tokens || 0),
      totalTokens: Number(usage.total_tokens || 0),
      actualCost: Number(metadata.actualCostUsd || 0),
      usageReported: Boolean(usage.input_tokens || usage.output_tokens),
    });
  }
  mappedPoses.sort((left, right) => left.poseNumber - right.poseNumber);
  return {
    ...summary,
    model: job.model,
    aspectRatio: job.aspect_ratio,
    imageSize: job.image_size,
    quality: job.quality || "medium",
    estimatedCost: Number(job.estimated_cost_usd || 0),
    actualCost: Number(job.actual_cost_usd || 0),
    errorMessage: job.error_message || "",
    session: sessionResult.data,
    poses: mappedPoses,
  };
}

async function queuePosition(jobId: string) {
  const { data: job } = await supabase.from("generation_jobs").select("created_at,status").eq("job_id", jobId).maybeSingle();
  if (!job || job.status !== "queued") return 0;
  const { count, error } = await supabase.from("generation_jobs").select("job_id", { count: "exact", head: true }).eq("status", "queued").lt("created_at", job.created_at);
  if (error) throw error;
  return (count || 0) + 1;
}

async function listNotifications(args: Record<string, any>) {
  const [{ data: workspace }, rowsResult] = await Promise.all([
    supabase.rpc("app_current_workspace"),
    supabase.from("notifications").select("*").eq("organization_id", String(args.organizationId)).order("created_at", { ascending: false }).limit(100),
  ]);
  if (rowsResult.error) throw rowsResult.error;
  const memberId = record(workspace).member?.id;
  return (rowsResult.data || [])
    .filter((row) => !row.recipient_member_id || row.recipient_member_id === memberId)
    .map((row) => ({
      _id: row.id,
      type: row.type === "generation_completed" ? "success" : row.type === "generation_failed" ? "error" : row.type || "info",
      title: row.title,
      message: row.body,
      createdAt: milliseconds(row.created_at),
      readAt: row.read_at ? milliseconds(row.read_at) : undefined,
      entityType: record(row.payload).entityType || "",
      entityId: record(row.payload).entityId || "",
    }));
}

function catalogUiStatus(batch: Record<string, any>) {
  if (batch.schedule_status === "scheduled") return "scheduled";
  if (batch.schedule_status === "running" || batch.queue_status === "running") return "generating";
  if (batch.schedule_status === "failed" || batch.queue_status === "failed") return "failed";
  if (batch.status === "completed" || batch.schedule_status === "completed") return "completed";
  return "draft";
}

async function listCatalogs(args: Record<string, any>) {
  const [batchesResult, requestsResult, eventsResult] = await Promise.all([
    supabase.from("planning_batches").select("*").eq("organization_id", String(args.organizationId)).order("created_at", { ascending: false }),
    supabase.from("planning_requests").select("id,batch_id,status,generation_status,front_image_url,back_image_url,analysis_status,pose_plan").eq("organization_id", String(args.organizationId)),
    supabase.from("marketing_events").select("id,name").eq("organization_id", String(args.organizationId)),
  ]);
  if (batchesResult.error) throw batchesResult.error;
  const requests = requestsResult.data || [];
  const events = eventsResult.data || [];
  return (batchesResult.data || []).map((batch) => {
    const variants = requests.filter((request) => request.batch_id === batch.id);
    return {
      ...batch,
      _id: batch.id,
      name: batch.name,
      status: catalogUiStatus(batch),
      createdAt: milliseconds(batch.created_at),
      scheduledAt: batch.scheduled_at ? milliseconds(batch.scheduled_at) : undefined,
      preferredGenerationAt: batch.scheduled_at ? milliseconds(batch.scheduled_at) : undefined,
      variantCount: variants.length,
      readyCount: variants.filter((variant) => variant.front_image_url && variant.back_image_url && variant.analysis_status === "ready" && Array.isArray(variant.pose_plan) && variant.pose_plan.length === 5).length,
      completedCount: variants.filter((variant) => variant.generation_status === "completed").length,
      failedCount: variants.filter((variant) => variant.generation_status === "failed").length,
      eventName: events.find((event) => event.id === (batch.event_id || batch.source_event_id))?.name || null,
    };
  });
}

async function getCatalog(catalogId: string) {
  const { data: batch, error } = await supabase.from("planning_batches").select("*").eq("id", catalogId).maybeSingle();
  if (error) throw error;
  if (!batch) return null;
  const { data: variants, error: variantsError } = await supabase.from("planning_requests").select("*").eq("batch_id", catalogId).order("queue_position");
  if (variantsError) throw variantsError;
  const requestIds = (variants || []).map((variant) => variant.id);
  const assetsResult = requestIds.length
    ? await supabase.from("planning_assets").select("*").in("planning_request_id", requestIds).order("created_at")
    : { data: [], error: null };
  if (assetsResult.error) throw assetsResult.error;
  const jobsResult = await supabase
    .from("generation_jobs")
    .select("job_id,session_id,planning_request_id,status,current_pose,completed_poses,total_poses,error_code,error_message,available_at,updated_at,created_at")
    .eq("batch_id", catalogId)
    .order("created_at");
  if (jobsResult.error) throw jobsResult.error;
  const sessionIds = (jobsResult.data || []).map((job) => job.session_id).filter(Boolean);
  const posesResult = sessionIds.length
    ? await supabase.from("session_generations").select("*").in("session_id", sessionIds).order("pose_index")
    : { data: [], error: null };
  if (posesResult.error) throw posesResult.error;
  const settings = record(batch.generation_settings);
  const hydrated = (variants || []).map((variant) => {
    const variantAssets = (assetsResult.data || []).filter((asset) => asset.planning_request_id === variant.id);
    const latest = (role: string) => [...variantAssets].reverse().find((asset) => asset.asset_role === role);
    const job = [...(jobsResult.data || [])].reverse().find((entry) => entry.planning_request_id === variant.id);
    const outputs = (posesResult.data || []).filter((pose) => pose.session_id === job?.session_id).map((pose) => ({
      poseNumber: Number(pose.pose_index), title: pose.title, status: pose.status, url: pose.output_url || null, error: pose.error || null,
    }));
    const readinessReasons = [
      !variant.front_image_url ? "Front product image is required." : "",
      !variant.back_image_url ? "Back product image is required." : "",
      variant.front_image_url && variant.back_image_url && ["pending", "stale"].includes(String(variant.analysis_status || "pending")) ? "Gemini analysis and pose plan must be rebuilt." : "",
      variant.analysis_status === "analyzing" ? "Gemini analysis is running." : "",
      variant.analysis_status === "failed" ? (variant.error_message || "Gemini analysis failed.") : "",
      variant.analysis_status === "ready" && (!Array.isArray(variant.pose_plan) || variant.pose_plan.length !== 5) ? "The five-pose plan is incomplete." : "",
    ].filter(Boolean);
    const readinessStatus = variant.generation_status === "completed" ? "completed"
      : variant.generation_status === "failed" ? "needs_review"
      : ["queued", "processing"].includes(String(variant.generation_status)) ? "generating"
      : variant.analysis_status === "analyzing" ? "analyzing"
      : variant.analysis_status === "failed" ? "blocked"
      : readinessReasons.length ? "incomplete"
      : "ready";
    return {
      ...variant,
      _id: variant.id,
      sku: variant.sku_name,
      colorLabel: variant.color_label || "",
      status: variant.generation_status === "completed" ? "completed" : variant.generation_status === "failed" ? "failed" : variant.status === "generating" ? "generating" : "draft",
      analysisStatus: variant.analysis_status || "pending",
      analysisUpdatedAt: variant.analysis_updated_at ? milliseconds(variant.analysis_updated_at) : null,
      readinessStatus,
      readinessReasons,
      frontUrl: variant.front_image_url || latest("front")?.image_url || null,
      backUrl: variant.back_image_url || latest("back")?.image_url || null,
      fabricPatternUrl: latest("fabric_pattern")?.image_url || null,
      additionalProductUrl: latest("additional_product")?.image_url || null,
      jobId: job?.job_id || null,
      jobStatus: job?.status || null,
      jobCurrentPose: Number(job?.current_pose || 0),
      jobCompletedPoses: Number(job?.completed_poses || 0),
      jobTotalPoses: Number(job?.total_poses || 5),
      jobError: job?.error_message || null,
      retryAvailableAt: job?.available_at ? milliseconds(job.available_at) : null,
      outputs,
    };
  });
  const styleEntries = Array.isArray(batch.reference_images) ? batch.reference_images : [];
  return {
    ...batch,
    _id: batch.id,
    name: batch.name,
    status: catalogUiStatus(batch),
    createdAt: milliseconds(batch.created_at),
    scheduledAt: batch.scheduled_at ? milliseconds(batch.scheduled_at) : undefined,
    preferredGenerationAt: batch.scheduled_at ? milliseconds(batch.scheduled_at) : undefined,
    eventId: batch.event_id || batch.source_event_id || undefined,
    campaign: batch.campaign_season || "",
    modelDirection: settings.modelDirection || "",
    sceneDirection: settings.sceneDirection || "",
    category: settings.category || "ethnic/fusion",
    aspectRatio: settings.aspectRatio || "3:4",
    imageSize: settings.imageSize || "2K",
    poseQa: settings.poseQa !== false,
    scheduleError: batch.schedule_error || "",
    variants: hydrated,
    styleReferences: styleEntries.map((entry: Record<string, any>) => ({ _id: `style:${entry.id}`, url: entry.downloadUrl || entry.image_url, filename: entry.filename || "Style reference" })),
    hasLockedAnchor: Boolean(record(batch.catalog_memory).anchorOutputUrl),
  };
}

async function roadmap(args: Record<string, any>) {
  const [eventsResult, runsResult, workspaceResult] = await Promise.all([
    supabase.from("marketing_events").select("*").eq("organization_id", String(args.organizationId)).order("start_date"),
    supabase.from("event_research_runs").select("*").eq("organization_id", String(args.organizationId)).order("started_at", { ascending: false }).limit(1),
    supabase.rpc("app_current_workspace"),
  ]);
  if (eventsResult.error) throw eventsResult.error;
  const now = Date.now();
  const workspace = record(workspaceResult.data);
  const events = (eventsResult.data || []).map((event) => {
    const date = milliseconds(`${event.start_date}T06:30:00Z`);
    const prepDeadline = event.preparation_deadline ? milliseconds(`${event.preparation_deadline}T06:30:00Z`) : date - 21 * 86_400_000;
    const research = record(event.research_payload);
    return {
      _id: event.id,
      name: event.name,
      type: event.category || "seasonal",
      date,
      prepDeadline,
      planningLeadDays: Math.max(1, Math.round((date - prepDeadline) / 86_400_000)),
      daysUntil: Math.ceil((date - now) / 86_400_000),
      prepDaysLeft: Math.ceil((prepDeadline - now) / 86_400_000),
      region: Array.isArray(event.applicable_states) ? event.applicable_states.join(", ") : "",
      states: Array.isArray(event.applicable_states) ? event.applicable_states : [],
      marketplace: Array.isArray(event.target_marketplaces) ? event.target_marketplaces[0] || "" : "",
      marketplaces: Array.isArray(event.target_marketplaces) ? event.target_marketplaces : [],
      priority: event.priority || "normal",
      campaignSeason: research.campaignSeason || `${event.name} ${event.year || new Date(date).getUTCFullYear()}`,
      confidence: Number(event.confidence || 0),
      description: event.description || "",
      brief: event.description || "",
      mood: research.mood || "",
      colorPalette: Array.isArray(event.color_palette) ? event.color_palette : [],
      themes: Array.isArray(event.visual_themes) ? event.visual_themes : [],
      source: event.source || "",
      confirmed: Number(event.confidence || 0) >= 0.9,
      verificationStatus: research.verificationStatus || (Number(event.confidence || 0) >= 0.9 ? "verified" : "estimated"),
      sourceUrls: Array.isArray(research.sourceUrls) ? research.sourceUrls : [],
    };
  });
  const run = runsResult.data?.[0];
  return {
    events,
    lastRun: run ? { ...run, _id: run.id, startedAt: milliseconds(run.started_at), finishedAt: milliseconds(run.finished_at) } : null,
    capabilities: { canManage: Boolean(workspace.isAdmin || (workspace.permissions || []).includes("planning.manage")) },
  };
}

async function adminOverview(args: Record<string, any>) {
  const value = await invokeAppApi<Record<string, any>>("admin.overview", args);
  const roles = (value.roles || []).map((role: Record<string, any>) => ({ ...role, _id: role.id }));
  return {
    ...value,
    health: { ...value.health, supabase: true },
    roles,
    members: (value.members || []).map((member: Record<string, any>) => ({
      ...member,
      _id: member.id,
      user: member.user ? { ...member.user, _id: member.user.id, displayName: member.user.displayName || member.user.name || member.display_name || member.email } : null,
      roles: (member.roles || []).map((role: Record<string, any>) => ({ ...role, _id: role.id })),
    })),
    permissions: value.permissions || [],
    recentAuditLogs: (value.recentAuditLogs || []).map((log: Record<string, any>) => ({
      ...log,
      _id: log.id,
      timestamp: milliseconds(log.created_at),
      entityType: log.resource_type,
      entityId: log.resource_id,
    })),
  };
}

async function queryBackend(endpoint: BackendEndpoint, args: Record<string, any>) {
  switch (endpoint) {
    case api.jobs.list: return listJobs(args);
    case api.jobs.get: return getJob(String(args.jobId));
    case api.jobs.getQueuePosition: return queuePosition(String(args.jobId));
    case api.notifications.list: return listNotifications(args);
    case api.catalog.list: return listCatalogs(args);
    case api.catalog.get: return getCatalog(String(args.catalogId));
    case api.eventIntelligence.roadmap: return roadmap(args);
    case api.admin.overview: return adminOverview(args);
    default: throw new Error(`Unsupported Supabase query: ${endpoint}`);
  }
}

async function mutateBackend(endpoint: BackendEndpoint, args: Record<string, any>) {
  switch (endpoint) {
    case api.analysis.analyzeReferences:
      return invokeAppApi("studio.analyze", args);
    case api.generation.queueSku:
      return invokeAppApi("studio.queue", { ...args, sessionId: args.generationSessionId, category: args.categoryStr, analysisFingerprint: args.analysisFingerprint });
    case api.generation.regeneratePose:
      return invokeAppApi("jobs.regenerate", args);
    case api.jobs.cancel:
      return invokeAppApi("jobs.cancel", args);
    case api.jobs.remove:
      return invokeAppApi("jobs.remove", args);
    case api.files.saveReference:
      return invokeAppApi("files.saveReference", args);
    case api.catalog.createCatalog:
      return invokeAppApi("catalog.create", args);
    case api.catalog.bulkAddVariants:
      return invokeAppApi("catalog.bulkAddVariants", args);
    case api.catalog.setVariantReferences:
      return invokeAppApi("catalog.setVariantReferences", args);
    case api.catalog.removeVariant:
      return invokeAppApi("catalog.removeVariant", args);
    case api.catalog.addCatalogStyleReference:
      return invokeAppApi("catalog.addStyleReference", args);
    case api.catalog.removeCatalogStyleReference:
      return invokeAppApi("catalog.removeStyleReference", args);
    case api.catalog.scheduleCatalog:
      return invokeAppApi("catalog.schedule", args);
    case api.catalog.cancelScheduledCatalog:
      return invokeAppApi("catalog.cancelSchedule", args);
    case api.catalog.retryVariant:
      return invokeAppApi("catalog.retryVariant", args);
    case api.events.create:
      return invokeAppApi("events.create", args);
    case api.eventIntelligence.seedCalendar:
      return invokeAppApi("events.seed", args);
    case api.eventIntelligence.runResearch:
      return invokeAppApi("events.research", args);
    case api.eventDigest.sendDigestNow:
      return invokeAppApi("events.digest", args);
    case api.admin.updateRolePermissions:
      return invokeAppApi("admin.updateRolePermissions", args);
    case api.admin.updateAutomationSettings:
      return invokeAppApi("admin.updateAutomationSettings", args);
    case api.admin.syncOpenAiUsage:
      return invokeAppApi("usage.sync", args);
    case api.profile.update:
      return invokeAppApi("profile.update", args);
    case api.authActions.createUser:
      return invokeAppApi("admin.createUser", args);
    case api.authActions.updateMemberAccess:
      return invokeAppApi("admin.updateMember", args);
    case api.authActions.deleteMember:
      return invokeAppApi("admin.deleteMember", args);
    case api.notifications.markRead: {
      const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", String(args.notificationId));
      if (error) throw error;
      return { success: true };
    }
    case api.notifications.markAllRead: {
      const { data: workspace } = await supabase.rpc("app_current_workspace");
      const memberId = record(workspace).member?.id;
      let query = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("organization_id", String(args.organizationId)).is("read_at", null);
      if (memberId) query = query.or(`recipient_member_id.is.null,recipient_member_id.eq.${memberId}`);
      const { error } = await query;
      if (error) throw error;
      return { success: true };
    }
    default:
      throw new Error(`Unsupported Supabase mutation: ${endpoint}`);
  }
}

export function useQuery(endpoint: BackendEndpoint, args: Record<string, any> | "skip"): any {
  const [value, setValue] = useState<any>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const serializedArgs = args === "skip" ? "skip" : JSON.stringify(args);

  useEffect(() => {
    if (serializedArgs === "skip") {
      setValue(undefined);
      setError(null);
      return;
    }
    setValue(undefined);
    setError(null);
    let active = true;
    const load = () => {
      void queryBackend(endpoint, JSON.parse(serializedArgs)).then((next) => {
        if (active) { setValue(next); setError(null); }
      }).catch((reason) => {
        if (active) setError(reason instanceof Error ? reason : new Error(String(reason)));
      });
    };
    load();
    const dynamic = endpoint.startsWith("jobs.") || endpoint === api.notifications.list || endpoint.startsWith("catalog.");
    const interval = dynamic ? window.setInterval(load, 2500) : undefined;
    window.addEventListener("supabase-backend-refresh", load);
    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
      window.removeEventListener("supabase-backend-refresh", load);
    };
  }, [endpoint, serializedArgs]);

  if (error) throw error;
  return value;
}

export function useMutation(endpoint: BackendEndpoint) {
  return async (args: Record<string, any>) => {
    const result = await mutateBackend(endpoint, args || {});
    refreshBackend();
    return result as any;
  };
}

export const useAction = useMutation;
