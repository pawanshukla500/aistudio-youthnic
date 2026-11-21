import { assertEquals } from "jsr:@std/assert@1";

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
