import { assert, assertEquals } from "jsr:@std/assert@1";
import { poseGroupBusyStatus, poseGroupQa, signedSessionReferences } from "../catalogProduction.ts";
import { adoptedPostures, boardFromGenerationData, referencesFromSession } from "../../../../src/features/history/generation-flow/boardFromGenerationData.ts";
import { neighborIds, qaVerdict } from "../../../../src/features/history/generation-flow/flowLinks.ts";
import { flowSummaryFrom, settingsLine } from "../../../../src/features/history/generation-flow/flowSummary.ts";
import { formatModelName } from "../../../../src/lib/modelLabels.ts";

const sessionData = {
  skuName: "B161-Kishori-Bottle Green",
  analysisModel: "muse-spark-1.3-contributor",
  analysisProvider: "meta",
  analysisVersion: 37,
  productDnaVersion: 2,
  analysisPolicy: {
    requested: {
      thinkingLevel: "medium",
      fallbacks: [{ model: "glm-5.3-flash" }, { model: "gpt-6.1-terra" }, { model: "gpt-5.6-luna" }, { model: "gemini-3.8-flash" }],
    },
  },
  productIdentity: { category: "ethnic/fusion", mainColor: "deep bottle green", logos: "none", buttons: "none", fabric: "soft matte cotton-blend", pockets: "none visible" },
  posePlan: [{ title: "Front Hero" }, { title: "Turn" }, { title: "True back" }, { title: "Editorial" }, { title: "Detail" }, { title: "Showcase" }],
  posePlanning: { slots: { creative: { source: "reference" }, showcase: { source: "local" } } },
  references: [
    { id: "f", role: "front", downloadUrl: "https://example.test/front.jpg", filename: "B161 (7).jpg" },
    { id: "s", role: "style_reference", downloadUrl: "https://example.test/room.jpg" },
    { id: "x", role: "back" },
  ],
};

Deno.test("the flow summary names the analysis model, its fallbacks, the product facts and the Pose 4 reference posture", () => {
  const summary = flowSummaryFrom({
    sessionData,
    job: { job_id: "job_1", status: "completed", model: "gpt-image-2.6-sunburst", aspect_ratio: "3:4", image_size: "2K", quality: "medium", actual_cost_usd: 1.03, estimated_cost_usd: 0.9, completed_poses: 6, total_poses: 6, pose_qa: false },
  });
  assertEquals(summary.skuName, "B161-Kishori-Bottle Green");
  assertEquals(summary.analysis?.modelLabel, "Meta Muse Spark 1.3");
  assertEquals(summary.analysis?.thinking, "medium");
  // Three fallbacks at most, in words.
  assertEquals(summary.analysis?.fallbacks, ["Z.ai GLM 5.3 Flash", "GPT 6.1 Terra", "GPT 5.6 Luna"]);
  assertEquals(summary.analysis?.version, 37);
  assertEquals(summary.analysis?.dnaVersion, 2);
  // "none" values (logos, buttons, pockets) are not product facts.
  assertEquals(summary.analysis?.facts.map((fact) => fact.label), ["Category", "Main colour", "Fabric"]);
  assertEquals(summary.analysis?.plan.filter((step) => step.copiesReferencePosture).map((step) => step.poseIndex), [4]);
  assertEquals(summary.run?.modelLabel, "GPT Image 2.6 Sunburst");
  assertEquals(summary.run?.costUsd, 1.03);
  assertEquals(settingsLine(summary.run), "3:4 · 2K · Medium");
});

Deno.test("the flow summary falls back to the estimate before a run has a cost, and has no analysis for legacy sessions", () => {
  const summary = flowSummaryFrom({ sessionData: {}, job: { job_id: "job_2", model: "gpt-image-2", estimated_cost_usd: 0.42, total_poses: 6 }, skuName: "Legacy" });
  assertEquals(summary.analysis, null);
  assertEquals(summary.run?.costUsd, 0.42);
  assertEquals(summary.run?.total, 6);
  // A queued job stores actual_cost_usd = 0 until something is billed.
  assertEquals(flowSummaryFrom({ job: { job_id: "job_3", status: "queued", actual_cost_usd: 0, estimated_cost_usd: 0.9 } }).run?.costUsd, 0.9);
  assertEquals(flowSummaryFrom({ job: { job_id: "job_4", actual_cost_usd: 0 } }).run?.costUsd, 0);
  assertEquals(flowSummaryFrom({ job: { job_id: "job_5" } }).run?.costUsd, null);
  assertEquals(flowSummaryFrom({}).run, null);
  assertEquals(settingsLine(null), "");
});

Deno.test("an output card's verdict: a human decision first, then QA, then the product DNA check", () => {
  assertEquals(qaVerdict("human_approved", { pass: false }), { label: "Approved", tone: "good" });
  assertEquals(qaVerdict("rejected_by_qa", { pass: true, score: 97 }), { label: "Rejected by QA", tone: "bad" });
  assertEquals(qaVerdict("requires_human_review", { pass: false, score: 61 }), { label: "Needs review", tone: "warn" });
  assertEquals(qaVerdict("unverified", { pass: true, score: 94.6 }), { label: "DNA 95%", tone: "good" });
  assertEquals(qaVerdict("unverified", { pass: false, score: 70 }), { label: "DNA check failed 70%", tone: "warn" });
  // An outage verdict is not a pass.
  assertEquals(qaVerdict("unverified", { pass: true, unavailable: true }), { label: "Not checked", tone: "warn" });
  assertEquals(qaVerdict("automatically_verified", null), { label: "QA passed", tone: "good" });
  assertEquals(qaVerdict("", null), null);
});

Deno.test("session references become board inputs, and only the style photo names the postures the plan copies", () => {
  assertEquals(adoptedPostures(sessionData), [4]);
  assertEquals(adoptedPostures(undefined), []);
  const inputs = referencesFromSession(sessionData.references, adoptedPostures(sessionData));
  // The back photo has no URL to show.
  assertEquals(inputs.map((input) => input.id), ["f", "s"]);
  assertEquals(inputs[0].fileName, "B161 (7).jpg");
  assertEquals(inputs[0].postureFor, undefined);
  assertEquals(inputs[1].postureFor, [4]);
  assertEquals(referencesFromSession(null), []);
});

Deno.test("the trace board carries settings, the DNA verdict and the summary; a pose without an image has no verdict", () => {
  const board = boardFromGenerationData({
    trace: {
      summary: { job_id: "job_1", status: "completed", model: "gpt-image-2.6-sunburst", aspect_ratio: "3:4", image_size: "2K", quality: "medium" },
      session: sessionData,
      poses: [
        { generation_id: "g1", job_id: "job_1", pose_index: 1, status: "completed", final_output_url: "https://example.test/p1.jpg", qa_status: "unverified", qa_payload: { dna: { pass: true, score: 95 } } },
        { generation_id: "g2", job_id: "job_1", pose_index: 2, status: "processing", qa_status: "unverified", qa_payload: { dna: { pass: true, score: 90 } } },
      ],
    },
  });
  assertEquals(board.summary.analysis?.modelLabel, "Meta Muse Spark 1.3");
  assertEquals(board.references.map((reference) => reference.id), ["f", "s"]);
  assertEquals([board.poses[0].aspectRatio, board.poses[0].imageSize, board.poses[0].quality], ["3:4", "2K", "medium"]);
  assertEquals(board.poses[0].qaLabel, "DNA 95%");
  assertEquals(board.poses[1].qaLabel, undefined);
});

Deno.test("selecting a pose lights the photos that feed its image directly and the analysis that feeds its prompt", () => {
  const linked = neighborIds("image-1", [
    { source: "ref-front", target: "image-1" },
    { source: "ref-back", target: "image-3" },
    { source: "analysis", target: "prompt-1" },
    { source: "prompt-1", target: "image-1" },
  ]);
  assertEquals([...linked].sort(), ["analysis", "prompt-1", "ref-front"]);
});

Deno.test("the workflow detail signs Supabase session photos, keeps Firebase URLs, and never fails the board on a foreign path", async () => {
  const signed: string[] = [];
  const service = {
    storage: {
      from: () => ({
        createSignedUrl: (path: string) => {
          signed.push(path);
          return Promise.resolve({ data: { signedUrl: `https://signed.test/${path}` }, error: null });
        },
      }),
    },
  };
  const rows = await signedSessionReferences(service as never, "org1", [
    { id: "a", role: "front", storageBackend: "supabase", storagePath: "organizations/org1/references/a.jpg", downloadUrl: "https://old.test/a.jpg" },
    { id: "b", role: "model_identity", storageBackend: "firebase", storagePath: "organizations/org1/references/b.jpg", downloadUrl: "https://firebase.test/b.jpg" },
    { id: "c", role: "back", storageBackend: "supabase", storagePath: "organizations/other/references/c.jpg", url: "https://old.test/c.jpg" },
  ]);
  assertEquals(rows.map((row) => row.downloadUrl), ["https://signed.test/org1/references/a.jpg", "https://firebase.test/b.jpg", "https://old.test/c.jpg"]);
  assertEquals(signed, ["org1/references/a.jpg"]);
  assertEquals(rows[0].role, "front");
  assertEquals(await signedSessionReferences(service as never, "org1", undefined), []);
});

Deno.test("a pose group shows its own verdict, and none while a re-generation is running", () => {
  assertEquals(poseGroupQa({ qa_status: "unverified", qa_payload: { dna: { pass: true, score: 94 } } }, false), { status: "unverified", dna: { pass: true, score: 94 } });
  assertEquals(poseGroupQa({ qa_status: "unverified", qa_payload: { dna: { pass: true } } }, true), null);
  assertEquals(poseGroupQa(null, false), null);
});

Deno.test("a pose group says it is working while its re-generation runs, so the card is not shown as finished", () => {
  assertEquals(poseGroupBusyStatus({ status: "processing" }), "processing");
  assertEquals(poseGroupBusyStatus({ status: "queued" }), "queued");
  assertEquals(poseGroupBusyStatus({ status: "completed" }), null);
  assertEquals(poseGroupBusyStatus(null), null);
});

Deno.test("History and the flow board share one model label map", () => {
  assertEquals(formatModelName("glm-5.3-flashx"), "Z.ai GLM 5.3 FlashX");
  assertEquals(formatModelName("new-model-9"), "New Model 9");
  assertEquals(formatModelName(""), "Default Model");
  assert(formatModelName("gpt-image-2.5-sunburst").startsWith("GPT Image 2.5"));
});
