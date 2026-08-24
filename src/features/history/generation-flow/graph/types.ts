import type { StudioPose } from "../../../studio/types";

export type GenerationTraceSummary = {
  job_id: string;
  session_id: string;
  org_id: string;
  sku_name: string;
  model: string;
  provider: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  actual_cost_usd: number;
  batch_id?: string;
  error_message?: string;
  current_pose?: number;
};

export type TraceAnalysis = {
  version: string;
  productIdentity: any;
  creativeDirection: any;
  posePlan?: StudioPose[];
};

export type TraceAttempt = {
  attempt_index: number;
  provider_request_id?: string;
  model: string;
  provider: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  
  output_url?: string;
  storage_path?: string;
  
  qa?: {
    pass: boolean;
    score: number;
    outcome?: string;
    failed_checks: string[];
    reason: string;
    correction: string;
  };
  
  rejected?: boolean;
  correction?: string;
  is_historical_reconstruction?: boolean;
};

export type TracePose = {
  pose_index: number;
  title: string;
  status: string;
  qa_status: string;
  full_prompt?: string;
  attempts: TraceAttempt[];
  final_output_url?: string;
};

export type GenerationTraceViewModel = {
  summary: GenerationTraceSummary;
  session: TraceAnalysis | null;
  poses: TracePose[];
  learning: any | null;
  learnings?: any[];
};
