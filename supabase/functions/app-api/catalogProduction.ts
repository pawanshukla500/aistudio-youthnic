import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import { type JsonRecord } from "./profiles.ts";

export type CatalogWorkspace = {
  organization: { id: string; name: string };
  member: { id: string };
  user: { email: string };
  permissions: string[];
  roles: Array<{ slug: string }>;
  isAdmin: boolean;
};

type ImportRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function generationStatus(value: unknown) {
  const status = text(value).toLowerCase();
  if (["queued", "queue"].includes(status)) return "queued";
  if (["generating", "processing", "in progress", "in_progress"].includes(status)) return "generating";
  if (["completed", "complete", "done"].includes(status)) return "completed";
  if (["failed", "cancelled", "canceled"].includes(status)) return "failed";
  if (["pending", "ready"].includes(status)) return "ready";
  return "not_required";
}

function listingStatus(value: unknown, generated: string) {
  const status = text(value).toLowerCase();
  if (["completed", "complete", "done"].includes(status) && generated === "completed") return "completed";
  if (["pending", "ready", "in progress", "in_progress"].includes(status) || generated === "completed") return "pending";
  return "not_required";
}

function priority(value: unknown) {
  const candidate = text(value).toLowerCase();
  return ["low", "normal", "high", "urgent"].includes(candidate) ? candidate : "normal";
}

async function existingExternalRequests(service: SupabaseClient, orgId: string, requestIds: string[]) {
  if (!requestIds.length) return new Set<string>();
  const { data, error } = await service
    .from("catalog_work_item_external_sources")
    .select("external_request_id,catalog_work_items!inner(organization_id)")
    .in("external_request_id", requestIds)
    .eq("catalog_work_items.organization_id", orgId);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((row) => text(row.external_request_id)).filter(Boolean));
}

export async function importGoogleSheetDryRun(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const rows = args.rows as ImportRow[];
  if (!Array.isArray(rows)) throw new Error("Invalid rows format.");
  if (rows.length > 2_000) throw new Error("Import files are limited to 2,000 rows.");

  const valid = rows.filter((row) => text(row["SKU Name"]) && text(row["Request ID"]));
  const requestIds = valid.map((row) => text(row["Request ID"]));
  const existing = await existingExternalRequests(service, workspace.organization.id, requestIds);
  const seen = new Set<string>();
  let duplicates = 0;
  for (const requestId of requestIds) {
    if (seen.has(requestId)) duplicates++;
    seen.add(requestId);
  }

  const unknownStatuses = [...new Set(rows.flatMap((row) => {
    const rawPriority = text(row["Priority"]).toLowerCase();
    return rawPriority && !["low", "normal", "high", "urgent"].includes(rawPriority)
      ? [`Priority: ${rawPriority}`]
      : [];
  }))];

  return {
    scanned: rows.length,
    newRows: Math.max(0, requestIds.filter((requestId) => !existing.has(requestId)).length - duplicates),
    matchedRows: requestIds.filter((requestId) => existing.has(requestId)).length,
    duplicates,
    invalidSkus: rows.length - valid.length,
    unknownStatuses,
    conflicts: [],
  };
}

export async function importGoogleSheet(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const rows = args.rows as ImportRow[];
  if (!Array.isArray(rows)) throw new Error("Invalid rows format.");
  if (rows.length > 2_000) throw new Error("Import files are limited to 2,000 rows.");

  const candidates = rows
    .map((row, index) => ({ row, rowNumber: index + 2, sku: text(row["SKU Name"]), requestId: text(row["Request ID"]) }))
    .filter((entry) => entry.sku && entry.requestId);
  const existing = await existingExternalRequests(
    service,
    workspace.organization.id,
    candidates.map((entry) => entry.requestId),
  );
  const seen = new Set<string>();
  let inserted = 0;
  let skipped = rows.length - candidates.length;
  const errors: Array<{ row: number; message: string }> = [];

  for (const candidate of candidates) {
    if (existing.has(candidate.requestId) || seen.has(candidate.requestId)) {
      skipped++;
      continue;
    }
    seen.add(candidate.requestId);
    const row = candidate.row;
    const generated = generationStatus(row["Generation Status"]);
    const listing = listingStatus(row["Listing Status"], generated);
    const qc = listing === "completed" ? "passed" : generated === "completed" ? "needs_review" : "not_started";
    const now = new Date().toISOString();
    const { data: workItem, error: workItemError } = await service.from("catalog_work_items").insert({
      organization_id: workspace.organization.id,
      sku_name: candidate.sku,
      priority: priority(row["Priority"]),
      theme: text(row["Theme"]) || null,
      status: listing === "completed" ? "completed" : generated === "failed" ? "blocked" : "in_progress",
      generation_status: generated,
      qc_status: qc,
      listing_status: listing,
      remarks: text(row["Remarks"]) || null,
      ai_generation_remarks: text(row["AI Gen Remarks"]) || null,
      listing_team_remarks: text(row["Listing Team Remarks"]) || null,
      listing_action: text(row["Listing Action"]) || null,
      in_house_brand: text(row["In House Brand"]) || null,
      marketplace_brand: text(row["Myntra Brand"]) || null,
      legacy_external_link: text(row["Links"]) || null,
      reference_image_url: text(row["Reference Image"]) || null,
      created_by_member_id: workspace.member.id,
      generation_completed_at: generated === "completed" ? now : null,
      listing_completed_at: listing === "completed" ? now : null,
      completed_at: listing === "completed" ? now : null,
    }).select("id").single();

    if (workItemError || !workItem) {
      errors.push({ row: candidate.rowNumber, message: workItemError?.message || "Could not create work item." });
      continue;
    }

    const { error: sourceError } = await service.from("catalog_work_item_external_sources").insert({
      work_item_id: workItem.id,
      external_request_id: candidate.requestId,
      external_tab_name: "Fashion Catalog Studio_CSV",
      external_row_number: candidate.rowNumber,
    });
    if (sourceError) {
      await service.from("catalog_work_items").delete().eq("id", workItem.id);
      errors.push({ row: candidate.rowNumber, message: sourceError.message });
      continue;
    }

    const { error: eventError } = await service.from("catalog_work_item_events").insert({
      organization_id: workspace.organization.id,
      work_item_id: workItem.id,
      event_type: "imported",
      actor_member_id: workspace.member.id,
      source: "excel",
      metadata: { externalRequestId: candidate.requestId, rowNumber: candidate.rowNumber },
    });
    if (eventError) console.error(`Could not record catalog import event: ${eventError.message}`);
    inserted++;
  }

  return { inserted, skipped, errors };
}

export async function createFromPlanningRequests(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const requestIds = [...new Set((Array.isArray(args.requestIds) ? args.requestIds : []).map((id) => text(id)).filter(Boolean))].slice(0, 100);
  if (!requestIds.length) throw new Error("Select at least one SKU.");
  const { data: requests, error } = await service.from("planning_requests")
    .select("id,organization_id,request_code,created_at,sku_name,color_label,photoshoot_type,generation_status,batch_id,generation_job_id,created_by_member_id,generation_started_at,generation_finished_at,queued_at")
    .eq("organization_id", workspace.organization.id)
    .in("id", requestIds);
  if (error) throw new Error(error.message);
  if ((requests || []).length !== requestIds.length) throw new Error("One or more selected SKUs are unavailable in this workspace.");

  let created = 0;
  let alreadyTracked = 0;
  for (const request of requests || []) {
    const [{ data: existing }, { data: job }, { data: session }] = await Promise.all([
      service.from("catalog_work_items").select("id").eq("organization_id", workspace.organization.id).eq("planning_request_id", request.id).maybeSingle(),
      service.from("generation_jobs").select("job_id,session_id,status,started_at,completed_at").eq("planning_request_id", request.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      service.from("catalog_sessions").select("session_id,status,created_at,updated_at").eq("planning_request_id", request.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (existing) {
      alreadyTracked++;
      continue;
    }
    const generated = generationStatus(job?.status || session?.status || request.generation_status || "ready");
    const completed = generated === "completed";
    const failed = generated === "failed";
    const { error: insertError } = await service.from("catalog_work_items").insert({
      organization_id: workspace.organization.id,
      request_code: request.request_code,
      request_date: request.created_at,
      sku_name: request.sku_name,
      color_label: request.color_label,
      work_type: request.photoshoot_type,
      work_mode: "ai",
      priority: "normal",
      status: failed ? "blocked" : "in_progress",
      generation_status: generated,
      qc_status: completed ? "needs_review" : "not_started",
      listing_status: completed ? "pending" : "not_required",
      planning_request_id: request.id,
      planning_batch_id: request.batch_id,
      generation_job_id: job?.job_id || request.generation_job_id,
      catalog_session_id: job?.session_id || session?.session_id,
      created_by_member_id: workspace.member.id,
      generation_started_at: job?.started_at || request.generation_started_at || (generated === "generating" ? session?.created_at : null),
      generation_completed_at: job?.completed_at || request.generation_finished_at || (completed ? session?.updated_at : null),
    });
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
    if (insertError?.code === "23505") alreadyTracked++;
    else created++;
  }
  return { created, alreadyTracked };
}

export async function assignCatalogWorkItem(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  const assignment = text(args.assignment);
  const memberId = text(args.memberId) || null;
  if (!workItemId || !["generation", "listing"].includes(assignment)) throw new Error("Invalid assignment request.");
  if (memberId) {
    const { data: member, error } = await service.from("organization_members").select("id")
      .eq("id", memberId).eq("organization_id", workspace.organization.id).eq("status", "active").maybeSingle();
    if (error) throw new Error(error.message);
    if (!member) throw new Error("The selected member is not active in this workspace.");
  }
  const field = assignment === "generation" ? "generation_assigned_member_id" : "listing_assigned_member_id";
  const { data, error } = await service.from("catalog_work_items").update({ [field]: memberId })
    .eq("id", workItemId).eq("organization_id", workspace.organization.id).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Catalog work item not found.");
  await service.from("catalog_work_item_events").insert({
    organization_id: workspace.organization.id,
    work_item_id: workItemId,
    event_type: `${assignment}_assignment_changed`,
    actor_member_id: workspace.member.id,
    source: "user",
    metadata: { memberId },
  });
  return { success: true };
}

export async function reviewCatalogQc(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  const decision = text(args.decision).toLowerCase();
  if (!workItemId || !["passed", "rejected"].includes(decision)) throw new Error("Choose a valid QC decision.");
  const patch = decision === "passed"
    ? { qc_status: "passed", listing_status: "pending", listing_started_at: new Date().toISOString(), status: "in_progress" }
    : { qc_status: "rejected", status: "blocked" };
  const { data, error } = await service.from("catalog_work_items").update(patch)
    .eq("id", workItemId).eq("organization_id", workspace.organization.id).eq("generation_status", "completed")
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Generation must be complete before QC review.");
  return { success: true };
}

export async function markListingDone(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  if (!workItemId) throw new Error("Catalog work item is required.");
  const { data, error } = await service.from("catalog_work_items").update({
    listing_status: "completed",
    listing_completed_at: new Date().toISOString(),
  })
    .eq("id", workItemId)
    .eq("organization_id", workspace.organization.id)
    .eq("generation_status", "completed")
    .eq("qc_status", "passed")
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Listing can be completed only after generation is complete and QC has passed.");
  return { success: true };
}

export async function reconcileExistingGenerations(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  _args: JsonRecord,
) {
  const { data: workItems, error } = await service.from("catalog_work_items")
    .select("id,sku_name,planning_request_id")
    .eq("organization_id", workspace.organization.id)
    .is("generation_job_id", null);
  if (error) throw new Error(error.message);

  let exactMatches = 0;
  let ambiguous = 0;
  for (const item of workItems || []) {
    let job: JsonRecord | null = null;
    if (item.planning_request_id) {
      const result = await service.from("generation_jobs")
        .select("job_id,session_id,status,started_at,completed_at,qa_status")
        .eq("planning_request_id", item.planning_request_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      job = result.data as JsonRecord | null;
    }
    if (!job) {
      const result = await service.from("generation_jobs")
        .select("job_id,session_id,status,started_at,completed_at,qa_status")
        .eq("org_id", workspace.organization.id).eq("sku_name", item.sku_name)
        .order("created_at", { ascending: false }).limit(2);
      if (result.error) throw new Error(result.error.message);
      if ((result.data || []).length === 1) job = result.data?.[0] as JsonRecord;
      else if ((result.data || []).length > 1) ambiguous++;
    }
    if (!job) continue;
    const generated = generationStatus(job.status);
    const { error: updateError } = await service.from("catalog_work_items").update({
      generation_job_id: job.job_id,
      catalog_session_id: job.session_id,
      generation_status: generated,
      generation_started_at: job.started_at || null,
      generation_completed_at: generated === "completed" ? job.completed_at || new Date().toISOString() : null,
      qc_status: generated === "completed" ? job.qa_status === "passed" ? "passed" : "needs_review" : "not_started",
      listing_status: generated === "completed" ? "pending" : "not_required",
    }).eq("id", item.id).eq("organization_id", workspace.organization.id);
    if (updateError) throw new Error(updateError.message);
    exactMatches++;
  }
  return { exactMatches, ambiguous };
}

export async function bulkGenerateCatalogWorkItems(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemIds = [...new Set((Array.isArray(args.workItemIds) ? args.workItemIds : []).map((id) => text(id)).filter(Boolean))].slice(0, 100);
  if (!workItemIds.length) throw new Error("Select at least one catalog item.");

  const { data: workItems, error } = await service.from("catalog_work_items")
    .select("*")
    .eq("organization_id", workspace.organization.id)
    .in("id", workItemIds);
  if (error) throw new Error(error.message);
  if ((workItems || []).length !== workItemIds.length) {
    throw new Error("One or more selected catalog items are unavailable in this workspace.");
  }

  const activeItems = (workItems || []).filter((item) => ["queued", "generating", "processing"].includes(text(item.generation_status)));
  if (activeItems.length) {
    throw new Error(`${activeItems.length} selected SKU${activeItems.length === 1 ? " is" : "s are"} already generating. Wait for the active run to finish.`);
  }

  const linkedRequestIds = (workItems || []).map((item) => text(item.planning_request_id)).filter(Boolean);
  const { data: linkedRequests, error: requestsError } = linkedRequestIds.length
    ? await service.from("planning_requests")
      .select("id,batch_id,front_image_url,back_image_url,generation_status")
      .eq("organization_id", workspace.organization.id)
      .in("id", linkedRequestIds)
    : { data: [], error: null };
  if (requestsError) throw new Error(requestsError.message);
  if ((linkedRequests || []).length !== linkedRequestIds.length) {
    throw new Error("One or more selected SKUs link to a missing planning request.");
  }

  const { data: linkedAssets, error: linkedAssetsError } = linkedRequestIds.length
    ? await service.from("planning_assets")
      .select("planning_request_id,asset_role,image_url,storage_path")
      .eq("organization_id", workspace.organization.id)
      .in("planning_request_id", linkedRequestIds)
      .in("asset_role", ["front", "back"])
    : { data: [], error: null };
  if (linkedAssetsError) throw new Error(linkedAssetsError.message);

  const requestById = new Map((linkedRequests || []).map((request) => [String(request.id), request]));
  for (const item of workItems || []) {
    const requestId = text(item.planning_request_id);
    if (!requestId) {
      if (!text(item.reference_image_url)) throw new Error(`${item.sku_name} needs a reference image before generation can start.`);
      continue;
    }
    const request = requestById.get(requestId);
    const requestAssets = (linkedAssets || []).filter((asset) => String(asset.planning_request_id) === requestId);
    const hasFront = Boolean(request?.front_image_url) || requestAssets.some((asset) => asset.asset_role === "front" && (asset.image_url || asset.storage_path));
    const hasBack = Boolean(request?.back_image_url) || requestAssets.some((asset) => asset.asset_role === "back" && (asset.image_url || asset.storage_path));
    if (!hasFront || !hasBack) throw new Error(`${item.sku_name} needs both front and back references before generation can start.`);
  }

  const existingBatchIds = [...new Set((linkedRequests || []).map((request) => text(request.batch_id)).filter(Boolean))];
  const { data: existingBatches, error: batchesError } = existingBatchIds.length
    ? await service.from("planning_batches")
      .select("id,generation_settings,queue_status,schedule_status")
      .eq("organization_id", workspace.organization.id)
      .in("id", existingBatchIds)
    : { data: [], error: null };
  if (batchesError) throw new Error(batchesError.message);
  if ((existingBatches || []).length !== existingBatchIds.length) {
    throw new Error("One or more selected SKUs link to a missing catalog.");
  }
  const busyBatches = (existingBatches || []).filter((batch) => (
    batch.queue_status === "running"
    || ["scheduled", "running", "awaiting_styling_approval"].includes(String(batch.schedule_status))
  ));
  if (busyBatches.length) throw new Error("A selected catalog already has scheduled or active generation. Let it finish before starting another selection.");

  const needsAdHocBatch = (workItems || []).some((item) => {
    const requestId = text(item.planning_request_id);
    return !requestId || !text(requestById.get(requestId)?.batch_id);
  });
  const adHocGenerationSettings: JsonRecord = {
    modelDirection: "",
    sceneDirection: "",
    category: "ethnic/fusion",
    aspectRatio: "3:4",
    imageSize: "2K",
    quality: "medium",
    poseQa: true,
  };
  let adHocBatchId = "";
  const now = new Date().toISOString();
  if (needsAdHocBatch) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { data: newBatch, error: batchError } = await service.from("planning_batches").insert({
      organization_id: workspace.organization.id,
      batch_code: `CAT-${suffix.toUpperCase()}`,
      name: `Catalog Production ${now.slice(0, 10)} ${suffix}`,
      total_skus: 0,
      generated_count: 0,
      pending_count: 0,
      failed_count: 0,
      status: "active",
      created_by_member_id: workspace.member.id,
      catalog_key: `catalog-production-${suffix}`,
      queue_status: "idle",
      schedule_status: "none",
      generation_settings: adHocGenerationSettings,
      created_at: now,
      updated_at: now,
    }).select("id").single();
    if (batchError || !newBatch) throw new Error(batchError?.message || "Could not create the generation catalog.");
    adHocBatchId = String(newBatch.id);
  }

  const requestIdsByBatch = new Map<string, string[]>();
  for (const item of workItems || []) {
    let requestId = text(item.planning_request_id);
    let request = requestId ? requestById.get(requestId) : undefined;
    let batchId = text(request?.batch_id) || adHocBatchId;
    if (!requestId) {
      const { data: newRequest, error: reqError } = await service.from("planning_requests").insert({
        organization_id: workspace.organization.id,
        created_by_member_id: workspace.member.id,
        batch_id: adHocBatchId,
        sku_name: item.sku_name,
        color_label: item.color_label || "",
        photoshoot_type: "catalog_colourway_5_pose",
        request_code: item.request_code || `SKU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        status: "draft",
        generation_status: "pending",
        completion_status: "pending",
        front_image_url: item.reference_image_url,
        back_image_url: item.reference_image_url,
        validation_status: "ready",
        validation_report: { ready: true, reasons: [] },
        analysis_status: "stale",
      }).select("id").single();
      if (reqError || !newRequest) throw new Error(reqError?.message || `Could not create a planning request for ${item.sku_name}.`);
      requestId = String(newRequest.id);
      batchId = adHocBatchId;
      const referenceUrl = text(item.reference_image_url);
      const { error: referenceError } = await service.from("planning_assets").insert(["front", "back"].map((role) => ({
        organization_id: workspace.organization.id,
        planning_request_id: requestId,
        sku_name: item.sku_name,
        prompt: "",
        image_url: referenceUrl,
        storage_path: "",
        sku_matched: true,
        asset_role: role,
        storage_backend: "firebase",
        metadata: { source: "catalog_production_import", role },
      })));
      if (referenceError) throw new Error(referenceError.message);
    } else if (!request?.batch_id) {
      const { error: attachError } = await service.from("planning_requests").update({ batch_id: adHocBatchId, updated_at: now }).eq("id", requestId);
      if (attachError) throw new Error(attachError.message);
      batchId = adHocBatchId;
    }

    const requestAssets = (linkedAssets || []).filter((asset) => String(asset.planning_request_id) === requestId);
    const frontAsset = requestAssets.find((asset) => asset.asset_role === "front");
    const backAsset = requestAssets.find((asset) => asset.asset_role === "back");
    const referencePatch: JsonRecord = {};
    if (request && !request.front_image_url && frontAsset?.image_url) referencePatch.front_image_url = frontAsset.image_url;
    if (request && !request.back_image_url && backAsset?.image_url) referencePatch.back_image_url = backAsset.image_url;
    const { error: requestUpdateError } = await service.from("planning_requests").update({
      ...referencePatch,
      status: "draft",
      generation_status: "pending",
      completion_status: "pending",
      generation_job_id: null,
      queued_at: null,
      generation_started_at: null,
      generation_finished_at: null,
      generation_cost_usd: 0,
      error_message: "",
      updated_at: now,
    }).eq("id", requestId).eq("organization_id", workspace.organization.id);
    if (requestUpdateError) throw new Error(requestUpdateError.message);

    const { error: workItemUpdateError } = await service.from("catalog_work_items").update({
      planning_request_id: requestId,
      planning_batch_id: batchId,
      generation_job_id: null,
      catalog_session_id: null,
      generation_status: "ready",
      generation_started_at: null,
      generation_completed_at: null,
      qc_status: "not_started",
      listing_status: "not_required",
      listing_started_at: null,
      listing_completed_at: null,
      completed_at: null,
      status: "in_progress",
    }).eq("id", item.id).eq("organization_id", workspace.organization.id);
    if (workItemUpdateError) throw new Error(workItemUpdateError.message);

    requestIdsByBatch.set(batchId, [...(requestIdsByBatch.get(batchId) || []), requestId]);
  }

  const settingsByBatch = new Map((existingBatches || []).map((batch) => [String(batch.id), (batch.generation_settings || {}) as JsonRecord]));
  for (const [batchId, requestIds] of requestIdsByBatch) {
    const settings = batchId === adHocBatchId ? adHocGenerationSettings : settingsByBatch.get(batchId) || {};
    const batchPatch: JsonRecord = {
      generation_settings: { ...settings, catalogProductionRequestIds: requestIds },
      status: "active",
      schedule_error: "",
      updated_at: now,
    };
    if (batchId === adHocBatchId) {
      batchPatch.total_skus = requestIds.length;
      batchPatch.pending_count = requestIds.length;
    }
    const { error: batchUpdateError } = await service.from("planning_batches").update(batchPatch)
      .eq("id", batchId).eq("organization_id", workspace.organization.id);
    if (batchUpdateError) throw new Error(batchUpdateError.message);
  }

  return {
    queued: workItems?.length || 0,
    batchIdsToSchedule: [...requestIdsByBatch.keys()],
  };
}
