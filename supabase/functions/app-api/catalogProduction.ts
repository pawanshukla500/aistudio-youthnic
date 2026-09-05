import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import { type JsonRecord } from "./profiles.ts";
import { buildCatalogStageTimeline } from "./lib/catalogStageTimeline.ts";
import { PRODUCT_REFERENCE_ROLES, isSareeReferenceSet, missingRequiredReferenceLabels, selectCurrentCatalogProductReferences } from "./lib/referencePolicy.ts";

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

function qcStatus(value: unknown, generated: string, listing: string) {
  const status = text(value).toLowerCase();
  if (["passed", "pass"].includes(status)) return "passed";
  if (["rejected", "reject", "failed", "fail"].includes(status)) return "rejected";
  if (["needs_review", "review"].includes(status) || (generated === "completed" && listing !== "completed")) return "needs_review";
  if (listing === "completed") return "passed";
  return "not_started";
}

function priority(value: unknown) {
  const candidate = text(value).toLowerCase();
  return ["low", "normal", "high", "urgent"].includes(candidate) ? candidate : "normal";
}

function optionalDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(text(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function delimitedList(value: unknown, limit = 20) {
  return [...new Set(text(value).split(/[,;\n]/).map((entry) => entry.trim()).filter(Boolean))].slice(0, limit);
}

function assertQueryResults(results: unknown[], context: string) {
  const failure = results.map((result) => (result as { error?: { message?: string } | null })?.error).find(Boolean);
  if (failure) throw new Error(`${context}: ${failure.message || "database operation failed"}`);
}

const POSE_IDS = ["full_front", "angled", "back", "creative", "closeup"] as const;

export function humanProductLearningGuidance(comments: string) {
  // The full human comment remains in qa_reviews, catalog_asset_reviews and
  // audit_logs. The reusable prompt guard has a deliberately smaller schema
  // limit, so truncate only its derived copy at Unicode character boundaries.
  return Array.from(`Human QC for this exact product reference set: ${comments.trim()}`).slice(0, 1_200).join("");
}

// A human rejection can safely leave one product-specific, reference-bound
// guard for a re-generation of the *same* source product. It is deliberately
// not promoted to a category rule: a note such as "no lace on the rear" is
// evidence for one SKU, not a general fact about ethnic/fusion products.
async function recordHumanProductLearningRule(args: {
  service: SupabaseClient;
  workspace: CatalogWorkspace;
  planningRequestId: string;
  assetVersionId: string;
  sourceQaReviewId: string;
  poseIndex: number;
  comments: string;
  now: string;
}) {
  // This record is a convenience guard for a later re-generation, never a
  // prerequisite for recording the human decision itself. During a rolling
  // deployment the table can be unavailable briefly; leave the core QC/audit
  // operation successful and log the non-critical learning write instead.
  try {
    const { data: session, error: sessionError } = await args.service.from("catalog_sessions")
      .select("session_id,reference_hash,session_data")
      .eq("organization_id", args.workspace.organization.id)
      .eq("planning_request_id", args.planningRequestId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sessionError) {
      console.error(`Could not load the reviewed product reference fingerprint: ${sessionError.message}`);
      return;
    }
    if (!session || !text(session.reference_hash)) return;
    const sessionData = asRecord(session.session_data);
    const productIdentity = asRecord(sessionData.productIdentity);
    const garmentFamily = text(productIdentity.garmentFamily);
    const productCategory = text(sessionData.category);
    const poseId = POSE_IDS[Math.max(0, Math.min(POSE_IDS.length - 1, args.poseIndex - 1))];
    if (!garmentFamily || !productCategory || !poseId) return;
    const { error } = await args.service.from("generation_learning_rules").insert({
      organization_id: args.workspace.organization.id,
      source_qa_review_id: args.sourceQaReviewId || null,
      garment_family: garmentFamily,
      product_category: productCategory,
      pose_id: poseId,
      scope: "product",
      rule_kind: "reference_guard",
      reference_fingerprint: text(session.reference_hash),
      guidance: humanProductLearningGuidance(args.comments),
      status: "approved",
      created_by_member_id: args.workspace.member.id,
      approved_by_member_id: args.workspace.member.id,
      approved_at: args.now,
      review_note: `Created from rejected asset version ${args.assetVersionId}`,
    });
    if (error) console.error(`Could not save the reviewed product correction: ${error.message}`);
  } catch (error) {
    console.error("Could not save the reviewed product correction", error);
  }
}

// This is intentionally independent of the UI. A caller can invoke the bulk
// API directly, so linked Planning work must have completed its category-aware
// evidence validation before any request is allowed into the generation queue.
export function assertCatalogRequestEvidenceReady(request: JsonRecord | undefined, skuName: string) {
  if (request?.validation_status === "ready") return;
  throw new Error(`${skuName} is awaiting validated product evidence. Complete its reference requirements before generation can start.`);
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
  const { data: members, error: membersError } = await service.from("organization_members")
    .select("email").eq("organization_id", workspace.organization.id).eq("status", "active");
  if (membersError) throw new Error(membersError.message);
  const memberEmails = new Set((members || []).map((member) => text(member.email).toLowerCase()).filter(Boolean));
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
  const unknownAssigneeEmails = [...new Set(rows.flatMap((row) => [row["Generation Owner Email"], row["Listing Owner Email"]]
    .map((value) => text(value).toLowerCase()).filter((email) => email && !memberEmails.has(email))))];
  const invalidDeadlines = rows.filter((row) => text(row["Deadline"]) && !optionalDate(row["Deadline"])).length;

  return {
    scanned: rows.length,
    newRows: Math.max(0, requestIds.filter((requestId) => !existing.has(requestId)).length - duplicates),
    matchedRows: requestIds.filter((requestId) => existing.has(requestId)).length,
    duplicates,
    invalidSkus: rows.length - valid.length,
    unknownStatuses,
    unknownAssigneeEmails,
    invalidDeadlines,
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
  const insertedWorkItemIds: string[] = [];
  const queueableWorkItemIds: string[] = [];
  const { data: members, error: membersError } = await service.from("organization_members")
    .select("id,email")
    .eq("organization_id", workspace.organization.id)
    .eq("status", "active");
  if (membersError) throw new Error(membersError.message);
  const memberByEmail = new Map((members || []).map((member) => [text(member.email).toLowerCase(), String(member.id)]));

  for (const candidate of candidates) {
    if (existing.has(candidate.requestId) || seen.has(candidate.requestId)) {
      skipped++;
      continue;
    }
    seen.add(candidate.requestId);
    const row = candidate.row;
    const rawPriority = text(row["Priority"]).toLowerCase();
    if (rawPriority && !["low", "normal", "high", "urgent"].includes(rawPriority)) {
      errors.push({ row: candidate.rowNumber, message: "Priority must be low, normal, high, or urgent." });
      continue;
    }
    const generated = generationStatus(row["Generation Status"]);
    const listing = listingStatus(row["Listing Status"], generated);
    const qc = qcStatus(row["QC Status"], generated, listing);
    const generationOwnerEmail = text(row["Generation Owner Email"]).toLowerCase();
    const listingOwnerEmail = text(row["Listing Owner Email"]).toLowerCase();
    const generationOwnerId = memberByEmail.get(generationOwnerEmail) || null;
    const listingOwnerId = memberByEmail.get(listingOwnerEmail) || null;
    if ((generationOwnerEmail && !generationOwnerId) || (listingOwnerEmail && !listingOwnerId)) {
      errors.push({ row: candidate.rowNumber, message: "Generation or Listing owner email does not match an active workspace member." });
      continue;
    }
    const deadlineAt = optionalDate(row["Deadline"]);
    if (text(row["Deadline"]) && !deadlineAt) {
      errors.push({ row: candidate.rowNumber, message: "Deadline is not a valid date." });
      continue;
    }
    const marketplaces = delimitedList(row["Marketplaces"] || row["Marketplace"]);
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
      marketplaces,
      campaign_season: text(row["Campaign / Event"]) || null,
      campaign_event_details: { source: "spreadsheet_import", value: text(row["Campaign / Event"]) },
      deadline_at: deadlineAt,
      special_instructions: text(row["Special Instructions"]),
      generation_assigned_member_id: generationOwnerId,
      listing_assigned_member_id: listingOwnerId,
      legacy_external_link: text(row["Links"]) || null,
      reference_image_url: text(row["Front Reference Image"] || row["Reference Image"]) || null,
      back_reference_image_url: text(row["Back Reference Image"]) || null,
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

    const { error: directionError } = await service.from("catalog_creative_directions").insert({
      organization_id: workspace.organization.id,
      work_item_id: workItem.id,
      look_and_mood: text(row["Desired Look and Mood"]),
      model_direction: text(row["Model Direction"]),
      styling_requirements: text(row["Styling Requirements"]),
      pose_direction: delimitedList(row["Pose Direction"], 5),
      background_backdrop: text(row["Background / Backdrop"]),
      lighting: text(row["Lighting"]),
      composition: text(row["Composition"]),
      marketplace_requirements: text(row["Marketplace Requirements"]),
      created_by_member_id: workspace.member.id,
    });
    if (directionError) {
      await service.from("catalog_work_items").delete().eq("id", workItem.id);
      errors.push({ row: candidate.rowNumber, message: directionError.message });
      continue;
    }

    const assignmentRows = [
      generationOwnerId ? { organization_id: workspace.organization.id, work_item_id: workItem.id, assignment_type: "generation", member_id: generationOwnerId, assigned_by_member_id: workspace.member.id, note: "Imported from spreadsheet" } : null,
      listingOwnerId ? { organization_id: workspace.organization.id, work_item_id: workItem.id, assignment_type: "listing", member_id: listingOwnerId, assigned_by_member_id: workspace.member.id, note: "Imported from spreadsheet" } : null,
    ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (assignmentRows.length) {
      const { error: assignmentError } = await service.from("catalog_work_item_assignments").insert(assignmentRows);
      if (assignmentError) {
        await service.from("catalog_work_items").delete().eq("id", workItem.id);
        errors.push({ row: candidate.rowNumber, message: assignmentError.message });
        continue;
      }
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
    insertedWorkItemIds.push(String(workItem.id));
    if (!["completed", "queued", "generating"].includes(generated)
      && text(row["Front Reference Image"] || row["Reference Image"])
      && text(row["Back Reference Image"])) queueableWorkItemIds.push(String(workItem.id));
    inserted++;
  }

  return { inserted, skipped, errors, workItemIds: insertedWorkItemIds, queueableWorkItemIds };
}

export async function createFromPlanningRequests(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const requestIds = [...new Set((Array.isArray(args.requestIds) ? args.requestIds : []).map((id) => text(id)).filter(Boolean))].slice(0, 100);
  if (!requestIds.length) throw new Error("Select at least one SKU.");
  const { data: requests, error } = await service.from("planning_requests")
    .select("id,organization_id,request_code,created_at,sku_name,color_label,photoshoot_type,generation_status,batch_id,generation_job_id,created_by_member_id,generation_started_at,generation_finished_at,queued_at,priority,assigned_member_id,expected_shoot_date,notes,archived_at")
    .eq("organization_id", workspace.organization.id)
    .in("id", requestIds);
  if (error) throw new Error(error.message);
  if ((requests || []).length !== requestIds.length) throw new Error("One or more selected SKUs are unavailable in this workspace.");
  if ((requests || []).some((request) => request.archived_at)) {
    throw new Error("One or more selected SKUs are archived. Add them again from an active Planning requirement before generating.");
  }

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
      priority: priority(request.priority),
      status: failed ? "blocked" : "in_progress",
      generation_status: generated,
      qc_status: completed ? "needs_review" : "not_started",
      listing_status: completed ? "pending" : "not_required",
      planning_request_id: request.id,
      planning_batch_id: request.batch_id,
      generation_job_id: job?.job_id || request.generation_job_id,
      catalog_session_id: job?.session_id || session?.session_id,
      created_by_member_id: workspace.member.id,
      generation_assigned_member_id: request.assigned_member_id || null,
      deadline_at: request.expected_shoot_date ? new Date(`${request.expected_shoot_date}T18:29:59.999Z`).toISOString() : null,
      special_instructions: request.notes || "",
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
  let targetMember: JsonRecord | null = null;
  if (memberId) {
    const { data: member, error } = await service.from("organization_members").select("id,email,display_name,notification_preferences")
      .eq("id", memberId).eq("organization_id", workspace.organization.id).eq("status", "active").maybeSingle();
    if (error) throw new Error(error.message);
    if (!member) throw new Error("The selected member is not active in this workspace.");
    targetMember = member as JsonRecord;
  }
  const field = assignment === "generation" ? "generation_assigned_member_id" : "listing_assigned_member_id";
  const { data: current, error: currentError } = await service.from("catalog_work_items")
    .select(`id,sku_name,request_code,${field}`).eq("id", workItemId).eq("organization_id", workspace.organization.id).maybeSingle();
  if (currentError) throw new Error(currentError.message);
  if (!current) throw new Error("Catalog work item not found.");
  const previousMemberId = text((current as JsonRecord)[field]) || null;
  if (previousMemberId === memberId) return { success: true };

  const { data, error } = await service.from("catalog_work_items").update({ [field]: memberId })
    .eq("id", workItemId).eq("organization_id", workspace.organization.id).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Catalog work item not found.");
  const now = new Date().toISOString();
  const operations: PromiseLike<unknown>[] = [
    service.from("catalog_work_item_assignments").update({ active: false, ended_at: now })
      .eq("work_item_id", workItemId).eq("assignment_type", assignment).eq("active", true),
    service.from("catalog_work_item_events").insert({
      organization_id: workspace.organization.id,
      work_item_id: workItemId,
      event_type: `${assignment}_assignment_changed`,
      actor_member_id: workspace.member.id,
      source: "user",
      message: `${assignment === "generation" ? "Generation" : "Listing"} owner changed`,
      metadata: { memberId, previousMemberId },
    }),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id,
      actor_member_id: workspace.member.id,
      actor_email: workspace.user.email,
      action: "catalog.assignment.changed",
      resource_type: "catalog_work_item",
      resource_id: workItemId,
      metadata: { assignment, memberId, previousMemberId },
    }),
  ];
  if (memberId) {
    operations.push(service.from("catalog_work_item_assignments").insert({
      organization_id: workspace.organization.id,
      work_item_id: workItemId,
      assignment_type: assignment,
      member_id: memberId,
      assigned_by_member_id: workspace.member.id,
      assigned_at: now,
      active: true,
    }));
    if (asRecord(targetMember?.notification_preferences).catalog_assignments_in_app !== false) {
      operations.push(service.from("notifications").insert({
        organization_id: workspace.organization.id,
        recipient_member_id: memberId,
        type: "catalog_assignment",
        channel: "in_app",
        title: `${assignment === "generation" ? "Generation" : "Listing"} task assigned`,
        body: `${current.request_code} · ${current.sku_name} is assigned to you.`,
        status: "sent",
        sent_at: now,
        created_by_member_id: workspace.member.id,
        payload: { entityType: "catalog_work_item", entityId: workItemId, assignment },
      }));
    }
  }
  assertQueryResults(await Promise.all(operations), "Could not finish the assignment change");
  return { success: true };
}

export async function reviewCatalogQc(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  const decision = text(args.decision).toLowerCase();
  const comments = text(args.comments);
  if (!workItemId || !["passed", "rejected"].includes(decision)) throw new Error("Choose a valid QC decision.");
  if (comments.length > 4_000) throw new Error("Reviewer comments must be 4,000 characters or fewer.");
  if (decision === "rejected" && !comments) throw new Error("Add reviewer guidance before requesting re-generation.");

  const { data: item, error: itemError } = await service.from("catalog_work_items")
    .select("id,generation_status,qc_status,listing_status,listing_sent_at,catalog_session_id,sku_name,request_code,generation_assigned_member_id,created_by_member_id")
    .eq("id", workItemId).eq("organization_id", workspace.organization.id).maybeSingle();
  if (itemError) throw new Error(itemError.message);
  if (!item || item.generation_status !== "completed") throw new Error("Generation must be complete before QC review.");
  if (item.listing_sent_at || ["in_progress", "completed"].includes(text(item.listing_status))) {
    throw new Error("This approved package has already been handed to the Listing Team and is immutable. Create a new catalog revision for further changes.");
  }
  if ((decision === "passed" && item.qc_status === "passed") || (decision === "rejected" && item.qc_status === "rejected")) {
    throw new Error(`This five-pose set is already ${decision === "passed" ? "approved" : "rejected"}.`);
  }
  if (decision === "passed") {
    const { data: versions, error: versionsError } = await service.from("catalog_pose_asset_versions")
      .select("pose_index,version_number,generation_status,approval_status")
      .eq("organization_id", workspace.organization.id)
      .eq("work_item_id", workItemId)
      .order("pose_index")
      .order("version_number", { ascending: false });
    if (versionsError) throw new Error(versionsError.message);
    const latestVersions = new Map<number, JsonRecord>();
    for (const version of versions || []) {
      const poseIndex = Number(version.pose_index);
      if (!latestVersions.has(poseIndex)) latestVersions.set(poseIndex, version as JsonRecord);
    }
    const completedPoseIndexes = new Set([...latestVersions.entries()]
      .filter(([, version]) => version.generation_status === "completed")
      .map(([poseIndex]) => poseIndex));
    if ([1, 2, 3, 4, 5].some((poseIndex) => !completedPoseIndexes.has(poseIndex))) {
      throw new Error("All five pose outputs must be complete before final approval.");
    }
    if ([...latestVersions.values()].some((version) => version.approval_status === "rejected")) {
      throw new Error("A rejected pose must be regenerated or approved before the five-pose set can pass final review.");
    }
  }
  const patch = decision === "passed"
    ? {
      qc_status: "passed", listing_status: "pending", listing_started_at: null, status: "in_progress",
      final_approved_at: new Date().toISOString(), final_approved_by_member_id: workspace.member.id,
      blocked_reason: "", failure_code: "",
    }
    : {
      qc_status: "rejected", status: "blocked", listing_status: "not_required",
      listing_started_at: null, listing_completed_at: null,
      final_approved_at: null, final_approved_by_member_id: null,
      blocked_reason: comments, next_action: "Regenerate the rejected pose set",
    };
  const { data, error } = await service.from("catalog_work_items").update(patch)
    .eq("id", workItemId).eq("organization_id", workspace.organization.id).eq("generation_status", "completed")
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Generation must be complete before QC review.");
  const reviewOperations: PromiseLike<unknown>[] = [
    service.from("catalog_asset_reviews").insert({
      organization_id: workspace.organization.id,
      work_item_id: workItemId,
      review_scope: "sku_set",
      decision: decision === "passed" ? "approved" : "changes_requested",
      reviewer_member_id: workspace.member.id,
      comments,
      metadata: { source: "catalog_production" },
    }),
    service.from("catalog_work_item_events").insert({
      organization_id: workspace.organization.id,
      work_item_id: workItemId,
      event_type: decision === "passed" ? "final_approval_recorded" : "regeneration_requested",
      actor_member_id: workspace.member.id,
      source: "user",
      stage_code: decision === "passed" ? "approved" : "regeneration_required",
      message: comments || (decision === "passed" ? "Five-pose set approved" : "Re-generation requested"),
      metadata: { decision },
    }),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id,
      actor_member_id: workspace.member.id,
      actor_email: workspace.user.email,
      action: decision === "passed" ? "catalog.final_approval.recorded" : "catalog.regeneration.requested",
      resource_type: "catalog_work_item",
      resource_id: workItemId,
      metadata: { comments },
    }),
  ];
  if (decision === "passed") {
    reviewOperations.push(service.from("notifications").insert({
      organization_id: workspace.organization.id,
      recipient_team: "listing-team",
      type: "catalog_ready_for_listing",
      channel: "in_app",
      title: "Approved catalog package ready",
      body: `${item.request_code} · ${item.sku_name} passed final review and is ready for handoff.`,
      status: "sent",
      sent_at: new Date().toISOString(),
      created_by_member_id: workspace.member.id,
      payload: { entityType: "catalog_work_item", entityId: workItemId },
    }));
  } else {
    reviewOperations.push(service.from("catalog_listing_handoffs").update({ status: "superseded", updated_at: new Date().toISOString() })
      .eq("organization_id", workspace.organization.id).eq("work_item_id", workItemId).eq("status", "ready"));
    const regenerationOwnerId = item.generation_assigned_member_id || item.created_by_member_id;
    if (regenerationOwnerId) {
      reviewOperations.push(service.from("notifications").insert({
        organization_id: workspace.organization.id,
        recipient_member_id: regenerationOwnerId,
        type: "catalog_regeneration_required",
        channel: "in_app",
        title: "Catalog re-generation required",
        body: `${item.request_code} · ${item.sku_name}: ${comments}`,
        status: "sent",
        sent_at: new Date().toISOString(),
        created_by_member_id: workspace.member.id,
        payload: { entityType: "catalog_work_item", entityId: workItemId },
      }));
    }
  }
  assertQueryResults(await Promise.all(reviewOperations), "Could not finish the QC audit trail");
  if (decision === "passed" && comments) {
    const { error: versionCommentError } = await service.from("catalog_pose_asset_versions").update({ reviewer_comments: comments })
      .eq("organization_id", workspace.organization.id).eq("work_item_id", workItemId).eq("approval_status", "approved");
    if (versionCommentError) throw new Error(versionCommentError.message);
  }
  return { success: true };
}

export async function reviewCatalogPose(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  const assetVersionId = text(args.assetVersionId);
  const decision = text(args.decision).toLowerCase();
  const comments = text(args.comments);
  if (!workItemId || !assetVersionId || !["approved", "rejected"].includes(decision)) throw new Error("Choose a valid pose review decision.");
  if (comments.length > 4_000) throw new Error("Reviewer comments must be 4,000 characters or fewer.");
  if (decision === "rejected" && !comments) throw new Error("Describe what must change before rejecting this pose.");

  const [{ data: item, error: itemError }, { data: version, error: versionError }] = await Promise.all([
    service.from("catalog_work_items")
      .select("id,sku_name,request_code,planning_request_id,planning_batch_id,generation_job_id,generation_status,qc_status,generation_assigned_member_id,created_by_member_id")
      .eq("organization_id", workspace.organization.id).eq("id", workItemId).maybeSingle(),
    service.from("catalog_pose_asset_versions")
      .select("id,pose_index,version_number,generation_id,generation_status,approval_status,original_url,preview_url,storage_path,storage_backend")
      .eq("organization_id", workspace.organization.id).eq("work_item_id", workItemId).eq("id", assetVersionId).maybeSingle(),
  ]);
  if (itemError || versionError) throw new Error(itemError?.message || versionError?.message || "Could not load the pose review.");
  if (!item || !version) throw new Error("The selected pose version is not available in this workspace.");
  if (version.generation_status !== "completed") throw new Error("Only a completed pose version can be reviewed.");
  if (version.approval_status === decision) throw new Error(`This pose version is already ${decision}.`);
  const { data: latestVersion, error: latestVersionError } = await service.from("catalog_pose_asset_versions")
    .select("id,version_number")
    .eq("organization_id", workspace.organization.id)
    .eq("work_item_id", workItemId)
    .eq("pose_index", version.pose_index)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) throw new Error(latestVersionError.message);
  if (!latestVersion || latestVersion.id !== assetVersionId) {
    throw new Error("Only the latest version of a pose can be reviewed. Refresh the workflow and review the current version.");
  }
  if (item.qc_status === "passed") {
    const { data: handoff, error: handoffError } = await service.from("catalog_listing_handoffs")
      .select("id,status")
      .eq("organization_id", workspace.organization.id)
      .eq("work_item_id", workItemId)
      .order("approval_revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (handoffError) throw new Error(handoffError.message);
    if (handoff && handoff.status !== "ready") {
      throw new Error("This approved package has already entered Listing Team delivery and is immutable. Create a new catalog revision for further changes.");
    }
    if (decision === "approved") throw new Error("This pose is already part of the final approved package.");
  }
  const now = new Date().toISOString();

  if (decision === "approved") {
    const supersedeResult = await service.from("catalog_pose_asset_versions").update({ approval_status: "superseded", updated_at: now })
      .eq("organization_id", workspace.organization.id).eq("work_item_id", workItemId)
      .eq("pose_index", version.pose_index).eq("approval_status", "approved").neq("id", assetVersionId);
    assertQueryResults([supersedeResult], "Could not supersede the previous approved pose version");
  }

  const versionResult = await service.from("catalog_pose_asset_versions").update({
    approval_status: decision,
    approved_by_member_id: decision === "approved" ? workspace.member.id : null,
    approved_at: decision === "approved" ? now : null,
    reviewer_comments: comments,
    final_asset_url: decision === "approved" ? text(version.original_url || version.preview_url) : "",
    updated_at: now,
  }).eq("organization_id", workspace.organization.id).eq("work_item_id", workItemId).eq("id", assetVersionId);
  if (versionResult.error) throw new Error(versionResult.error.message);

  const humanOutcome = decision === "approved" ? "human_approved" : "human_rejected";
  const humanReviewResults = await Promise.all([
    service.from("session_generations").update({ qa_status: humanOutcome, updated_at: now }).eq("generation_id", version.generation_id),
    service.from("qa_reviews").insert({
      organization_id: workspace.organization.id,
      planning_request_id: item.planning_request_id,
      generation_job_id: text(item.generation_job_id),
      pose_index: version.pose_index,
      reviewer_type: "human_catalog_qc",
      score: null,
      passed: decision === "approved",
      issues: decision === "approved" ? [] : ["human_rejected"],
      notes: comments,
      qa_version: "human-qc-v14",
      outcome: humanOutcome,
      metadata: { assetVersionId, reviewerMemberId: workspace.member.id, versionNumber: version.version_number },
    }).select("id").single(),
  ]);
  assertQueryResults(humanReviewResults, "Could not save the human QC audit result");
  // A saree Pose 1 that needed human review must not be used while uncertain,
  // but once approved it can become the batch continuity anchor. Conversely, a
  // later human rejection invalidates this frame only when it is the anchor that
  // batch memory currently owns; reviewing another SKU must not revoke a good
  // anchor from an earlier SKU.
  if (Number(version.pose_index) === 1 && item.planning_batch_id) {
    const { data: batch, error: batchError } = await service.from("planning_batches")
      .select("catalog_memory").eq("id", item.planning_batch_id).maybeSingle();
    if (batchError) throw new Error(batchError.message);
    const memory = asRecord(batch?.catalog_memory);
    const ownsCurrentAnchor = text(memory.anchorJobId) === text(item.generation_job_id);
    const hasAnchor = Boolean(memory.anchorOutputUrl || memory.anchorStoragePath);
    const canPromote = decision === "approved" && !hasAnchor;
    if (ownsCurrentAnchor || canPromote) {
      const anchorPatch = canPromote
        ? {
          anchorOutputUrl: text(version.original_url || version.preview_url),
          anchorStoragePath: text(version.storage_path),
          anchorStorageBackend: text(version.storage_backend || "firebase"),
          anchorJobId: item.generation_job_id,
          anchorQaStatus: humanOutcome,
          anchorQaVersion: "human-qc-v14",
        }
        : { anchorQaStatus: humanOutcome, anchorQaVersion: "human-qc-v14" };
      const { error: anchorError } = await service.rpc("merge_catalog_memory", {
        p_batch_id: item.planning_batch_id,
        p_patch: anchorPatch,
        p_require_absent: canPromote ? "anchorOutputUrl" : null,
      });
      if (anchorError) throw new Error(anchorError.message);
      const { error: memoryUpdatedError } = await service.from("planning_batches")
        .update({ memory_updated_at: now }).eq("id", item.planning_batch_id);
      if (memoryUpdatedError) throw new Error(memoryUpdatedError.message);
    }
  }

  let reopenSetReview = false;
  if (decision === "approved" && item.qc_status === "rejected") {
    const { data: allVersions, error: allVersionsError } = await service.from("catalog_pose_asset_versions")
      .select("pose_index,version_number,approval_status")
      .eq("organization_id", workspace.organization.id).eq("work_item_id", workItemId)
      .order("pose_index").order("version_number", { ascending: false });
    if (allVersionsError) throw new Error(allVersionsError.message);
    const latestByPose = new Map<number, JsonRecord>();
    for (const candidate of allVersions || []) {
      const poseIndex = Number(candidate.pose_index);
      if (!latestByPose.has(poseIndex)) latestByPose.set(poseIndex, candidate as JsonRecord);
    }
    reopenSetReview = ![...latestByPose.values()].some((candidate) => candidate.approval_status === "rejected");
  }

  const operations: PromiseLike<unknown>[] = [
    service.from("catalog_asset_reviews").insert({
      organization_id: workspace.organization.id,
      work_item_id: workItemId,
      asset_version_id: assetVersionId,
      review_scope: "pose",
      decision,
      reviewer_member_id: workspace.member.id,
      comments,
      metadata: { poseIndex: version.pose_index, versionNumber: version.version_number },
    }),
    service.from("catalog_work_item_events").insert({
      organization_id: workspace.organization.id,
      work_item_id: workItemId,
      event_type: decision === "approved" ? "pose_approved" : "pose_rejected",
      actor_member_id: workspace.member.id,
      source: "user",
      stage_code: decision === "approved" ? "quality_review" : "regeneration_required",
      related_asset_version_id: assetVersionId,
      message: comments || `Pose ${version.pose_index} version ${version.version_number} approved`,
      metadata: { decision, poseIndex: version.pose_index, versionNumber: version.version_number },
    }),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id,
      actor_member_id: workspace.member.id,
      actor_email: workspace.user.email,
      action: decision === "approved" ? "catalog.pose.approved" : "catalog.pose.rejected",
      resource_type: "catalog_pose_asset_version",
      resource_id: assetVersionId,
      metadata: { workItemId, comments, poseIndex: version.pose_index, versionNumber: version.version_number },
    }),
  ];
  if (decision === "rejected") {
    operations.push(service.from("catalog_work_items").update({
      qc_status: "rejected",
      status: "blocked",
      listing_status: "not_required",
      listing_started_at: null,
      listing_completed_at: null,
      final_approved_at: null,
      final_approved_by_member_id: null,
      blocked_reason: comments,
      next_action: `Regenerate pose ${version.pose_index}`,
    }).eq("organization_id", workspace.organization.id).eq("id", workItemId));
    operations.push(service.from("catalog_listing_handoffs").update({ status: "superseded", updated_at: now })
      .eq("organization_id", workspace.organization.id).eq("work_item_id", workItemId).eq("status", "ready"));
    const ownerId = item.generation_assigned_member_id || item.created_by_member_id;
    if (ownerId) operations.push(service.from("notifications").insert({
      organization_id: workspace.organization.id,
      recipient_member_id: ownerId,
      type: "catalog_regeneration_required",
      channel: "in_app",
      title: `Pose ${version.pose_index} needs re-generation`,
      body: `${item.request_code} · ${item.sku_name}: ${comments}`,
      status: "sent",
      sent_at: now,
      created_by_member_id: workspace.member.id,
      payload: { entityType: "catalog_work_item", entityId: workItemId, assetVersionId, poseIndex: version.pose_index },
    }));
  } else if (reopenSetReview) {
    operations.push(service.from("catalog_work_items").update({
      qc_status: "needs_review",
      status: "in_progress",
      blocked_reason: "",
      failure_code: "",
      next_action: "Approve or reject the five-pose set",
    }).eq("organization_id", workspace.organization.id).eq("id", workItemId));
  }
  assertQueryResults(await Promise.all(operations), "Could not finish the pose review audit trail");
  if (decision === "rejected") {
    await recordHumanProductLearningRule({
      service,
      workspace,
      planningRequestId: text(item.planning_request_id),
      assetVersionId,
      sourceQaReviewId: text((humanReviewResults[1] as { data?: { id?: string } }).data?.id),
      poseIndex: Number(version.pose_index),
      comments,
      now,
    });
  }
  return { success: true, decision, poseIndex: version.pose_index, versionNumber: version.version_number };
}

export async function markListingStarted(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  if (!workItemId) throw new Error("Catalog work item is required.");
  const now = new Date().toISOString();
  const { data, error } = await service.from("catalog_work_items").update({
    listing_status: "in_progress",
    listing_started_at: now,
  }).eq("id", workItemId)
    .eq("organization_id", workspace.organization.id)
    .eq("generation_status", "completed")
    .eq("qc_status", "passed")
    .not("listing_sent_at", "is", null)
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The approved asset package must be sent before listing can start.");
  assertQueryResults(await Promise.all([
    service.from("catalog_listing_handoffs").update({ status: "listing_in_progress", listing_started_at: now, updated_at: now })
      .eq("organization_id", workspace.organization.id).eq("work_item_id", workItemId).eq("status", "sent"),
    service.from("catalog_work_item_events").insert({
      organization_id: workspace.organization.id, work_item_id: workItemId,
      event_type: "listing_started", actor_member_id: workspace.member.id, source: "user",
      stage_code: "listing_in_progress", message: "Listing Team started marketplace listing",
    }),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id, actor_member_id: workspace.member.id,
      actor_email: workspace.user.email, action: "catalog.listing.started",
      resource_type: "catalog_work_item", resource_id: workItemId,
    }),
  ]), "Could not finish the listing-start audit trail");
  return { success: true };
}

export async function markListingDone(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  if (!workItemId) throw new Error("Catalog work item is required.");
  const now = new Date().toISOString();
  const { data, error } = await service.from("catalog_work_items").update({
    listing_status: "completed",
    listing_completed_at: now,
  })
    .eq("id", workItemId)
    .eq("organization_id", workspace.organization.id)
    .eq("generation_status", "completed")
    .eq("qc_status", "passed")
    .eq("listing_status", "in_progress")
    .not("listing_sent_at", "is", null)
    .not("listing_started_at", "is", null)
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Start listing from the sent Listing Team handoff before marking it complete.");
  assertQueryResults(await Promise.all([
    service.from("catalog_listing_handoffs").update({ status: "listed", listed_at: now, updated_at: now })
      .eq("organization_id", workspace.organization.id).eq("work_item_id", workItemId).in("status", ["sent", "listing_in_progress"]),
    service.from("catalog_work_item_events").insert({
      organization_id: workspace.organization.id, work_item_id: workItemId,
      event_type: "listing_completed", actor_member_id: workspace.member.id, source: "user",
      stage_code: "listed", message: "Marketplace listing marked complete",
    }),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id, actor_member_id: workspace.member.id,
      actor_email: workspace.user.email, action: "catalog.listing.completed",
      resource_type: "catalog_work_item", resource_id: workItemId,
    }),
  ]), "Could not finish the listing-completion audit trail");
  return { success: true };
}

function stringList(value: unknown, limit = 20) {
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => text(entry)).filter(Boolean))].slice(0, limit);
}

export async function updateCatalogWorkItem(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  if (!workItemId) throw new Error("Catalog work item is required.");
  const allowedPriorities = ["low", "normal", "high", "urgent"];
  const requestedPriority = text(args.priority).toLowerCase();
  const deadlineAt = text(args.deadlineAt);
  if (deadlineAt && !Number.isFinite(Date.parse(deadlineAt))) throw new Error("Enter a valid deadline.");
  const specialInstructions = text(args.specialInstructions);
  const marketplaces = stringList(args.marketplaces);
  if (specialInstructions.length > 4_000) throw new Error("Special instructions must be 4,000 characters or fewer.");
  const patch: JsonRecord = {
    priority: allowedPriorities.includes(requestedPriority) ? requestedPriority : "normal",
    deadline_at: deadlineAt ? new Date(deadlineAt).toISOString() : null,
    marketplaces,
    campaign_season: text(args.campaignSeason) || null,
    special_instructions: specialInstructions,
    remarks: text(args.remarks) || null,
    blocked_reason: text(args.blockedReason),
    campaign_event_details: args.campaignEventDetails && typeof args.campaignEventDetails === "object" ? args.campaignEventDetails : {},
  };
  const { data: currentItem, error: currentItemError } = await service.from("catalog_work_items")
    .select("id,status,generation_status,qc_status")
    .eq("id", workItemId).eq("organization_id", workspace.organization.id).maybeSingle();
  if (currentItemError) throw new Error(currentItemError.message);
  if (!currentItem) throw new Error("Catalog work item not found.");
  if (patch.blocked_reason) patch.status = "blocked";
  else if (currentItem.status === "blocked" && currentItem.generation_status !== "failed" && currentItem.qc_status !== "rejected") {
    patch.status = "in_progress";
    patch.failure_code = "";
  }
  const { data, error } = await service.from("catalog_work_items").update(patch)
    .eq("id", workItemId).eq("organization_id", workspace.organization.id).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Catalog work item not found.");

  const direction = args.creativeDirection && typeof args.creativeDirection === "object"
    ? args.creativeDirection as JsonRecord
    : {};
  const directionRow = {
    organization_id: workspace.organization.id,
    work_item_id: workItemId,
    look_and_mood: text(direction.lookAndMood),
    model_direction: text(direction.modelDirection),
    styling_requirements: text(direction.stylingRequirements),
    pose_direction: Array.isArray(direction.poses) ? direction.poses.slice(0, 5) : [],
    background_backdrop: text(direction.backgroundBackdrop),
    lighting: text(direction.lighting),
    composition: text(direction.composition),
    marketplace_requirements: text(direction.marketplaceRequirements),
    created_by_member_id: workspace.member.id,
    updated_at: new Date().toISOString(),
  };
  const { error: directionError } = await service.from("catalog_creative_directions")
    .upsert(directionRow, { onConflict: "organization_id,work_item_id" });
  if (directionError) throw new Error(directionError.message);

  assertQueryResults(await Promise.all([
    service.from("catalog_work_item_events").insert({
      organization_id: workspace.organization.id, work_item_id: workItemId,
      event_type: "production_details_updated", actor_member_id: workspace.member.id,
      source: "user", message: "Production details and creative direction updated",
    }),
    service.from("audit_logs").insert({
      organization_id: workspace.organization.id, actor_member_id: workspace.member.id,
      actor_email: workspace.user.email, action: "catalog.production_details.updated",
      resource_type: "catalog_work_item", resource_id: workItemId,
      metadata: { priority: patch.priority, deadlineAt: patch.deadline_at, marketplaceCount: marketplaces.length },
    }),
  ]), "Could not finish the production-details audit trail");
  return { success: true };
}

export async function addCatalogWorkItemComment(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  const body = text(args.body);
  const visibility = text(args.visibility) === "listing_team" ? "listing_team" : "workspace";
  if (!workItemId || !body) throw new Error("Add a comment before saving.");
  if (body.length > 4_000) throw new Error("Comments must be 4,000 characters or fewer.");
  const { data: item, error: itemError } = await service.from("catalog_work_items").select("id")
    .eq("id", workItemId).eq("organization_id", workspace.organization.id).maybeSingle();
  if (itemError) throw new Error(itemError.message);
  if (!item) throw new Error("Catalog work item not found.");
  const { data, error } = await service.from("catalog_work_item_comments").insert({
    organization_id: workspace.organization.id,
    work_item_id: workItemId,
    author_member_id: workspace.member.id,
    body,
    visibility,
  }).select("id,created_at").single();
  if (error || !data) throw new Error(error?.message || "Could not save the comment.");
  const eventResult = await service.from("catalog_work_item_events").insert({
    organization_id: workspace.organization.id, work_item_id: workItemId,
    event_type: "comment_added", actor_member_id: workspace.member.id,
    source: "user", message: body, metadata: { commentId: data.id, visibility },
  });
  assertQueryResults([eventResult], "Could not record the comment activity");
  return data;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function tenantCatalogAssetPath(orgId: string, requestedPath: string) {
  const normalized = requestedPath.replace(/^\/+/, "");
  const legacyPrefix = `organizations/${orgId}/`;
  const path = normalized.startsWith(legacyPrefix) ? `${orgId}/${normalized.slice(legacyPrefix.length)}` : normalized;
  if (!path.startsWith(`${orgId}/`) || path.includes("../")) throw new Error("Catalog Storage path is outside the organization prefix.");
  return path;
}

async function signedCatalogAssetUrl(service: SupabaseClient, orgId: string, row: JsonRecord, fallbackField: string) {
  const fallback = text(row[fallbackField]);
  if (text(row.storage_backend) !== "supabase" || !text(row.storage_path)) return fallback;
  const storagePath = tenantCatalogAssetPath(orgId, text(row.storage_path));
  const { data, error } = await service.storage.from("catalog-assets").createSignedUrl(storagePath, 7 * 24 * 60 * 60);
  return error || !data?.signedUrl ? fallback : data.signedUrl;
}

export async function getCatalogWorkflowDetail(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  args: JsonRecord,
) {
  const workItemId = text(args.workItemId);
  const jobId = text(args.jobId);
  if (jobId && !/^[a-zA-Z0-9_-]{1,160}$/.test(jobId)) throw new Error("Invalid generation job identifier.");
  let itemQuery = service.from("catalog_work_items").select("*")
    .eq("organization_id", workspace.organization.id);
  if (workItemId) itemQuery = itemQuery.eq("id", workItemId);
  else if (jobId) itemQuery = itemQuery.or(`generation_job_id.eq.${jobId},catalog_session_id.eq.${jobId}`);
  else throw new Error("A catalog work item or generation job is required.");
  const { data: item, error: itemError } = await itemQuery.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (itemError) throw new Error(itemError.message);
  if (!item) return null;

  const sessionId = text(item.catalog_session_id);
  const generationJobId = text(item.generation_job_id);
  const [
    stagesResult,
    eventsResult,
    commentsResult,
    directionsResult,
    assignmentsResult,
    versionsResult,
    reviewsResult,
    handoffsResult,
    batchResult,
    requestResult,
    assetsResult,
    jobResult,
    sessionResult,
    posesResult,
  ] = await Promise.all([
    service.from("catalog_workflow_stage_definitions").select("*").order("stage_order"),
    service.from("catalog_work_item_events").select("*").eq("organization_id", workspace.organization.id).eq("work_item_id", item.id).order("created_at"),
    service.from("catalog_work_item_comments").select("*").eq("organization_id", workspace.organization.id).eq("work_item_id", item.id).is("deleted_at", null).order("created_at"),
    service.from("catalog_creative_directions").select("*").eq("organization_id", workspace.organization.id).eq("work_item_id", item.id).maybeSingle(),
    service.from("catalog_work_item_assignments").select("*").eq("organization_id", workspace.organization.id).eq("work_item_id", item.id).order("assigned_at", { ascending: false }),
    service.from("catalog_pose_asset_versions").select("*").eq("organization_id", workspace.organization.id).eq("work_item_id", item.id).order("pose_index").order("version_number", { ascending: false }),
    service.from("catalog_asset_reviews").select("*").eq("organization_id", workspace.organization.id).eq("work_item_id", item.id).order("created_at", { ascending: false }),
    service.from("catalog_listing_handoffs").select("*").eq("organization_id", workspace.organization.id).eq("work_item_id", item.id).order("approval_revision", { ascending: false }),
    item.planning_batch_id ? service.from("planning_batches").select("*").eq("organization_id", workspace.organization.id).eq("id", item.planning_batch_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    item.planning_request_id ? service.from("planning_requests").select("*").eq("organization_id", workspace.organization.id).eq("id", item.planning_request_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    item.planning_request_id ? service.from("planning_assets").select("*").eq("organization_id", workspace.organization.id).eq("planning_request_id", item.planning_request_id).order("created_at") : Promise.resolve({ data: [], error: null }),
    generationJobId ? service.from("generation_jobs").select("*").eq("org_id", workspace.organization.id).eq("job_id", generationJobId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sessionId ? service.from("catalog_sessions").select("*").eq("organization_id", workspace.organization.id).eq("session_id", sessionId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sessionId ? service.from("session_generations").select("*").eq("session_id", sessionId).order("pose_index") : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [stagesResult, eventsResult, commentsResult, directionsResult, assignmentsResult, versionsResult, reviewsResult, handoffsResult, batchResult, requestResult, assetsResult, jobResult, sessionResult, posesResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const memberIds = [...new Set([
    item.created_by_member_id,
    item.generation_assigned_member_id,
    item.listing_assigned_member_id,
    item.final_approved_by_member_id,
    ...(eventsResult.data || []).map((event) => event.actor_member_id),
    ...(commentsResult.data || []).map((comment) => comment.author_member_id),
    ...(assignmentsResult.data || []).flatMap((assignment) => [assignment.member_id, assignment.assigned_by_member_id]),
    ...(reviewsResult.data || []).map((review) => review.reviewer_member_id),
  ].map((id) => text(id)).filter(Boolean))];
  const { data: members, error: membersError } = memberIds.length
    ? await service.from("organization_members").select("id,display_name,email,status").eq("organization_id", workspace.organization.id).in("id", memberIds)
    : { data: [], error: null };
  if (membersError) throw new Error(membersError.message);
  const memberById = new Map((members || []).map((member) => [String(member.id), member]));
  const decorateMember = (id: unknown) => memberById.get(text(id)) || null;

  const events = (eventsResult.data || []).map((event) => ({ ...event, actor: decorateMember(event.actor_member_id) }));
  const stageRows = buildCatalogStageTimeline(stagesResult.data || [], eventsResult.data || [], item);

  const poseVersions = await Promise.all((versionsResult.data || []).map(async (version) => {
    const signedUrl = await signedCatalogAssetUrl(service, workspace.organization.id, version as JsonRecord, "original_url");
    return {
      ...version,
      preview_url: signedUrl || version.preview_url,
      original_url: signedUrl || version.original_url,
      final_asset_url: version.final_asset_url ? signedUrl || version.final_asset_url : version.final_asset_url,
    };
  }));
  const poseRows = await Promise.all((posesResult.data || []).map(async (pose) => ({
    ...pose,
    output_url: await signedCatalogAssetUrl(service, workspace.organization.id, pose as JsonRecord, "output_url") || pose.output_url,
  })));
  const latestByPose = [1, 2, 3, 4, 5].map((poseIndex) => {
    const versions = poseVersions.filter((version) => Number(version.pose_index) === poseIndex);
    const currentPose = poseRows.find((pose) => Number(pose.pose_index) === poseIndex);
    const generationData = asRecord(currentPose?.generation_data);
    const referenceManifests = Array.isArray(generationData.referenceManifests) ? generationData.referenceManifests : [];
    const latestReferenceManifest = referenceManifests.at(-1) || null;
    return {
      poseIndex,
      title: text(versions[0]?.title || currentPose?.title || `Pose ${poseIndex}`),
      current: versions[0] ? { ...versions[0], reference_manifest: latestReferenceManifest } : (currentPose ? {
        generation_id: currentPose.generation_id,
        pose_index: currentPose.pose_index,
        version_number: Number(currentPose.generation_epoch || 1),
        preview_url: currentPose.output_url,
        original_url: currentPose.output_url,
        storage_path: currentPose.storage_path,
        generation_status: currentPose.status,
        approval_status: "pending",
        generated_at: currentPose.updated_at,
        prompt: currentPose.full_prompt,
        model: jobResult.data?.model || "",
        prompt_metadata: currentPose.usage_payload,
        regeneration_metadata: { history: currentPose.regeneration_history },
        reference_manifest: latestReferenceManifest,
      } : null),
      versions,
      reviews: (reviewsResult.data || []).filter((review) => versions.some((version) => version.id === review.asset_version_id)),
    };
  });
  const completedPoseCount = latestByPose.filter((pose) => pose.current && ["completed", "approved"].includes(text(pose.current.generation_status || pose.current.approval_status))).length;

  const request = requestResult.data;
  const currentReferenceRows = selectCurrentCatalogProductReferences((assetsResult.data || []).map((asset) => ({
    id: text(asset.id),
    role: text(asset.asset_role),
    downloadUrl: text(asset.image_url),
    storagePath: text(asset.storage_path),
  })), {
    frontDownloadUrl: text(request?.front_image_url),
    frontStoragePath: text(request?.front_image_path),
    backDownloadUrl: text(request?.back_image_url),
    backStoragePath: text(request?.back_image_path),
  });
  const currentReferenceIds = new Set(currentReferenceRows.map((reference) => reference.id));
  const references = await Promise.all((assetsResult.data || []).map(async (asset) => ({
    ...asset,
    is_current_product_reference: currentReferenceIds.has(text(asset.id)),
    image_url: await signedCatalogAssetUrl(service, workspace.organization.id, asset as JsonRecord, "image_url") || asset.image_url,
  })));
  const dependencyReferences = currentReferenceRows.map((reference) => ({
    role: reference.role, downloadUrl: text(reference.downloadUrl), storagePath: text(reference.storagePath),
  }));
  if ((request?.front_image_url || request?.front_image_path) && !dependencyReferences.some((reference) => ["front", "saree_front_drape"].includes(reference.role))) {
    dependencyReferences.push({ role: "front", downloadUrl: text(request.front_image_url), storagePath: text(request.front_image_path) });
  }
  if ((request?.back_image_url || request?.back_image_path) && !dependencyReferences.some((reference) => ["back", "saree_back_drape"].includes(reference.role))) {
    dependencyReferences.push({ role: "back", downloadUrl: text(request.back_image_url), storagePath: text(request.back_image_path) });
  }
  const sareeReferences = isSareeReferenceSet(dependencyReferences, text(request?.category));
  const missingReferenceLabels = missingRequiredReferenceLabels(dependencyReferences, text(request?.category));
  const latestHandoff = handoffsResult.data?.[0] || null;
  const dependencies = [
    ...(sareeReferences
      ? [
        ["saree_front_reference", "Full saree front"],
        ["saree_back_reference", "Rear/back drape"],
        ["saree_pallu_reference", "Fully spread pallu"],
        ["saree_body_reference", "Saree body/weave detail"],
      ].map(([key, label]) => ({ key, label, status: missingReferenceLabels.includes(label.toLowerCase()) ? "missing" : "complete" }))
      : [
        { key: "front_reference", label: "Front product reference", status: missingReferenceLabels.includes("front product") ? "missing" : "complete" },
        { key: "back_reference", label: "Back product reference", status: missingReferenceLabels.includes("back product") ? "missing" : "complete" },
      ]),
    { key: "pose_plan", label: "Five-pose plan", status: Array.isArray(request?.pose_plan) && request.pose_plan.length === 5 ? "complete" : "pending" },
    { key: "pose_outputs", label: "Five generated outputs", status: completedPoseCount === 5 ? "complete" : completedPoseCount ? "in_progress" : "pending", detail: `${completedPoseCount}/5 complete` },
    { key: "human_approval", label: "Final human approval", status: item.final_approved_at ? "complete" : item.qc_status === "rejected" ? "failed" : "pending" },
    { key: "listing_handoff", label: "Listing Team handoff", status: latestHandoff?.sent_at ? "complete" : latestHandoff ? "ready" : "pending" },
  ];
  const canManage = workspace.isAdmin || workspace.permissions.includes("planning.manage");
  const canManageHandoffs = workspace.isAdmin || workspace.permissions.includes("catalog.handoff.manage");
  const canApprove = workspace.isAdmin || workspace.permissions.includes("planning.approve");
  const canGenerate = workspace.isAdmin || workspace.permissions.includes("planning.generate_images");
  const canList = workspace.isAdmin || workspace.permissions.includes("catalog.listing.complete") || workspace.roles.some((role) => role.slug === "listing-team");
  const canRegenerate = canApprove || canGenerate;
  const actions: JsonRecord[] = [];
  if (["blocked_failed", "regeneration_required"].includes(item.workflow_stage)) actions.push({ type: "retry_generation", label: "Retry generation", enabled: canGenerate });
  if (item.workflow_stage === "quality_review") {
    actions.push({ type: "approve", label: "Approve five-pose set", enabled: canApprove && completedPoseCount === 5 });
    actions.push({ type: "reject", label: "Request re-generation", enabled: canApprove });
  }
  if (item.workflow_stage === "ready_for_listing") actions.push({ type: "send_handoff", label: "Send to Listing Team", enabled: canManageHandoffs });
  if (item.workflow_stage === "sent_to_listing_team") actions.push({ type: "start_listing", label: "Start listing", enabled: canList });
  if (item.workflow_stage === "listing_in_progress") actions.push({ type: "complete_listing", label: "Mark listed", enabled: canList });

  return {
    is_workflow_v2: true,
    item: {
      ...item,
      generation_assigned_member: decorateMember(item.generation_assigned_member_id),
      listing_assigned_member: decorateMember(item.listing_assigned_member_id),
      final_approved_by_member: decorateMember(item.final_approved_by_member_id),
    },
    batch: batchResult.data,
    planningRequest: request,
    creativeDirection: directionsResult.data,
    generationJob: jobResult.data,
    session: sessionResult.data,
    stages: stageRows,
    poses: latestByPose,
    dependencies,
    activity: events.slice().reverse(),
    comments: (commentsResult.data || []).map((comment) => ({ ...comment, author: decorateMember(comment.author_member_id) })),
    assignments: (assignmentsResult.data || []).map((assignment) => ({
      ...assignment,
      member: decorateMember(assignment.member_id),
      assignedBy: decorateMember(assignment.assigned_by_member_id),
    })),
    reviews: reviewsResult.data || [],
    handoffs: handoffsResult.data || [],
    references,
    actions,
    permissions: { canManage, canManageHandoffs, canApprove, canGenerate, canList, canRegenerate },
    progress: {
      percent: Number(item.workflow_progress || 0),
      completedPoseCount,
      totalPoseCount: 5,
      currentPose: Number(jobResult.data?.current_pose || 0),
      currentStep: item.current_step || item.next_action,
    },
  };
}

export async function reconcileExistingGenerations(
  service: SupabaseClient,
  workspace: CatalogWorkspace,
  _args: JsonRecord,
) {
  const { data: workItems, error } = await service.from("catalog_work_items")
    .select("id,sku_name,planning_request_id,qc_status")
    .eq("organization_id", workspace.organization.id)
    .is("generation_job_id", null);
  if (error) throw new Error(error.message);

  let exactMatches = 0;
  let ambiguous = 0;
  for (const item of workItems || []) {
    let job: JsonRecord | null = null;
    if (item.planning_request_id) {
      const result = await service.from("generation_jobs")
        .select("job_id,session_id,status,started_at,completed_at")
        .eq("planning_request_id", item.planning_request_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      job = result.data as JsonRecord | null;
    }
    if (!job) continue;
    const generated = generationStatus(job.status);
    const { error: updateError } = await service.from("catalog_work_items").update({
      generation_job_id: job.job_id,
      catalog_session_id: job.session_id,
      generation_status: generated,
      generation_started_at: job.started_at || null,
      generation_completed_at: generated === "completed" ? job.completed_at || new Date().toISOString() : null,
      qc_status: generated === "completed" ? (item.qc_status === "passed" ? "passed" : "needs_review") : "not_started",
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
  let queued = 0;

  const linkedRequestIds = [...new Set((workItems || []).map((item) => text(item.planning_request_id)).filter(Boolean))];
  const { data: linkedRequests, error: requestsError } = linkedRequestIds.length
    ? await service.from("planning_requests")
      .select("*")
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
      .in("asset_role", [...PRODUCT_REFERENCE_ROLES])
      .order("created_at")
    : { data: [], error: null };
  if (linkedAssetsError) throw new Error(linkedAssetsError.message);

  const requestById = new Map((linkedRequests || []).map((request) => [String(request.id), request]));
  for (const item of workItems || []) {
    const requestId = text(item.planning_request_id);
    if (!requestId) {
      if (!text(item.reference_image_url) || !text(item.back_reference_image_url)) throw new Error(`${item.sku_name} needs both front and back reference images before generation can start.`);
      continue;
    }
    const request = requestById.get(requestId);
    assertCatalogRequestEvidenceReady(request, text(item.sku_name));
    const requestAssets = (linkedAssets || []).filter((asset) => String(asset.planning_request_id) === requestId);
    const availableReferences = selectCurrentCatalogProductReferences(requestAssets.map((asset) => ({
      role: text(asset.asset_role), downloadUrl: text(asset.image_url), storagePath: text(asset.storage_path),
    })), {
      frontDownloadUrl: text(request?.front_image_url),
      frontStoragePath: text(request?.front_image_path),
      backDownloadUrl: text(request?.back_image_url),
      backStoragePath: text(request?.back_image_path),
    });
    if ((request?.front_image_url || request?.front_image_path) && !availableReferences.some((reference) => ["front", "saree_front_drape"].includes(reference.role))) {
      availableReferences.push({ role: "front", downloadUrl: text(request.front_image_url), storagePath: text(request.front_image_path) });
    }
    if ((request?.back_image_url || request?.back_image_path) && !availableReferences.some((reference) => ["back", "saree_back_drape"].includes(reference.role))) {
      availableReferences.push({ role: "back", downloadUrl: text(request.back_image_url), storagePath: text(request.back_image_path) });
    }
    const missing = missingRequiredReferenceLabels(availableReferences, text(request?.category));
    if (missing.length) throw new Error(`${item.sku_name} is missing required product evidence: ${missing.join(", ")}.`);
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
    poseQa: false,
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
  const upsertRequests: JsonRecord[] = [];
  const insertAssets: JsonRecord[] = [];
  const upsertWorkItems: JsonRecord[] = [];

  for (const item of workItems || []) {
    if (activeItems.some(i => i.id === item.id)) continue;
    queued++;
    let requestId = text(item.planning_request_id);
    let request = requestId ? requestById.get(requestId) : undefined;
    let batchId = text(request?.batch_id) || adHocBatchId;
    if (!requestId) {
      requestId = crypto.randomUUID();
      batchId = adHocBatchId;
      upsertRequests.push({
        id: requestId,
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
        back_image_url: item.back_reference_image_url,
        validation_status: "ready",
        validation_report: { ready: true, reasons: [] },
        analysis_status: "stale",
        updated_at: now,
      });
      const referenceUrl = text(item.reference_image_url);
      const backReferenceUrl = text(item.back_reference_image_url);
      insertAssets.push(
        { organization_id: workspace.organization.id, planning_request_id: requestId, sku_name: item.sku_name, prompt: "", image_url: referenceUrl, storage_path: "", sku_matched: true, asset_role: "front", storage_backend: "external", metadata: { source: "catalog_production_import", role: "front" } },
        { organization_id: workspace.organization.id, planning_request_id: requestId, sku_name: item.sku_name, prompt: "", image_url: backReferenceUrl, storage_path: "", sku_matched: true, asset_role: "back", storage_backend: "external", metadata: { source: "catalog_production_import", role: "back" } }
      );
    } else {
      if (!request?.batch_id) {
        batchId = adHocBatchId;
      }
      const requestAssets = (linkedAssets || []).filter((asset) => String(asset.planning_request_id) === requestId);
      const currentRequestAssets = selectCurrentCatalogProductReferences(requestAssets.map((asset) => ({
        ...asset,
        role: text(asset.asset_role),
        downloadUrl: text(asset.image_url),
        storagePath: text(asset.storage_path),
      })), {
        frontDownloadUrl: text(request?.front_image_url),
        frontStoragePath: text(request?.front_image_path),
        backDownloadUrl: text(request?.back_image_url),
        backStoragePath: text(request?.back_image_path),
      });
      const frontAsset = currentRequestAssets.find((asset) => ["saree_front_drape", "front"].includes(text(asset.role)));
      const backAsset = currentRequestAssets.find((asset) => ["saree_back_drape", "back"].includes(text(asset.role)));
      const referencePatch: JsonRecord = {};
      if (request && !request.front_image_url && frontAsset?.image_url) referencePatch.front_image_url = frontAsset.image_url;
      if (request && !request.front_image_path && frontAsset?.storage_path) referencePatch.front_image_path = frontAsset.storage_path;
      if (request && !request.back_image_url && backAsset?.image_url) referencePatch.back_image_url = backAsset.image_url;
      if (request && !request.back_image_path && backAsset?.storage_path) referencePatch.back_image_path = backAsset.storage_path;
      
      upsertRequests.push({
        ...request,
        ...referencePatch,
        batch_id: batchId,
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
      });
    }

    upsertWorkItems.push({
      ...item,
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
      blocked_reason: "",
      failure_code: "",
    });

    requestIdsByBatch.set(batchId, [...(requestIdsByBatch.get(batchId) || []), requestId]);
  }

  // Deduplicate upsertRequests by ID since multiple work items might point to the same planning_request_id
  const uniqueRequests = new Map(upsertRequests.map(r => [String(r.id), r]));

  if (uniqueRequests.size) {
    const { error } = await service.from("planning_requests").upsert(Array.from(uniqueRequests.values()));
    if (error) throw new Error(`Could not upsert planning requests: ${error.message}`);
  }
  if (insertAssets.length) {
    const { error } = await service.from("planning_assets").insert(insertAssets);
    if (error) throw new Error(`Could not insert planning assets: ${error.message}`);
  }
  if (upsertWorkItems.length) {
    const { error } = await service.from("catalog_work_items").upsert(upsertWorkItems);
    if (error) throw new Error(`Could not upsert catalog work items: ${error.message}`);
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
    queued,
    batchIdsToSchedule: [...requestIdsByBatch.keys()],
  };
}
