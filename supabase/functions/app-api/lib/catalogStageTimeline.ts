export type CatalogStageDefinition = {
  code: string;
  group_key: string;
  title: string;
  description: string;
  stage_order: number;
  progress_percent: number;
  default_next_action: string;
  terminal: boolean;
};

export type CatalogStageEvent = {
  event_type?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  stage_code?: string | null;
  duration_seconds?: number | string | null;
  created_at?: string | null;
};

export type CatalogTimelineItem = {
  workflow_stage?: string | null;
  workflow_progress?: number | string | null;
  stage_started_at?: string | null;
  request_date?: string | null;
  created_at?: string | null;
};

function millis(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function secondsBetween(start: unknown, end: unknown) {
  const startMs = millis(start);
  const endMs = millis(end);
  return startMs && endMs && endMs >= startMs ? Math.round((endMs - startMs) / 1_000) : 0;
}

function recordedOrCalculatedDuration(
  event: CatalogStageEvent,
  stageCode: string,
  transitions: CatalogStageEvent[],
  eventIndex: number,
  initialStage: string,
  initialStartedAt: string | null,
) {
  if (event.duration_seconds !== null && event.duration_seconds !== undefined && event.duration_seconds !== "") {
    const recorded = Number(event.duration_seconds);
    if (Number.isFinite(recorded) && recorded >= 0) return Math.round(recorded);
  }
  const priorEntry = transitions.slice(0, eventIndex).reverse()
    .find((candidate) => candidate.to_status === stageCode || candidate.stage_code === stageCode);
  const startedAt = priorEntry?.created_at || (initialStage === stageCode ? initialStartedAt : null);
  return secondsBetween(startedAt, event.created_at);
}

/**
 * Builds visit-aware stage timings from immutable transition events.
 *
 * A transition event's duration belongs to `from_status` (the stage being
 * exited), not `to_status` (the stage being entered). Re-entry is expected for
 * review/re-generation loops, so every completed visit is summed and the live
 * elapsed time is added only to the current stage.
 */
export function buildCatalogStageTimeline(
  stages: CatalogStageDefinition[],
  events: CatalogStageEvent[],
  item: CatalogTimelineItem,
  now: Date | number = Date.now(),
) {
  const transitions = events
    .filter((event) => !event.event_type || event.event_type === "workflow_stage_changed")
    .filter((event) => event.from_status || event.to_status || event.stage_code)
    .sort((left, right) => millis(left.created_at) - millis(right.created_at));
  const currentStage = String(item.workflow_stage || "");
  const currentProgress = Number(item.workflow_progress || 0);
  const initialStage = String(transitions[0]?.from_status || (transitions.length ? "" : currentStage));
  const initialStartedAt = String(item.created_at || item.request_date || "") || null;
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const exceptionalCurrent = ["blocked_failed", "regeneration_required"].includes(currentStage);

  return stages.map((stage) => {
    const entries = transitions.filter((event) => event.to_status === stage.code || event.stage_code === stage.code);
    const exits = transitions
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.from_status === stage.code);
    const isCurrent = stage.code === currentStage;
    const inferredCompleted = !exceptionalCurrent
      && stage.group_key !== "exception"
      && Number(stage.progress_percent) < currentProgress;
    const status = isCurrent ? "current" : exits.length || entries.length || inferredCompleted ? "completed" : "pending";
    const firstStartedAt = initialStage === stage.code ? initialStartedAt : entries[0]?.created_at || null;
    const currentStartedAt = isCurrent
      ? item.stage_started_at || entries.at(-1)?.created_at || firstStartedAt
      : null;
    const completedAt = isCurrent ? null : exits.at(-1)?.event.created_at || null;
    const completedDuration = exits.reduce((sum, { event, index }) => sum + recordedOrCalculatedDuration(
      event,
      stage.code,
      transitions,
      index,
      initialStage,
      initialStartedAt,
    ), 0);
    const liveDuration = isCurrent ? secondsBetween(currentStartedAt, nowIso) : 0;
    const visitCount = entries.length + (initialStage === stage.code ? 1 : 0) || (isCurrent ? 1 : 0);

    return {
      code: stage.code,
      groupKey: stage.group_key,
      title: stage.title,
      description: stage.description,
      order: Number(stage.stage_order),
      progressPercent: Number(stage.progress_percent),
      defaultNextAction: stage.default_next_action,
      terminal: Boolean(stage.terminal),
      status: status as "completed" | "current" | "pending",
      startedAt: firstStartedAt,
      currentStartedAt,
      completedAt,
      completedDurationSeconds: completedDuration,
      currentVisitDurationSeconds: liveDuration,
      durationSeconds: completedDuration + liveDuration,
      visitCount,
    };
  });
}
