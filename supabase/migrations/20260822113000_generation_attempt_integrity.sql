-- Add generation_epoch for manual regenerations to maintain immutable history
ALTER TABLE public.session_generations ADD COLUMN IF NOT EXISTS generation_epoch integer DEFAULT 1 NOT NULL;

-- Add reference_fingerprint for SKU-level memory invalidation
ALTER TABLE public.session_generations ADD COLUMN IF NOT EXISTS reference_fingerprint text;

-- Add attempt_number to ai_runs to strongly correlate with QA and ledger
ALTER TABLE public.ai_runs ADD COLUMN IF NOT EXISTS attempt_number integer;
ALTER TABLE public.ai_runs ADD COLUMN IF NOT EXISTS generation_epoch integer;

-- Update QA reviews to track which epoch and attempt they belong to
ALTER TABLE public.qa_reviews ADD COLUMN IF NOT EXISTS generation_epoch integer;
ALTER TABLE public.qa_reviews ADD COLUMN IF NOT EXISTS attempt_number integer;

-- Explicit source type for history filtering
ALTER TABLE public.generation_jobs ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'studio' NOT NULL;
