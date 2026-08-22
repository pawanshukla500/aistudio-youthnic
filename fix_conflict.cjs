const fs = require('fs');

let index = fs.readFileSync('supabase/functions/app-api/index.ts', 'utf8');
index = index.replace(
`<<<<<<< HEAD
        const scheduleOutcomes: Array<{ batchId: string; success: boolean; error?: string }> = [];
        for (const batchId of result.batchIdsToSchedule) {
          try {
            await scheduleCatalogOperation(request, { catalogId: batchId });
            scheduleOutcomes.push({ batchId, success: true });
          } catch (err: any) {
            scheduleOutcomes.push({ batchId, success: false, error: err.message });
=======
        if (Array.isArray(result.batchesToSchedule)) {
          for (const batchId of result.batchesToSchedule) {
            await scheduleCatalogOperation(request, { catalogId: batchId });
>>>>>>> origin/main`,
`        const scheduleOutcomes: Array<{ batchId: string; success: boolean; error?: string }> = [];
        if (Array.isArray(result.batchesToSchedule)) {
          for (const batchId of result.batchesToSchedule) {
            try {
              await scheduleCatalogOperation(request, { catalogId: batchId });
              scheduleOutcomes.push({ batchId, success: true });
            } catch (err: any) {
              scheduleOutcomes.push({ batchId, success: false, error: err.message });
            }`);
fs.writeFileSync('supabase/functions/app-api/index.ts', index);

let catalog = fs.readFileSync('supabase/functions/app-api/catalogProduction.ts', 'utf8');

catalog = catalog.replace(
`<<<<<<< HEAD
  const activeItems = (workItems || []).filter((item) => ["queued", "generating", "processing"].includes(text(item.generation_status)));
  if (activeItems.length) {
    throw new Error(\`\${activeItems.length} selected SKU\${activeItems.length === 1 ? " is" : "s are"} already generating. Wait for the active run to finish.\`);
  }
=======
  let queued = 0;
  const batchesToSchedule = new Set<string>();
>>>>>>> origin/main`,
`  let queued = 0;
  const batchesToSchedule = new Set<string>();`);

catalog = catalog.replace(
`<<<<<<< HEAD
    let requestId = text(item.planning_request_id);
    let request = requestId ? requestById.get(requestId) : undefined;
    let batchId = text(request?.batch_id) || adHocBatchId;
=======
    if (["queued", "generating", "completed"].includes(item.generation_status)) continue;
    if (item.status === "blocked") continue;
    
    let requestId = item.planning_request_id;
>>>>>>> origin/main`,
`    if (["queued", "generating", "processing", "completed"].includes(item.generation_status)) continue;
    if (item.status === "blocked") continue;

    let requestId = text(item.planning_request_id);
    let request = requestId ? requestById.get(requestId) : undefined;
    let batchId = text(request?.batch_id) || adHocBatchId;`);

catalog = catalog.replace(
`<<<<<<< HEAD
        completion_status: "pending",
        front_image_url: item.reference_image_url,
        back_image_url: item.reference_image_url,
        validation_status: "ready",
        validation_report: { ready: true, reasons: [] },
        analysis_status: "stale",
        updated_at: now,
      });
      const referenceUrl = text(item.reference_image_url);
      insertAssets.push(
        { organization_id: workspace.organization.id, planning_request_id: requestId, sku_name: item.sku_name, prompt: "", image_url: referenceUrl, storage_path: "", sku_matched: true, asset_role: "front", storage_backend: "firebase", metadata: { source: "catalog_production_import", role: "front" } },
        { organization_id: workspace.organization.id, planning_request_id: requestId, sku_name: item.sku_name, prompt: "", image_url: referenceUrl, storage_path: "", sku_matched: true, asset_role: "back", storage_backend: "firebase", metadata: { source: "catalog_production_import", role: "back" } }
      );
=======
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
>>>>>>> origin/main`,
`        completion_status: "pending",
        front_image_url: item.reference_image_url,
        back_image_url: item.reference_image_url,
        validation_status: "ready",
        validation_report: { ready: true, reasons: [] },
        analysis_status: "stale",
        updated_at: now,
      });
      const referenceUrl = text(item.reference_image_url);
      insertAssets.push(
        { organization_id: workspace.organization.id, planning_request_id: requestId, sku_name: item.sku_name, prompt: "", image_url: referenceUrl, storage_path: "", sku_matched: true, asset_role: "front", storage_backend: "firebase", metadata: { source: "catalog_production_import", role: "front" } },
        { organization_id: workspace.organization.id, planning_request_id: requestId, sku_name: item.sku_name, prompt: "", image_url: referenceUrl, storage_path: "", sku_matched: true, asset_role: "back", storage_backend: "firebase", metadata: { source: "catalog_production_import", role: "back" } }
      );`);

catalog = catalog.replace(
`<<<<<<< HEAD

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
    });

    requestIdsByBatch.set(batchId, [...(requestIdsByBatch.get(batchId) || []), requestId]);
  }

  // Deduplicate upsertRequests by ID since multiple work items might point to the same planning_request_id
  const uniqueRequests = new Map(upsertRequests.map(r => [String(r.id), r]));

  if (uniqueRequests.size) {
    const { error } = await service.from("planning_requests").upsert(Array.from(uniqueRequests.values()));
    if (error) throw new Error(\`Could not upsert planning requests: \${error.message}\`);
  }
  if (insertAssets.length) {
    const { error } = await service.from("planning_assets").insert(insertAssets);
    if (error) throw new Error(\`Could not insert planning assets: \${error.message}\`);
  }
  if (upsertWorkItems.length) {
    const { error } = await service.from("catalog_work_items").upsert(upsertWorkItems);
    if (error) throw new Error(\`Could not upsert catalog work items: \${error.message}\`);
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
=======
    batchesToSchedule.add(String(item.planning_batch_id || batchId));
  }
  
  return { queued, batchesToSchedule: Array.from(batchesToSchedule) };
>>>>>>> origin/main`,
`
    queued++;
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
    });

    requestIdsByBatch.set(batchId, [...(requestIdsByBatch.get(batchId) || []), requestId]);
    batchesToSchedule.add(batchId);
  }

  // Deduplicate upsertRequests by ID since multiple work items might point to the same planning_request_id
  const uniqueRequests = new Map(upsertRequests.map(r => [String(r.id), r]));

  if (uniqueRequests.size) {
    const { error } = await service.from("planning_requests").upsert(Array.from(uniqueRequests.values()));
    if (error) throw new Error(\`Could not upsert planning requests: \${error.message}\`);
  }
  if (insertAssets.length) {
    const { error } = await service.from("planning_assets").insert(insertAssets);
    if (error) throw new Error(\`Could not insert planning assets: \${error.message}\`);
  }
  if (upsertWorkItems.length) {
    const { error } = await service.from("catalog_work_items").upsert(upsertWorkItems);
    if (error) throw new Error(\`Could not upsert catalog work items: \${error.message}\`);
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
    batchesToSchedule: Array.from(batchesToSchedule),
  };`);
fs.writeFileSync('supabase/functions/app-api/catalogProduction.ts', catalog);
console.log("Done");
