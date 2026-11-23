import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.test("app-api entrypoint is repo source, not a GitHub raw import stub", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  const trimmed = source.trim();
  assertEquals(/raw\.githubusercontent\.com/i.test(trimmed), false);
  assertEquals(trimmed.split("\n").length > 50, true);
  assertEquals(trimmed.startsWith("import "), true);
});

Deno.test("CodeAnt Major: worker candidate loading forwards preferred showcase evidence", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  assertEquals(
    source.includes("function poseReferenceCandidates(references: ReferenceInput[], poseType: string, garmentFamily: string, preferredRole = \"\")"),
    true,
  );
  assertEquals(
    source.includes("selectReferences(references, [], poseType, garmentFamily, MAX_REFERENCES, preferredRole)"),
    true,
  );
  assertEquals(
    source.includes("poseReferenceCandidates(sourceInputs, poseData.id, garmentFamily, poseData.primaryReference)"),
    true,
  );
});

Deno.test("Railway idle sleep optimization: useQuery polls only active work and pg_cron pre-checks all worker operations", () => {
  const backendSource = Deno.readTextFileSync(
    new URL("../../../../src/lib/backend.ts", import.meta.url),
  ).replace(/\r\n/g, "\n");
  assertEquals(backendSource.includes("export function shouldPollEndpoint("), true);
  assertEquals(
    backendSource.includes("shouldPollEndpoint(endpoint, valueRef.current)"),
    true,
  );
  assertEquals(
    backendSource.includes("const pollableEndpoint = endpoint.startsWith(\"jobs.\") || endpoint.startsWith(\"catalog.\");"),
    true,
  );

  const cronMigration = Deno.readTextFileSync(
    new URL("../../../migrations/20261114190000_optimize_railway_idle_sleep_cron.sql", import.meta.url),
  ).replace(/\r\n/g, "\n");
  assertEquals(cronMigration.includes("ELSIF operation_name = 'catalogProduction.automation' THEN"), true);
  assertEquals(cronMigration.includes("ELSIF operation_name = 'usage.sync' THEN"), true);
  assertEquals(cronMigration.includes("ELSIF operation_name = 'events.automation' THEN"), true);
});

Deno.test("Shockproof resilience contracts: safety fallbacks, retries, and delayed retry wakeup are wired", () => {
  const indexSource = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  assertEquals(indexSource.includes("function appendSafetyVisionFallbacks("), true);
  assertEquals(indexSource.includes("async function zaiVisionJson("), true);
  assertEquals(indexSource.includes("FAST_PRODUCT_TRUTH_ZAI_ROUTE"), true);
  assertEquals(indexSource.includes("return qwenVisionJson(effectiveRoute, parts, timeoutMs);"), true);
  assertEquals(indexSource.includes("async function fetchAssetBlobWithRetry("), true);
  assertEquals(indexSource.includes("await response.body?.cancel().catch(() => {});"), true);
  assertEquals(indexSource.includes("if (!retryable) break;"), true);
  assertEquals(indexSource.includes("body: buildImageGenerationFormData(args),"), true);
  assertEquals(indexSource.includes("while (Date.now() < targetWakeMs)"), true);

  const studioSource = Deno.readTextFileSync(new URL("../../../../src/features/studio/Studio.tsx", import.meta.url)).replace(/\r\n/g, "\n");
  assertEquals(studioSource.includes("!hasRequiredSareeReferences(productReferences)"), true);
  assertEquals(studioSource.includes("const AUTO_ANALYZE_DELAY_MS = 1000;"), true);
  assertEquals(studioSource.includes("if (!requiredReady || !allReferencesUploaded || analyzing) return;"), true);
  assertEquals(studioSource.includes("onChange={(event) => setSkuId(event.target.value)}"), true);
  assertEquals(studioSource.includes("onChange={(event) => setSkuName(event.target.value)}"), true);
  assertEquals(studioSource.includes("onChange={(event) => updateDirectorNote(setProductDetails, event.target.value)}"), true);

  assertEquals(indexSource.includes("async function buildGenerationFlowTrace("), true);
  assertEquals(indexSource.includes("const scopedPoseRows = scopePoseRowsToJob("), true);
  assertEquals(indexSource.includes("operation: \"generation.pose_failed\""), true);
  assertEquals(indexSource.includes("operation: \"app-api.worker\""), true);
  assertEquals(indexSource.includes("operation: \"app-api.nodeWorker\""), true);
  assertEquals(indexSource.includes("operation: \"catalog.preflight\""), true);

  const flowBoardSource = Deno.readTextFileSync(
    new URL("../../../../src/features/history/generation-flow/boardFromGenerationData.ts", import.meta.url),
  ).replace(/\r\n/g, "\n");
  assertEquals(flowBoardSource.includes("entry.downloadUrl ||"), true);
  assertEquals(flowBoardSource.includes("scopePoseRowsToJob(rawTracePoses, jobId)"), true);
  assertEquals(flowBoardSource.includes("REGENERATE_WINDOW_MS"), true);

  const poseFlowSource = Deno.readTextFileSync(
    new URL("../../../../src/features/history/generation-flow/CatalogPoseFlow.tsx", import.meta.url),
  ).replace(/\r\n/g, "\n");
  assertEquals(poseFlowSource.includes("|| !note.trim() || actions.busyPose !== undefined"), true);
});

Deno.test("reference pose planning: analysis wires the LangGraph planner, style profile cache and stored plan", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const count = (needle: string) => source.split(needle).length - 1;
  // Fresh studio and catalog analyses: wake FastAPI first, then refine the local plan via
  // POST /api/v1/plan (withGraphPosePlanning skips analyses without posePlanning and
  // re-normalizes the vision JSON with posePlanningOverride; see pose_planning_client.test.ts).
  assertEquals(count("void wakeFastApi(fastApi);"), 2);
  assertEquals(count("normalized = await withGraphPosePlanning({"), 2);
  assertEquals(count("rawAnalysis: result.json,"), 2);
  assertEquals(source.includes("threadKey: fingerprint,"), true);
  assertEquals(source.includes("threadKey: analysisFingerprint || smallHash(catalogCacheKey),"), true);
  assertEquals(count("posePlanner: normalized.posePlanning?.planner"), 4);
  // Every analysis path tells the Farshi guard about a dedicated bottom photo.
  assertEquals(count("hasBottomReference: references.some((reference) => reference.role === \"bottom\")"), 4);
  // Style-reference profile cache.
  assertEquals(source.includes(".eq(\"cache_kind\", STYLE_PROFILE_CACHE_KIND)"), true);
  assertEquals(source.includes("isStyleReferenceProfile(data?.payload)"), true);
  assertEquals(count("cachedStyleProfile ? references.filter((reference) => reference.role !== \"style_reference\") : references,"), 2);
  assertEquals(count("cachedStyleProfile: cachedStyleProfile ?? undefined,"), 2);
  // Saved only after every style image was attached; forceRefresh skips the lookup, not the repairing save.
  assertEquals(count("if (styleCacheKey && !cachedStyleProfile && styleReferencesLoaded) await saveStyleReferenceProfile("), 2);
  assertEquals(count("styleCacheKey && !forceRefresh"), 2);
  assertEquals(count("styleProfileCacheKey(references, { sceneDirection:"), 2);
  assertEquals(source.includes("cacheableStyleProfile(normalized)"), true);
  assertEquals(source.includes("styleProfileCacheHit: Boolean(cachedStyleProfile),"), true);
  // The plan is stored server-side and feeds generation memory.
  assertEquals(count("...(normalized.posePlanning ? { posePlanning: normalized.posePlanning } : {}),"), 2);
  assertEquals(count("posePlanning: normalized.posePlanning,"), 2);
  assertEquals(source.includes("posePlanning: sessionData.posePlanning,"), true);
  // Workflow checkpoints accept planner threads, still tenant-scoped.
  assertEquals(source.includes("`thread_plan_${workspace.organization.id}_`"), true);
  assertEquals(source.includes("!tenantPrefixes.some((prefix) => threadId.startsWith(prefix))"), true);
});

Deno.test("reference pose planning: worker DNA gate, QA posture match, finalize learning and human verdicts", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const worker = source.slice(source.indexOf("async function processWorker("), source.indexOf("async function cloneJob("));
  // QA judges Pose 4 / Pose 6 against the adoptions the generation prompt honoured.
  assertEquals(source.includes("const { farshi, slots: adopted } = adoptedReferenceSlots(args.session, qaRefs, args);"), true);
  // QA's Farshi rules and the honoured slots come from the prompt's own helpers, so a stale
  // Farshi seat is never excused; the DNA check reads the honoured Pose 4 / Pose 6 posture.
  assertEquals(source.includes("const farshi = isFarshiGeneration({"), true);
  assertEquals(source.includes("return { farshi, slots: promptReferenceSlots(session, farshi) };"), true);
  assertEquals(source.includes("    farshi,\n    requestedProps,\n  });\n  const baseParts"), true);
  // Props come from the notes only, and the styling line QA reads drops "no <requested prop>" entries.
  assertEquals(source.includes("  const requestedProps = requestedHandheldProps(args.productDetails);\n  const prompt = buildPoseQaPrompt({"), true);
  assertEquals(source.includes("ornaments: ${withoutNegatedRequestedProps(styling.ornaments, requestedProps)}"), true);
  assertEquals(source.includes("      referencePosture: args.referencePosture,\n    });"), true);
  assertEquals(worker.includes("? adoptedReferenceSlots(sessionData, selected, skuText).slots[poseData.id]?.posture"), true);
  assertEquals(source.includes("referencePoseMatch: (args.pose.id === \"creative\" || args.pose.id === \"showcase\" ? adopted[args.pose.id] : null) ?? undefined,"), true);
  assertEquals(source.includes("hasApprovedAnchor: args.approved.length > 0, referencePoseNumbers });"), true);
  // Always-on DNA gate: derived from full QA scores, else one recorded DNA check; never throws.
  assertEquals(source.includes("return { dna: dnaConsistencyFromQaScores(args.qa.scores), costUsd: 0 };"), true);
  assertEquals(source.includes("const check = await validateProductDna({"), true);
  assertEquals(source.includes("check: \"dna_consistency\""), true);
  assertEquals(worker.includes("const dnaGate = await productDnaGate({"), true);
  assertEquals(worker.includes("qaAttemptCost += dnaGate.costUsd;"), true);
  assertEquals(worker.includes("const dnaCorrection = dnaCorrectionText(dna);"), true);
  assertEquals(worker.includes("if (!qa.pass || dnaRejects) {"), true);
  assertEquals(worker.includes("const qaStatus = dnaSalvaged ? \"requires_human_review\" : disposition.qaStatus;"), true);
  // The verdict is persisted on the pose, the immutable asset row and the session validation.
  assertEquals(worker.includes("qa_payload: { ...qa, dna, qaUnavailable, qaVersion: QA_VERSION"), true);
  assertEquals(worker.includes("poseType: pose.pose_type, qa, dna, qaStatus,"), true);
  assertEquals(worker.includes("checkedAt: Date.now(), dna,"), true);
  // finalizeJob: ledger columns and pose-plan learning, once per delivered version.
  assertEquals(source.includes("pose_planning: jsonRecord(sessionData.posePlanning),"), true);
  assertEquals(source.includes("pose_scores: buildPoseScores(poses, smallHash),"), true);
  assertEquals(source.includes("if (observed[slot] === version) continue;"), true);
  // finalizeJob (DNA) and studio approvePose (human) feed the outcome rows; catalog
  // reviewCatalogPose calls the same recordPosePlanOutcome in catalogProduction.ts.
  assertEquals(source.split("await recordPosePlanOutcome(service, {").length - 1, 2);
  // Human verdicts count status transitions only; finalize credits the honoured adoption via the job.
  assertEquals(source.includes("const humanObservation = humanVerdictTransition(ownedPose.approval_status, status);"), true);
  assertEquals(source.includes(".select(\"session_id,approval_status\").eq(\"generation_id\", generationId)"), true);
  assertEquals(source.includes("        sessionData,\n        job,\n      });"), true);
  // A QA rerun keeps the worker's DNA verdict when QA is unavailable, re-derives it from fresh QA
  // scores otherwise, and a failing DNA verdict keeps the frame out of automatic verification.
  assertEquals(source.includes("const keptDna = priorDna ? { dna: priorDna } : {};"), true);
  assertEquals(source.split("...keptDna, qaVersion: QA_VERSION, rerunAt: reviewedAt").length - 1, 1);
  assertEquals(source.includes("const rerunDna = derivedDna.unavailable ? priorDna : derivedDna;"), true);
  assertEquals(source.includes('const rerunOutcome = dnaFailed && qa.outcome === "automatically_verified" ? "requires_human_review" : qa.outcome;'), true);
  assertEquals(source.includes("qa_status: rerunOutcome, qa_payload: { ...qa, ...rerunDnaPayload,"), true);
  // Catalog analysis bounds the style-profile lookup like the studio path.
  assertEquals(source.split("await withDeadline(cachedStyleReferenceProfile(orgId, styleCacheKey), ANALYSIS_PREP_QUERY_MS, null)").length - 1, 2);
});

Deno.test("reference pose planning: analysis guards see the SKU, a DNA-held Pose 1 never anchors, DNA early stop and rerun audit", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const count = (needle: string) => source.split(needle).length - 1;
  const worker = source.slice(source.indexOf("async function processWorker("), source.indexOf("async function cloneJob("));
  // Studio, batch, catalog and stored-analysis normalization pass the SKU name and notes to the
  // pose-planning guards; withGraphPosePlanning re-normalizes with the same option objects.
  assertEquals(source.includes("    skuName: String(args.skuName || \"\"),\n    productDetails: String(args.productDetails || \"\"),\n    modelDirection:"), true);
  assertEquals(source.includes("    skuName: String(variant?.sku_name || \"\"),\n    productDetails: String(variant?.product_description || \"\"),\n    modelDirection:"), true);
  assertEquals(source.includes("    skuName: String(variant.sku_name || \"\"),\n    productDetails: String(variant.product_description || \"\"),\n    modelDirection:"), true);
  assertEquals(source.includes("      skuName: String(variant.sku_name || \"\"),\n      productDetails: String(variant.product_description || \"\"),\n      hasBottomReference:"), true);
  assertEquals(count("options: analysisOptions,"), 2);
  // A Pose 1 the DNA gate kept for review is neither the anchor (session, batch memory) nor approved memory.
  assertEquals(source.includes("&& !dnaHoldsForReview(pose.qa_status, jsonRecord(pose.qa_payload).dna));"), true);
  assertEquals(source.includes("anchorDna: jsonRecord(anchor.qa_payload).dna ?? null,"), true);
  assertEquals(source.includes(".select(\"output_url,storage_path,storage_backend,title,qa_status,qa_payload\")"), true);
  assertEquals(source.includes("qa_payload: { dna: memory.anchorDna } };"), true);
  assertEquals(source.includes("|| dnaHoldsForReview(anchorPose.qa_status, jsonRecord(anchorPose.qa_payload).dna))) return null;"), true);
  assertEquals(worker.includes("const dnaHeldPoses = new Set((allPoses || []).filter((entry) => dnaHoldsForReview(entry.qa_status, jsonRecord(entry.qa_payload).dna))"), true);
  assertEquals(worker.includes("approvedAssets: generatedAssets.filter((asset) => asset.poseIndex === 1 && !dnaHeldPoses.has(asset.poseIndex) && canUsePoseOneAnchor("), true);
  assertEquals(worker.includes("approvedAssets: generatedAssets.filter((asset) => !dnaHeldPoses.has(asset.poseIndex) && ("), true);
  assertEquals(source.includes("canUsePoseOneAnchor(garmentFamily, outcome, Boolean(job.pose_qa)) && !dnaHoldsForReview(outcome, dna);"), true);
  assertEquals(source.includes("sessionData, \"unverified\", priorDna);"), true);
  assertEquals(source.includes("sessionData, rerunOutcome, rerunDna);"), true);
  // The DNA early stop compares failed attribute sets stored on the retry record, not correction text.
  assertEquals(worker.includes(".includes(dnaCorrection)"), false);
  assertEquals(worker.includes("const repeatsLastDefect = repeatsLastDnaFailure(storedPoseData.lastDnaFailed, dna, { generationEpoch, attempt });"), true);
  assertEquals(worker.includes("if (dnaRejects) lastDnaFailed = { generationEpoch, attempt, failed: dna.failed };"), true);
  assertEquals(worker.includes("rejectedAttempts, lastDnaFailed, attemptCost,"), true);
  assertEquals(source.includes("lastDnaFailed: args.lastDnaFailed ?? null, retryAvailableAt: availableAt"), true);
  // The immutable rerun row records the DNA verdict it used and the final outcome.
  assertEquals(source.includes("metadata: { qa, dna: rerunDna ?? null, rerunOutcome, rerunByMemberId: workspace.member.id },"), true);
});

Deno.test("CodeAnt Major: a rejected attempt's archive upload is retried once before the copy is given up", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const start = source.indexOf("async function archiveRejectedAttempt(");
  const body = source.slice(start, source.indexOf("async function deferPoseRetry(", start));
  assertEquals(body.includes("for (let upload = 1; upload <= 2; upload++) {"), true);
  assertEquals(body.indexOf("return null;") > body.indexOf("for (let upload = 1; upload <= 2; upload++) {"), true);
});

Deno.test("CodeAnt Major: a studio pose review compare-and-sets the status it read", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  assertEquals(source.includes(': approvalUpdate.eq("approval_status", ownedPose.approval_status))'), true);
  assertEquals(source.includes('if (!pose) throw new Error("This pose was reviewed by someone else just now. Reload to see the latest decision.");'), true);
});

Deno.test("batch regeneration queues every selected pose in one request, and History sends them together", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const start = source.indexOf("async function regeneratePose(");
  const body = source.slice(start, source.indexOf("async function syncCatalogAnchorQa(", start));
  assertEquals(body.includes("Array.isArray(args.poseIds)"), true);
  assertEquals(body.includes('if (poses.some((entry) => entry.session_id !== pose.session_id)) throw new Error("Regenerate poses from one photoshoot at a time.");'), true);
  assertEquals(body.includes("...poses.map(queuePose),"), true);
  assertEquals(body.includes('completed_poses: Math.max(0, Number(job.completed_poses || 0) - countStatus("completed")),'), true);
  // Every pose must belong to the job whose owner is checked and whose counters change.
  assertEquals(body.includes("if (scopePoseRowsToJob(poses as PoseRowLike[], String(job.job_id)).length !== poses.length) {"), true);
  assertEquals(body.includes('previousStatus: String(entry.status || ""),'), true);
  // The worker runs queued poses lowest pose first, so a regenerated Pose 1 anchors the rest.
  assertEquals(source.includes('.eq("session_id", job.session_id).eq("status", "queued").order("pose_index").limit(1).maybeSingle();'), true);
  const history = Deno.readTextFileSync(new URL("../../../../src/features/history/History.tsx", import.meta.url)).replace(/\r\n/g, "\n");
  assertEquals(history.includes("poseIds: eligible.map((pose: any) => pose._id),"), true);
  assertEquals(history.includes("batchWaitRef"), false);
  // A request that errors after some poses were queued shows those poses as queued, not failed.
  assertEquals(history.includes("const batchEntryState = (entry: BatchEntry) =>"), true);
});

Deno.test("a failed Pose 1 puts skipped regenerations back to their kept version instead of failing them", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const start = source.indexOf("async function failPoseAndJob(");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assertEquals(body.includes('const restore = Boolean(entry.output_url || entry.storage_path) && ["completed", "requires_human_review"].includes(String(last.previousStatus || ""));'), true);
  assertEquals(body.includes("{ ...last, skipped: true, skippedReason: skipped }"), true);
  assertEquals(body.includes('.eq("generation_id", entry.generation_id).eq("status", "queued");'), true);
  const versions = Deno.readTextFileSync(new URL("../../../../src/lib/poseVersions.ts", import.meta.url)).replace(/\r\n/g, "\n");
  assertEquals(versions.includes(".filter((entry) => entry.skipped !== true)"), true);
});

Deno.test("a finished job names cancelled poses as cancelled, not as exhausted retries", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const start = source.indexOf("async function finalizeJob(");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assertEquals(body.includes('String(pose.error || "") === "Generation cancelled by the user."'), true);
  assertEquals(body.includes("pose(s) were cancelled before they finished"), true);
  assertEquals(source.includes('async function finalizeCancelledJob(job: JsonRecord, message = "Generation cancelled by the user.")'), true);
});

Deno.test("a duplicate analysis joins the one in flight, registered before the slow prep queries", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const start = source.indexOf("async function analyze(request: Request, args: JsonRecord)");
  const body = source.slice(start, source.indexOf("\nfunction normalizeImageSize(", start));
  const flightAt = body.indexOf("const flightKey = `${orgId}:${pHash}:${rHash}:${ANALYSIS_VERSION}`;");
  const registerAt = body.indexOf("const flight = studioAnalysisFlights.acquire(flightKey, orgId, {");
  const prepAt = body.indexOf('resolveVisionPolicy(orgId, { purpose: "product_truth"');
  assert(flightAt > 0 && registerAt > flightAt, "the flight key is fixed by the inputs");
  // Prep briefs (house preferences, learning) can time out differently, so they stay out of the key.
  assert(prepAt > registerAt, "the flight is registered before the up-to-8s prep queries");
  // The flight outlives the request: the request answers before the 300s proxy cut and the chain
  // runs on the flight's own budget, so a slow Meta still leaves its fallback a full window.
  assert(body.includes("return await studioAnalysisFlights.wait(flight, request.signal, requestStarted + ANALYZE_PROXY_BUDGET_MS);"));
  assert(body.includes("const gatewayBudgetMs = studioAnalysisBudgetMs(prepMs);"));
  assert(body.includes("detachedFlight: true,"));
  assert(body.includes("discardHeld: args.forceRefresh === true && args.resumeAnalysis !== true,"));
  // The Studio names its tab, so its earlier analysis of other inputs is stopped (studio_analysis_flights.test.ts).
  assert(body.includes('clientId: String(args.analysisClientId || "").slice(0, 64),'));
  const studio = Deno.readTextFileSync(new URL("../../../../src/features/studio/Studio.tsx", import.meta.url));
  // One id per page load, held outside the component: an id per mount made a return to the Studio look like
  // another tab, so the analysis started before leaving kept its owner and ran on.
  const component = studio.indexOf("export function Studio() {");
  const idAt = studio.indexOf('let studioAnalysisClientId = "";');
  assert(idAt > 0 && idAt < component, "the id outlives a Studio mount");
  assert(!/useState\([^)]*randomUUID/.test(studio), "never a per-mount id");
  assert(studio.includes("analysisClientId: (studioAnalysisClientId ||= crypto.randomUUID()),"), "sent with every analysis");
});

Deno.test("a catalog with a queued or running job cannot be deleted, and seeded sales are prepared before they start", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const start = source.indexOf("async function deleteCatalogOperation(");
  const body = source.slice(start, source.indexOf("\nasync function stopCatalogGenerationOperation(", start));
  // generation_jobs is keyed by job_id: select("id") failed, the error was only logged, and the guard never fired.
  assert(body.includes('service.from("generation_jobs").select("job_id").eq("batch_id", batchId).in("status", ["queued", "processing"]).limit(1)'));
  assert(body.includes("if (activeJobsError) throw new Error("), "a check that fails must not let the delete through");
  assert(body.indexOf("This catalog currently has active generation jobs.") < body.indexOf('service.from("generation_jobs").delete()'));
  const types = Deno.readTextFileSync(new URL("../../../../src/database.types.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const jobsAt = types.indexOf("      generation_jobs: {");
  const jobsRow = types.slice(jobsAt, types.indexOf("Insert: {", jobsAt));
  assert(jobsRow.includes("          job_id: string;") && !/\n          id: /.test(jobsRow), "generation_jobs has job_id and no id column");
  // Marketplace sales were given a prep deadline 40-45 days after the sale began.
  assert(source.includes('preparation_deadline: shiftIsoDate(window.startDate, priority === "urgent" ? -45 : -40),'));
  assert(!/preparation_deadline: shiftIsoDate\([^\n]*\? 45 : 40\)/.test(source));
});

Deno.test("a handoff that was not sent, or a bulk generation that did not start, is an error and not a success message", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const start = source.indexOf("async function sendCatalogHandoffDigestOperation(");
  const handoff = source.slice(start, source.indexOf("\nfunction matchesFilterList(", start));
  const refusedAt = handoff.indexOf("if (!result.sent) {");
  assert(refusedAt > 0 && handoff.includes("No email was sent: today's handoff has already gone out or is still sending."));
  assert(refusedAt < handoff.indexOf('"catalog.handoff_digest.sent"'), "a skipped send is not audit-logged as sent");
  const bulkStart = source.indexOf('"catalogProduction.bulkGenerate": async () => {');
  const bulk = source.slice(bulkStart, source.indexOf('"catalogProduction.automation"', bulkStart));
  assert(bulk.includes("const notStarted = scheduleOutcomes.filter((outcome) => !outcome.success);"));
  assert(bulk.indexOf("throw new Error(`The items were queued, but generation did not start for") < bulk.indexOf("return { ...result, scheduleOutcomes };"));
  // The screens that call them: a paused catalog can be approved, and a failed comment keeps its text.
  const planning = Deno.readTextFileSync(new URL("../../../../src/features/planning/Planning.tsx", import.meta.url));
  assert(planning.includes('disabled={!canEditReferences && selected.status !== "awaiting_styling_approval"}'), "Approve works while generation waits for it");
  const workflow = Deno.readTextFileSync(new URL("../../../../src/features/history/generation-flow/OperationalWorkflowView.tsx", import.meta.url));
  assert(workflow.includes('"Comment added.")) setComment("");'));
  assert(!workflow.includes("String(data.item.deadline_at).slice(0, 16)"), "the deadline is shown in local time (flow_board.test.ts)");
  // A list past the 100-item limit is started 100 at a time and the rest is named (flow_board.test.ts covers the server).
  const production = Deno.readTextFileSync(new URL("../../../../src/features/planning/catalog-production/CatalogProduction.tsx", import.meta.url));
  assert(production.includes("workItemIds: result.queueableWorkItemIds.slice(0, BULK_GENERATE_LIMIT)") && production.includes("more are ready: start them with Auto-Start."));
  assert(production.includes("workItemIds: startIds,") && production.includes('setSelectedTableIds(new Set(pending.mode === "selected" ? waitingIds : []));'));
  assert(!production.includes("workItemIds: pending.ids,"), "never the whole list in one request");
});

Deno.test("Clone Session opens in the Studio with its references and analysis instead of an empty Studio", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  assert(source.includes('"studio.loadSession": () => loadStudioSession(request, args),'));
  const start = source.indexOf("async function loadStudioSession(");
  const body = source.slice(start, source.indexOf("\nasync function cloneJob(", start));
  assert(body.includes('.eq("session_id", sessionId).eq("organization_id", workspace.organization.id).maybeSingle();'));
  assert(body.includes("analysisCurrent: analysisVersion === ANALYSIS_VERSION,"));
  assert(body.includes("analysisFingerprint: String(session.analysis_fingerprint || \"\"),"));
  // A clone's skuId is its planning request id, never shown as a SKU code.
  assert(body.includes('.select("session_id,planning_request_id,analysis_fingerprint,product_hash,reference_hash,session_data")'));
  // A clone shows the SKU code its source had (kept as sourceSkuId), never its planning request id.
  assert(body.includes("skuId: sessionSkuCode(data, session.planning_request_id),"));
  const cloneStart = source.indexOf("async function cloneJob(");
  const clone = source.slice(cloneStart, source.indexOf("\n}\n", cloneStart));
  assert(clone.includes("const sourceSkuId = sessionSkuCode(sourceData, sourceSession.planning_request_id);"));
  assert(clone.includes("...(sourceSkuId ? { sourceSkuId } : {}),"));
  assert(source.includes("skuId: String(args.skuId || sessionSkuCode(sessionData, session.planning_request_id) || session.planning_request_id),"));
  const helperStart = source.indexOf("function sessionSkuCode(");
  const helper = source.slice(helperStart, source.indexOf("\n}\n", helperStart) + 2)
    .replace("data: JsonRecord, planningRequestId: unknown): string", "data, planningRequestId)");
  const sessionSkuCode = new Function(`${helper}; return sessionSkuCode;`)() as (data: Record<string, unknown>, planningRequestId: unknown) => string;
  assertEquals(sessionSkuCode({ skuId: "BT218-Cat-Rama" }, "pr-1"), "BT218-Cat-Rama");
  assertEquals(sessionSkuCode({ skuId: "pr-2", sourceSkuId: "BT218-Cat-Rama" }, "pr-2"), "BT218-Cat-Rama");
  // A code typed in the Studio after cloning is saved as skuId and wins over the source code.
  assertEquals(sessionSkuCode({ skuId: "BT218-v2", sourceSkuId: "BT218-Cat-Rama" }, "pr-2"), "BT218-v2");
  assertEquals(sessionSkuCode({ skuId: "pr-3" }, "pr-3"), "");
  const studio = Deno.readTextFileSync(new URL("../../../../src/features/studio/Studio.tsx", import.meta.url)).replace(/\r\n/g, "\n");
  assert(studio.includes('const sessionParam = searchParams.get("session") || "";'));
  assert(studio.includes('invokeAppApi<LoadedStudioSession>("studio.loadSession", { sessionId: sessionParam })'));
  // Loaded references are never uploaded again, keep their stored hashes, and the loaded analysis is current.
  assert(studio.includes("uploadedId: id as Id<\"productReferences\">,"));
  assert(studio.includes("setReferenceHashes((current) => ({ ...current, ...Object.fromEntries(references.map((reference) => [reference.id, reference.hash || reference.id])) }));"));
  assert(studio.includes("setAnalysisSourceKey(analysisInputKey);"));
  const history = Deno.readTextFileSync(new URL("../../../../src/features/history/History.tsx", import.meta.url)).replace(/\r\n/g, "\n");
  assert(history.includes("navigate(`/studio?session=${result.sessionId}`);"));
});

Deno.test("History shows the passed product DNA check on QA-off frames, and flow re-generation says why it waits for a note", async () => {
  const history = Deno.readTextFileSync(new URL("../../../../src/features/history/History.tsx", import.meta.url)).replace(/\r\n/g, "\n");
  assert(history.includes("return `Product DNA check passed${typeof dna.score === \"number\" ? ` · ${Math.round(dna.score)}%` : \"\"}`;"));
  assert(history.includes('return "Not QA-checked · QA off";'));
  const flow = Deno.readTextFileSync(new URL("../../../../src/features/history/generation-flow/CatalogPoseFlow.tsx", import.meta.url)).replace(/\r\n/g, "\n");
  // The note stays required (no confirmation dialog guards this paid click); the button says so.
  assert(flow.includes('!note.trim() ? "Type what to change first: each version is a paid generation"'));
  assert(flow.includes('placeholder="What to change in the next version (required to re-generate)"'));
  const { versionStatusLabel } = await import("../../../../src/features/history/generation-flow/flowLinks.ts");
  assertEquals(versionStatusLabel("pending"), "awaiting review");
  assertEquals(versionStatusLabel("approved"), "approved");
  assertEquals(versionStatusLabel("requires_human_review"), "requires human review");
});

Deno.test("the flow board avoids React Flow's built-in node styles, keeps a fit out of saved layouts, and shows the photos the generator received", () => {
  const read = (path: string) => Deno.readTextFileSync(new URL(`../../../../src/features/history/generation-flow/${path}`, import.meta.url)).replace(/\r\n/g, "\n");
  const flow = read("CatalogPoseFlow.tsx");
  // React Flow styles input/output/default/group wrappers by class, which outlined every card.
  assert(flow.includes("type: `cpf-${kind}`"));
  assert(flow.includes('"cpf-input": InputNode, "cpf-analysis": AnalysisNode, "cpf-prompt": PromptNode, "cpf-output": OutputNode'));
  // Only a pan or zoom by the person is remembered; a fit at another window size is not.
  assert(flow.includes("if (!event) return;"));
  // A cleared note stays cleared (kept as "" in the v2 layout) instead of reloading the legacy note.
  assert(flow.includes("return String(key in notes ? notes[key] : legacyNote(storageKey, poseIndex)).slice(0, 1000);"));
  assert(flow.includes("notes[String(poseIndex)] = next.slice(0, 1000);"));
  // A newer notice keeps its full four seconds.
  assert(flow.includes("window.clearTimeout(noticeTimer.current);"));
  // A slow clipboard write that later succeeds is not reported as failed by the 400 ms fallback.
  assert(flow.includes("if (command()) finish(true);"));
  // A late result of an earlier copy cannot overwrite a newer copy's notice.
  assert(flow.includes("if (copyId === copySeq.current) flash(copied ? done : failed);"));
  // The trace parser keeps the QA payload, so a trace board shows the DNA score instead of "Not checked".
  assert(read("graph/buildGenerationGraph.ts").includes("qa_payload: p.qa_payload ?? null,"));
  // The admin flow view relies on the board header instead of stacking its own.
  const admin = read("GenerationFlow.tsx");
  assert(admin.includes("onBack={() => setSelectedGraphData(null)}"));
  assert(!admin.includes("summaryCost"));
  // Lazy images never loaded on a live board in an unpainted window; the cards load eagerly.
  assert(!flow.includes('loading="lazy"'));
  const workflow = read("OperationalWorkflowView.tsx");
  assert(workflow.includes("const inputs = sessionReferences.length ? sessionReferences : references;"));
  assert(workflow.includes("return { references: inputs, poses };"));
  // A re-generating pose shows as working even though its retained prior version is "completed".
  assert(workflow.includes("status: pose.busy || poseStatus("));
  const page = read("GenerationFlowPage.tsx");
  assert(page.includes("void fetchFlow();"));
  assert(!page.includes("window.location.reload()"));
  // The Studio's live progress card opens the board for the shoot it just queued.
  const studio = Deno.readTextFileSync(new URL("../../../../src/features/studio/Studio.tsx", import.meta.url));
  assert(studio.includes("to={`/history/flow/${submittedJobId}`}"));
});

Deno.test("History modals close on Escape, lock the page behind them, and read correctly on phones", () => {
  const history = Deno.readTextFileSync(new URL("../../../../src/features/history/History.tsx", import.meta.url)).replace(/\r\n/g, "\n");
  // Escape and scroll lock for every History modal (the pose preview keeps its own keys).
  assert(history.includes("useModalChrome(Boolean(regenerateTarget), () => setRegenerateTarget(null), !regeneratingId, regenerateDialog);"));
  assert(history.includes("useModalChrome(Boolean(selectedReference), () => setSelectedReference(null), true, referenceDialog);"));
  assert(history.includes("useModalChrome(showModelRoutingModal, () => setShowModelRoutingModal(false), true, routingDialog);"));
  // One shared scroll lock: stacked modals closing in the same render cannot leave the page locked.
  assert(history.includes("if (scrollLocks > 0 && --scrollLocks === 0) document.body.style.overflow = unlockedOverflow;"));
  // Only the top modal handles Escape and Tab; focus moves in, stays in, and returns to the trigger.
  assert(history.includes("if (openModals[openModals.length - 1] !== id) return;"));
  assert(history.includes("if (open && !wasOpen.current) returnFocusRef.current = document.activeElement as HTMLElement | null;"));
  // The inspector scrolls on phones instead of being clipped.
  assert(history.includes("overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden"));
  // QA that did not run reads "Off", not a red 0%; the QA model is configured, so it is not called Gemini.
  assert(history.includes("Automatic QA score"));
  assert(!history.includes("Gemini Vision QA Score"));
  assert(!history.includes("Run Gemini consistency QA"));
  // Retries are counted in words.
  assert(history.includes('{plural(regenerationSummary.regenerations, "retry", "retries")} on {plural(regenerationSummary.regeneratedPoses, "pose", "poses")}'));
  // The job header is two quiet lines and three actions: no chip wall, no "Pipeline Modes" or "Approved (0)" button;
  // exact costs sit in the tooltip and Pipeline details, and approved downloads appear only once a pose is approved.
  assert(!history.includes("Cost so far") && !history.includes(">\n            Pipeline Modes"));
  assert(history.includes("Pipeline details"));
  assert(history.includes("{approvedPoseCount > 0 && ("));
  assert(history.includes("Retries:{\" \"}"));
  // Retry cost is part of the image cost: shown as included, never as an extra line item (CodeAnt on #199).
  assert(history.includes("(incl. retries $") && history.includes(", included in the cost)"));
  assert(!history.includes("` · Retries $$"));
  assert(history.includes("grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"));
  // Rows and pose tiles open from the keyboard; pose actions show on touch screens.
  assert(history.includes("aria-expanded={open}"));
  assert(history.includes("lg:opacity-0 lg:group-hover/tile:opacity-100"));
  // Hover effects are scoped to the tile: hovering anywhere in a row no longer animates all six poses.
  assert(history.includes("group/tile flex flex-col"));
  // On phones the preview image keeps half the screen instead of collapsing above the inspector.
  assert(history.includes("min-h-[50vh] place-items-center overflow-auto bg-neutral-950 p-3 sm:p-6 lg:min-h-0"));
  // No browser alert for a failed clone.
  assert(!history.includes("alert("));
  // The Compare toggle announces its state.
  assert(history.includes("aria-pressed={compareWithPrevious}"));
});

Deno.test("an unchanged poll re-renders nothing, a refresh after a save always delivers, and the open History card is memoized", () => {
  const backend = Deno.readTextFileSync(new URL("../../../../src/lib/backend.ts", import.meta.url)).replace(/\r\n/g, "\n");
  const history = Deno.readTextFileSync(new URL("../../../../src/features/history/History.tsx", import.meta.url)).replace(/\r\n/g, "\n");
  // Measured on History with one shoot open: an unchanged refresh re-rendered 907 of 907 nodes before, 0 after.
  assert(backend.includes("if (deliver || serialized === undefined || serialized !== serializedValueRef.current) {"));
  // A save that lands while a request is in flight queues one more request: the in-flight response
  // predates the save, so it is never taken as the save's refresh (CodeAnt on #200).
  assert(backend.includes("const deliver = deliverNext && !refreshQueued;"));
  assert(backend.includes("if (always) refreshQueued = true;"));
  assert(/inFlight = false;\n\s+if \(refreshQueued && active\) \{\n\s+refreshQueued = false;\n\s+load\(true\);/.test(backend));
  // The comparison text is reset with the data, so new arguments never compare against the old payload.
  assertEquals(backend.split("serializedValueRef.current = undefined;").length - 1, 2);
  // Only polls and tab-refocus skip unchanged data: Admin re-syncs its draft forms from a refresh after a save.
  assert(backend.includes("const refreshAfterSave = () => load(true);"));
  assert(backend.includes('window.addEventListener("supabase-backend-refresh", refreshAfterSave);'));
  assert(backend.includes("const onVisible = () => { if (!document.hidden) load(); };"));
  // The open shoot card depends on its job id only: History's own state (search, dialogs, list refreshes) skips it.
  assert(history.includes('const JobDetails = memo(function JobDetails({ jobId }: { jobId: Id<"generationJobs"> }) {'));
});

Deno.test("the Studio progress tiles name each pose's state, retry only a failed pose on a click, and preview finished images", () => {
  const studio = Deno.readTextFileSync(new URL("../../../../src/features/studio/Studio.tsx", import.meta.url)).replace(/\r\n/g, "\n");
  assert(studio.includes('if (status === "failed") return { label: "Failed"'));
  assert(studio.includes('if (hasImage) return { label: "Done"'));
  // No extra generation calls: retry is a click on a failed pose once the shoot is idle.
  assert(studio.includes('const canRetry = pose.status === "failed" && jobIdle;'));
  assert(studio.includes("await regeneratePose({ poseId: pose._id, requestedBy: user._id, poseQa: false, extraInstructions: \"\" });"));
  assert(studio.includes("aria-label={`Preview pose ${pose.poseNumber}, ${pose.title}`}"));
});
