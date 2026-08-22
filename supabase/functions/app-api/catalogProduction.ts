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

  let queued = 0;
  const batchesToSchedule = new Set<string>();

  // Find or create an ad-hoc batch for isolated catalog bulk generation
  const { data: existingBatch } = await service.from("planning_batches")
    .select("id")
    .eq("organization_id", workspace.organization.id)
    .eq("name", "Ad-hoc Catalog Generation")
    .limit(1)
    .maybeSingle();
    
  let batchId = existingBatch?.id;
  if (!batchId) {
    const { data: newBatch, error: batchError } = await service.from("planning_batches").insert({
      organization_id: workspace.organization.id,
      batch_code: `CAT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      name: "Ad-hoc Catalog Generation",
      total_skus: 0, pending_count: 0, status: "active", created_by_member_id: workspace.member.id,
      catalog_key: "adhoc-catalog", queue_status: "idle", schedule_status: "none",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).select("id").single();
    if (batchError) throw new Error(batchError.message);
    batchId = newBatch?.id;
  }
  
  const now = new Date().toISOString();

  for (const item of workItems || []) {
    if (["queued", "generating", "completed"].includes(item.generation_status)) continue;
    if (item.status === "blocked") continue;
    
    let requestId = item.planning_request_id;
    if (!requestId) {
      const { data: newRequest, error: reqError } = await service.from("planning_requests").insert({
        organization_id: workspace.organization.id,
        created_by_member_id: workspace.member.id,
        batch_id: batchId,
        sku_name: item.sku_name,
        color_label: item.color_label || "",
        photoshoot_type: "catalog_colourway_5_pose",
        request_code: item.request_code || `SKU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        generation_status: "pending",
        front_image_url: item.reference_image_url || null,
        back_image_url: null,
        validation_status: "pending", // Waiting for full references
        analysis_status: "pending",
      }).select("id").single();
      if (reqError) throw new Error(reqError.message);
      requestId = newRequest?.id;
      
      await service.from("catalog_work_items").update({ 
        planning_request_id: requestId, 
        planning_batch_id: batchId,
        generation_status: "queued",
      }).eq("id", item.id);
      queued++;
    } else {
      await service.from("catalog_work_items").update({ 
        generation_status: "queued",
      }).eq("id", item.id);
      queued++;
    }
    batchesToSchedule.add(String(item.planning_batch_id || batchId));
  }
  
  return { queued, batchesToSchedule: Array.from(batchesToSchedule) };
}
