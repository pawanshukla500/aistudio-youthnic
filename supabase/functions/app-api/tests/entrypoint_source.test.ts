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
