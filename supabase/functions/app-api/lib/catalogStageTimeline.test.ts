import { assertEquals } from "jsr:@std/assert@1";
import { buildCatalogStageTimeline, type CatalogStageDefinition } from "./catalogStageTimeline.ts";

const stages: CatalogStageDefinition[] = [
  ["requirement_created", "intake", 5],
  ["planning", "planning", 22],
  ["generation_in_progress", "generation", 52],
  ["quality_review", "review", 68],
  ["regeneration_required", "exception", 58],
].map(([code, group, progress], index) => ({
  code: String(code),
  group_key: String(group),
  title: String(code),
  description: "",
  stage_order: index + 1,
  progress_percent: Number(progress),
  default_next_action: "",
  terminal: false,
}));

const at = (seconds: number) => new Date(Date.UTC(2026, 7, 24, 10, 0, seconds)).toISOString();

Deno.test("attributes transition duration to the exited stage and sums re-entry visits", () => {
  const rows = buildCatalogStageTimeline(stages, [
    { event_type: "workflow_stage_changed", from_status: "requirement_created", to_status: "planning", stage_code: "planning", created_at: at(10), duration_seconds: 10 },
    { event_type: "workflow_stage_changed", from_status: "planning", to_status: "generation_in_progress", stage_code: "generation_in_progress", created_at: at(30), duration_seconds: 20 },
    { event_type: "workflow_stage_changed", from_status: "generation_in_progress", to_status: "quality_review", stage_code: "quality_review", created_at: at(90), duration_seconds: 60 },
    { event_type: "workflow_stage_changed", from_status: "quality_review", to_status: "regeneration_required", stage_code: "regeneration_required", created_at: at(100), duration_seconds: 10 },
    { event_type: "workflow_stage_changed", from_status: "regeneration_required", to_status: "generation_in_progress", stage_code: "generation_in_progress", created_at: at(120), duration_seconds: 20 },
    { event_type: "workflow_stage_changed", from_status: "generation_in_progress", to_status: "quality_review", stage_code: "quality_review", created_at: at(180), duration_seconds: 60 },
  ], {
    workflow_stage: "quality_review",
    workflow_progress: 68,
    stage_started_at: at(180),
    created_at: at(0),
  }, new Date(at(200)));

  const generation = rows.find((row) => row.code === "generation_in_progress");
  const review = rows.find((row) => row.code === "quality_review");
  const requirement = rows.find((row) => row.code === "requirement_created");
  assertEquals(generation?.durationSeconds, 120);
  assertEquals(generation?.visitCount, 2);
  assertEquals(generation?.completedAt, at(180));
  assertEquals(review?.durationSeconds, 30);
  assertEquals(review?.visitCount, 2);
  assertEquals(review?.currentStartedAt, at(180));
  assertEquals(requirement?.durationSeconds, 10);
  assertEquals(requirement?.startedAt, at(0));
});

Deno.test("calculates missing legacy durations from adjacent transition timestamps", () => {
  const rows = buildCatalogStageTimeline(stages, [
    { event_type: "workflow_stage_changed", from_status: "requirement_created", to_status: "planning", created_at: at(10) },
    { event_type: "workflow_stage_changed", from_status: "planning", to_status: "generation_in_progress", created_at: at(30) },
  ], {
    workflow_stage: "generation_in_progress",
    workflow_progress: 52,
    stage_started_at: at(30),
    created_at: at(0),
  }, new Date(at(45)));

  assertEquals(rows.find((row) => row.code === "requirement_created")?.durationSeconds, 10);
  assertEquals(rows.find((row) => row.code === "planning")?.durationSeconds, 20);
  assertEquals(rows.find((row) => row.code === "generation_in_progress")?.durationSeconds, 15);
});
