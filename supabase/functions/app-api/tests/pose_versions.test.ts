import { assertEquals } from "jsr:@std/assert@1";
import {
  buildPoseVersions,
  deliveredVersionTiming,
  formatDuration,
  stampPoseTiming,
  summarizeRegenerations,
} from "../../../../src/lib/poseVersions.ts";

const JOB_CREATED = "2026-09-25T10:00:00.000Z";

Deno.test("a first-time pose is timed from its job and keeps its start across retries", () => {
  const first = stampPoseTiming({}, { epoch: 1, attempt: 1, jobCreatedAt: JOB_CREATED, now: "2026-09-25T10:02:00.000Z" });
  assertEquals(first, { epoch: 1, requestedAt: JOB_CREATED, startedAt: "2026-09-25T10:02:00.000Z" });

  // A QA retry an hour later is the same version: the start must not move.
  const retried = stampPoseTiming({ timing: first }, { epoch: 1, attempt: 2, jobCreatedAt: JOB_CREATED, now: "2026-09-25T11:00:00.000Z" });
  assertEquals(retried.startedAt, "2026-09-25T10:02:00.000Z");
});

Deno.test("retrying a failed pose starts a fresh stamp even in the same epoch", () => {
  // "Retry failed poses" resets attempts to 1 without bumping the epoch.
  const failedRun = { timing: { epoch: 1, requestedAt: JOB_CREATED, startedAt: "2026-09-25T10:02:00.000Z" } };
  const rerun = stampPoseTiming(failedRun, { epoch: 1, attempt: 1, jobCreatedAt: JOB_CREATED, now: "2026-09-25T15:00:00.000Z" });
  assertEquals(rerun.startedAt, "2026-09-25T15:00:00.000Z");
});

Deno.test("a regeneration is timed from when it was requested, not from the job", () => {
  const data = {
    timing: { epoch: 1, requestedAt: JOB_CREATED, startedAt: "2026-09-25T10:02:00.000Z" },
    regenerationQueuedAt: "2026-09-26T09:00:00.000Z",
  };
  const stamp = stampPoseTiming(data, { epoch: 2, attempt: 1, jobCreatedAt: JOB_CREATED, now: "2026-09-26T09:00:30.000Z" });
  assertEquals(stamp, { epoch: 2, requestedAt: "2026-09-26T09:00:00.000Z", startedAt: "2026-09-26T09:00:30.000Z" });

  const timing = deliveredVersionTiming(stamp, { completedAt: "2026-09-26T09:02:30.000Z", attempt: 2, generationMs: 61_000 });
  assertEquals(timing.queueMs, 30_000);
  assertEquals(timing.activeMs, 120_000);
  assertEquals(timing.totalMs, 150_000);
  assertEquals(timing.generationMs, 61_000);
  assertEquals(timing.attempts, 2);
});

Deno.test("every delivered image is a version, oldest first, and the pose's pointer is current", () => {
  const assets = [
    { id: "b", image_url: "u2", storage_path: "p2", created_at: "2026-09-26T09:02:30.000Z", metadata: { poseIndex: 3, actualCostUsd: 1.1, usage: { input_tokens: 100, output_tokens: 10 } } },
    { id: "a", image_url: "u1", storage_path: "p1", created_at: "2026-09-25T10:05:00.000Z", metadata: { poseIndex: 3, actualCostUsd: 1.0 } },
    { id: "c", image_url: "u3", storage_path: "p3", created_at: "2026-09-26T12:00:00.000Z", metadata: { poseIndex: 3, actualCostUsd: 1.2 } },
  ];
  const versions = buildPoseVersions(assets, [], "p2");
  assertEquals(versions.map((version) => version.id), ["a", "b", "c"]);
  assertEquals(versions.map((version) => version.version), [1, 2, 3]);
  assertEquals(versions.map((version) => version.isCurrent), [false, true, false]);
  assertEquals(versions.map((version) => version.isRegeneration), [false, true, true]);
  assertEquals(versions[1].inputTokens, 100);
  assertEquals(versions[1].outputTokens, 10);
});

Deno.test("the newest version is current when the pose points at none of them", () => {
  const assets = [
    { id: "a", image_url: "u1", storage_path: "p1", created_at: "2026-09-25T10:05:00.000Z", metadata: {} },
    { id: "b", image_url: "u2", storage_path: "p2", created_at: "2026-09-26T10:05:00.000Z", metadata: {} },
  ];
  assertEquals(buildPoseVersions(assets, [], "").map((version) => version.isCurrent), [false, true]);
  assertEquals(buildPoseVersions(assets, [], "gone").map((version) => version.isCurrent), [false, true]);
});

Deno.test("stamped timing wins over reconstruction", () => {
  const assets = [
    { id: "a", image_url: "u1", storage_path: "p1", created_at: "2026-09-25T10:05:00.000Z", metadata: {} },
    {
      id: "b", image_url: "u2", storage_path: "p2", created_at: "2026-09-26T09:02:31.000Z",
      metadata: {
        attempt: 2,
        regenerationInstructions: "Match the palace steps backdrop",
        timing: { epoch: 2, attempts: 2, requestedAt: "2026-09-26T09:00:00.000Z", completedAt: "2026-09-26T09:02:30.000Z", totalMs: 150_000, activeMs: 120_000, generationMs: 61_000 },
      },
    },
  ];
  const [, regenerated] = buildPoseVersions(assets, [{ requestedAt: "2026-09-26T08:00:00.000Z", instructions: "older" }], "p2");
  assertEquals(regenerated.timingRecorded, true);
  assertEquals(regenerated.totalMs, 150_000);
  assertEquals(regenerated.activeMs, 120_000);
  assertEquals(regenerated.generationMs, 61_000);
  assertEquals(regenerated.attempts, 2);
  assertEquals(regenerated.instructions, "Match the palace steps backdrop");
});

Deno.test("legacy versions get their wait from the regeneration request they answered", () => {
  const assets = [
    { id: "a", image_url: "u1", storage_path: "p1", created_at: "2026-09-25T10:05:00.000Z", metadata: {} },
    { id: "b", image_url: "u2", storage_path: "p2", created_at: "2026-09-26T09:03:00.000Z", metadata: {} },
    { id: "c", image_url: "u3", storage_path: "p3", created_at: "2026-09-27T09:01:00.000Z", metadata: {} },
  ];
  const history = [
    { requestedAt: "2026-09-26T09:00:00.000Z", instructions: "second" },
    { requestedAt: "2026-09-27T09:00:00.000Z", instructions: "third" },
    // A request that never produced a delivery must not be matched to one.
    { requestedAt: "2026-09-28T09:00:00.000Z", instructions: "pending" },
  ];
  const versions = buildPoseVersions(assets, history, "p3");
  assertEquals(versions.map((version) => version.instructions), ["", "second", "third"]);
  assertEquals(versions.map((version) => version.totalMs), [0, 180_000, 60_000]);
  assertEquals(versions.every((version) => !version.timingRecorded), true);
});

Deno.test("the summary counts only regenerations, not first deliveries", () => {
  const pose = (count: number, totalMs = 60_000) => Array.from({ length: count }, (_, index) => ({
    id: `${index}`, version: index + 1, isCurrent: index === count - 1, isRegeneration: index > 0,
    url: "", storagePath: "", storageBackend: "", createdAt: "", qaStatus: "", qaEnabled: null, quality: "",
    actualCostUsd: 1, inputTokens: 0, outputTokens: 0, attempts: 1, instructions: "",
    requestedAt: "", totalMs, activeMs: 0, generationMs: 0, timingRecorded: true,
  }));
  const summary = summarizeRegenerations([pose(1), pose(3), pose(2, 0)]);
  assertEquals(summary.regenerations, 3);
  assertEquals(summary.regeneratedPoses, 2);
  // The untimed regeneration counts, but does not drag the average to zero.
  assertEquals(summary.totalRegenerationMs, 120_000);
  assertEquals(summary.averageRegenerationMs, 60_000);
  assertEquals(summary.regenerationCostUsd, 3);
});

Deno.test("durations read like a stopwatch", () => {
  assertEquals(formatDuration(0), "");
  assertEquals(formatDuration(48_200), "48s");
  assertEquals(formatDuration(125_000), "2m 05s");
  assertEquals(formatDuration(3_780_000), "1h 03m");
});
