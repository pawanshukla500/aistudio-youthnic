-- Migration: ai_runs_observability
-- Add explicit traceability fields to ai_runs

ALTER TABLE public.ai_runs 
ADD COLUMN IF NOT EXISTS session_id TEXT,
ADD COLUMN IF NOT EXISTS pose_index INTEGER,
ADD COLUMN IF NOT EXISTS attempt_number INTEGER,
ADD COLUMN IF NOT EXISTS generation_id TEXT,
ADD COLUMN IF NOT EXISTS flow_node_id TEXT;

-- Add indexes for common lookup patterns
CREATE INDEX IF NOT EXISTS ai_runs_session_id_idx ON public.ai_runs(session_id);
CREATE INDEX IF NOT EXISTS ai_runs_generation_id_idx ON public.ai_runs(generation_id);
