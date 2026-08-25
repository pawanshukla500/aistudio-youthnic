import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { visibleGenerationDetailedStatus } from "./generationStatus";

type JsonObject = Record<string, unknown>;

type DashboardJob = {
  _id: string;
  status: string;
  detailedStatus?: string;
  skuId: string;
  skuName: string;
  completedPoses: number;
  failedPoses: number;
  totalPoses: number;
  createdAt: number;
};

export type SupabaseDashboardSummary = {
  planning: {
    catalogs: number;
    drafts: number;
    active: number;
    colourways: number;
    completed: number;
    failed: number;
  };
  jobs: {
    active: number;
    completed: number;
    failed: number;
    current: DashboardJob | null;
    recent: DashboardJob[];
  };
  analytics: {
    days: Array<{ date: string; label: string; generations: number; tokens: number; costUsd: number }>;
    types: Array<{ label: string; value: number }>;
    totals: { generations: number; tokens: number; costUsd: number };
    costSource: "openai_admin" | "generation_responses";
  };
};

type BatchRow = {
  id: string;
  status: string;
  queue_status: string;
  schedule_status: string;
  total_skus: number;
  generated_count: number;
  pending_count: number;
  failed_count: number;
};

type RequestRow = {
  id: string;
  status: string;
  generation_status: string;
  completion_status: string;
};

type GenerationJobRow = {
  job_id: string;
  status: string;
  sku_name: string;
  job_data: JsonObject;
  created_at: string;
  actual_cost_usd?: number;
  total_tokens?: number;
  batch_id?: string | null;
};

type LearningRow = {
  id: string;
  job_id: string;
  sku_name: string;
  status: string;
  pose_count: number;
  created_at: string;
};

function numberFrom(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapGenerationJob(row: GenerationJobRow): DashboardJob {
  const data = row.job_data || {};
  const totalPoses = numberFrom(data.totalPoses, 5);
  return {
    _id: row.job_id,
    status: row.status,
    detailedStatus: visibleGenerationDetailedStatus(row.status, data.detailedStatus),
    skuId: row.sku_name || row.job_id,
    skuName: row.sku_name,
    completedPoses: numberFrom(data.completedPoses),
    failedPoses: numberFrom(data.failedPoses),
    totalPoses,
    createdAt: Date.parse(row.created_at),
  };
}

function mapLearning(row: LearningRow): DashboardJob {
  const failed = row.status === "failed";
  const poseCount = numberFrom(row.pose_count);
  return {
    _id: row.id,
    status: row.status,
    skuId: row.sku_name || row.job_id || row.id,
    skuName: row.sku_name,
    completedPoses: failed ? 0 : poseCount,
    failedPoses: failed ? Math.max(1, poseCount) : 0,
    totalPoses: Math.max(5, poseCount),
    createdAt: Date.parse(row.created_at),
  };
}

async function loadSummary(): Promise<SupabaseDashboardSummary> {
  const analyticsStart = new Date(Date.now() - 13 * 86_400_000);
  analyticsStart.setUTCHours(0, 0, 0, 0);
  const [batchesResult, requestsResult, jobsResult, analyticsJobsResult, learningsResult, openAiUsageResult] = await Promise.all([
    supabase
      .from("planning_batches")
      .select("id,status,queue_status,schedule_status,total_skus,generated_count,pending_count,failed_count")
      .is("archived_at", null),
    supabase
      .from("planning_requests")
      .select("id,status,generation_status,completion_status")
      .is("archived_at", null),
    supabase
      .from("generation_jobs")
      .select("job_id,status,sku_name,job_data,created_at,actual_cost_usd,total_tokens,batch_id")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("generation_jobs")
      .select("job_id,status,sku_name,job_data,created_at,actual_cost_usd,total_tokens,batch_id")
      .gte("created_at", analyticsStart.toISOString())
      .order("created_at", { ascending: true }),
    supabase
      .from("generation_learnings")
      .select("id,job_id,sku_name,status,pose_count,created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("openai_usage_daily")
      .select("usage_date,actual_cost_usd")
      .gte("usage_date", analyticsStart.toISOString().slice(0, 10))
      .order("usage_date", { ascending: true }),
  ]);

  const error = batchesResult.error || requestsResult.error || jobsResult.error || analyticsJobsResult.error || learningsResult.error;
  if (error) throw error;

  const batches = (batchesResult.data || []) as BatchRow[];
  const requests = (requestsResult.data || []) as RequestRow[];
  const generationJobs = ((jobsResult.data || []) as GenerationJobRow[]).map(mapGenerationJob);
  const analyticsJobs = (analyticsJobsResult.data || []) as GenerationJobRow[];
  const learnedJobs = ((learningsResult.data || []) as LearningRow[]).map(mapLearning);
  const recent = (generationJobs.length ? generationJobs : learnedJobs)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 5);
  const activeStatuses = new Set(["pending", "queued", "processing", "generating", "running"]);
  const completedRequests = requests.filter((request) =>
    request.status === "completed" || request.generation_status === "completed" || request.completion_status === "completed"
  ).length;
  const failedRequests = requests.filter((request) =>
    request.status === "failed" || request.generation_status === "failed" || request.completion_status === "failed"
  ).length;
  const costByDate = new Map<string, number>();
  for (const row of openAiUsageResult.data || []) costByDate.set(row.usage_date, (costByDate.get(row.usage_date) || 0) + Number(row.actual_cost_usd || 0));
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(analyticsStart.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    const dateJobs = analyticsJobs.filter((job) => job.created_at.slice(0, 10) === date);
    const responseCost = dateJobs.reduce((total, job) => total + Number(job.actual_cost_usd || 0), 0);
    return {
      date,
      label: new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(new Date(`${date}T00:00:00Z`)),
      generations: dateJobs.length,
      tokens: dateJobs.reduce((total, job) => total + Number(job.total_tokens || 0), 0),
      costUsd: costByDate.size ? Number(costByDate.get(date) || 0) : responseCost,
    };
  });
  const studioCount = analyticsJobs.filter((job) => !job.batch_id).length;
  const catalogCount = analyticsJobs.length - studioCount;

  return {
    planning: {
      catalogs: batches.length,
      drafts: batches.filter((batch) =>
        batch.status === "active" && batch.queue_status === "idle" && ["", "none"].includes(batch.schedule_status || "none")
      ).length,
      active: batches.filter((batch) =>
        activeStatuses.has(batch.queue_status) || ["scheduled", "running"].includes(batch.schedule_status)
      ).length,
      colourways: batches.reduce((total, batch) => total + numberFrom(batch.total_skus), 0) || requests.length,
      completed: batches.reduce((total, batch) => total + numberFrom(batch.generated_count), 0) || completedRequests,
      failed: batches.reduce((total, batch) => total + numberFrom(batch.failed_count), 0) || failedRequests,
    },
    jobs: {
      active: generationJobs.filter((job) => activeStatuses.has(job.status)).length,
      completed: learnedJobs.filter((job) => job.status === "completed").length,
      failed: learnedJobs.filter((job) => job.status === "failed").length,
      current: generationJobs.find((job) => activeStatuses.has(job.status)) || null,
      recent,
    },
    analytics: {
      days,
      types: [{ label: "Studio", value: studioCount }, { label: "Catalog", value: catalogCount }],
      totals: {
        generations: analyticsJobs.length,
        tokens: days.reduce((total, day) => total + day.tokens, 0),
        costUsd: days.reduce((total, day) => total + day.costUsd, 0),
      },
      costSource: costByDate.size ? "openai_admin" : "generation_responses",
    },
  };
}

export function useSupabaseDashboardSummary() {
  const [summary, setSummary] = useState<SupabaseDashboardSummary>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void loadSummary()
          .then((nextSummary) => {
            if (!active) return;
            setSummary(nextSummary);
            setError("");
          })
          .catch((reason: unknown) => {
            if (!active) return;
            if (reason instanceof Error) {
              setError(reason.message);
              return;
            }
            if (reason && typeof reason === "object" && "message" in reason && typeof reason.message === "string") {
              setError(reason.message);
              return;
            }
            setError("Could not load Supabase operations.");
          });
      }, 75);
    };

    refresh();
    const channel = supabase
      .channel("dashboard-operations")
      .on("postgres_changes", { event: "*", schema: "public", table: "planning_batches" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "planning_requests" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "generation_jobs" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "openai_usage_daily" }, refresh)
      .subscribe();

    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, []);

  return { summary, error };
}
