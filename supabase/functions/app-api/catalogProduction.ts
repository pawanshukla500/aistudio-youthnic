import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import { type JsonRecord, errorMessage } from "./profiles.ts";

export async function importGoogleSheetDryRun(
  request: Request,
  service: SupabaseClient,
  orgId: string,
  args: JsonRecord
) {
  // Expected args: { rows: any[] }
  const rows = args.rows as any[];
  if (!Array.isArray(rows)) throw new Error("Invalid rows format.");

  let newRows = 0;
  let matchedRows = 0;
  let duplicates = 0;
  const invalidSkus = [];
  const conflicts = [];
  const unknownStatuses = [];

  // Very basic dry run validation against existing CWIES metadata
  for (const row of rows) {
    if (!row['SKU Name'] || !row['Request ID']) {
      invalidSkus.push(row);
      continue;
    }
    
    // Check if external request ID exists
    const reqId = String(row['Request ID']);
    const { data: existing } = await service
      .from("catalog_work_item_external_sources")
      .select("id")
      .eq("external_request_id", reqId)
      .maybeSingle();
      
    if (existing) {
      matchedRows++;
    } else {
      newRows++;
    }
    
    // Check for unknown priorities
    const priority = String(row['Priority'] || '').toLowerCase();
    if (priority && !['low', 'normal', 'high', 'urgent'].includes(priority)) {
      if (!unknownStatuses.includes(`Priority: ${priority}`)) unknownStatuses.push(`Priority: ${priority}`);
    }
  }

  return {
    scanned: rows.length,
    newRows,
    matchedRows,
    duplicates,
    invalidSkus: invalidSkus.length,
    unknownStatuses,
    conflicts
  };
}

export async function importGoogleSheet(
  request: Request,
  service: SupabaseClient,
  orgId: string,
  args: JsonRecord
) {
  const rows = args.rows as any[];
  if (!Array.isArray(rows)) throw new Error("Invalid rows format.");
  
  let inserted = 0;
  let skipped = 0;
  
  for (const row of rows) {
    const sku = row['SKU Name'];
    const reqId = String(row['Request ID']);
    if (!sku || !reqId) continue;
    
    const { data: existing } = await service
      .from("catalog_work_item_external_sources")
      .select("id")
      .eq("external_request_id", reqId)
      .maybeSingle();
      
    if (existing) {
      skipped++;
      continue;
    }
    
    // Normalize fields
    let priority = String(row['Priority'] || 'normal').toLowerCase();
    if (!['low', 'normal', 'high', 'urgent'].includes(priority)) priority = 'normal';
    
    let genStatus = String(row['Generation Status'] || '').toLowerCase();
    if (genStatus === 'pending') genStatus = 'ready';
    else if (genStatus === 'completed' || genStatus === 'done') genStatus = 'completed';
    else if (genStatus === 'failed') genStatus = 'failed';
    else genStatus = 'not_required';
    
    let listingStatus = String(row['Listing Status'] || '').toLowerCase();
    if (listingStatus === 'pending') listingStatus = 'pending';
    else if (listingStatus === 'completed' || listingStatus === 'done') listingStatus = 'completed';
    else listingStatus = 'not_required';
    
    // Create Catalog Work Item
    const { data: cwi, error: cwiError } = await service.from("catalog_work_items").insert({
      organization_id: orgId,
      sku_name: sku,
      priority,
      theme: row['Theme'] || null,
      generation_status: genStatus,
      listing_status: listingStatus,
      remarks: row['Remarks'] || null,
      ai_generation_remarks: row['AI Gen Remarks'] || null,
      listing_team_remarks: row['Listing Team Remarks'] || null,
      listing_action: row['Listing Action'] || null,
      in_house_brand: row['In House Brand'] || null,
      marketplace_brand: row['Myntra Brand'] || null,
      legacy_external_link: row['Links'] || null,
      reference_image_url: row['Reference Image'] || null
    }).select("id").single();
    
    if (cwiError) {
      console.error(cwiError);
      continue;
    }
    
    // Link to external tracking
    await service.from("catalog_work_item_external_sources").insert({
      work_item_id: cwi.id,
      external_request_id: reqId,
      external_tab_name: 'Fashion Catalog Studio_CSV'
    });
    
    // Add event log
    await service.from("catalog_work_item_events").insert({
      organization_id: orgId,
      work_item_id: cwi.id,
      event_type: 'imported',
      source: 'google_sheet'
    });
    
    inserted++;
  }
  
  return { inserted, skipped };
}

export async function reconcileExistingGenerations(
  request: Request,
  service: SupabaseClient,
  orgId: string,
  args: JsonRecord
) {
  const { data: cwItems, error } = await service
    .from("catalog_work_items")
    .select("id, sku_name, request_date, planning_request_id")
    .eq("organization_id", orgId)
    .is("generation_job_id", null);

  if (error || !cwItems) return { error: error?.message || "No items found" };

  let exactMatches = 0;
  let ambiguous = 0;

  for (const item of cwItems) {
    // Attempt exact match first via planning_request
    if (item.planning_request_id) {
      const { data: job } = await service
        .from("generation_jobs")
        .select("job_id, session_id, status, completed_at, qa_payload, qa_status")
        .eq("planning_request_id", item.planning_request_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (job) {
        await service.from("catalog_work_items").update({
          generation_job_id: job.job_id,
          catalog_session_id: job.session_id,
          generation_status: job.status,
          generation_completed_at: job.completed_at,
          qc_status: job.qa_status || (job.status === 'completed' ? 'needs_review' : 'not_started')
        }).eq("id", item.id);
        exactMatches++;
        continue;
      }
    }

    // Try matching by SKU Name (more ambiguous)
    const { data: skuJobs } = await service
      .from("generation_jobs")
      .select("job_id, session_id, status")
      .eq("org_id", orgId)
      .eq("sku_name", item.sku_name)
      .order("created_at", { ascending: false });

    if (skuJobs && skuJobs.length === 1) {
      // It's the only job for this SKU
      await service.from("catalog_work_items").update({
        generation_job_id: skuJobs[0].job_id,
        catalog_session_id: skuJobs[0].session_id,
        generation_status: skuJobs[0].status
      }).eq("id", item.id);
      exactMatches++;
    } else if (skuJobs && skuJobs.length > 1) {
      ambiguous++;
    }
  }

  return { exactMatches, ambiguous };
}
