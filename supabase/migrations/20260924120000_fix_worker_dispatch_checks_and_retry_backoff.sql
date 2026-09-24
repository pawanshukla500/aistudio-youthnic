-- Migration: 20260924120000_fix_worker_dispatch_checks_and_retry_backoff.sql
-- 1. dispatch_app_worker('catalog.process') checked planning_requests.analysis_status/status
--    and catalog_work_items.status for 'queued'/'processing', values those columns never
--    hold, so scheduled catalogs were never started by cron. Check what processCatalog
--    actually claims: planning_batches that are due or already running.
-- 2. dispatch_app_worker('catalog.preflight') now skips the HTTP call when no variant
--    matches the preflight candidate query, so the functions service can sleep when idle.
--    A failed analysis is retried at most every 6 hours (PREFLIGHT_FAILED_RETRY_MS in
--    app-api) instead of on every 2-minute tick.
-- 3. claim_next_generation_job lost its available_at filter when it was redefined in
--    20260811150000, so any worker kick re-claimed a job that deferPoseRetry had just
--    backed off (for example after an OpenAI 429). Restore the filter.

CREATE OR REPLACE FUNCTION private.dispatch_app_worker(operation_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private', 'vault', 'extensions'
AS $$
DECLARE
  worker_secret text;
  ist_time time;
  has_work boolean := false;
BEGIN
  -- Night sleeping window: 1:00 AM to 7:00 AM Indian Standard Time.
  ist_time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  IF ist_time >= '01:00:00'::time AND ist_time < '07:00:00'::time THEN
    RETURN;
  END IF;

  IF operation_name = 'worker' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.generation_jobs
      WHERE status IN ('queued', 'processing', 'cancelling')
    ) OR EXISTS (
      SELECT 1 FROM public.session_generations
      WHERE status IN ('queued', 'processing')
    ) INTO has_work;
    IF NOT has_work THEN RETURN; END IF;
  ELSIF operation_name = 'catalog.process' THEN
    -- Mirrors claim_due_catalog_batch plus the running-batch continuation in processCatalog.
    SELECT EXISTS (
      SELECT 1 FROM public.planning_batches
      WHERE (schedule_status = 'scheduled' AND scheduled_at <= now())
         OR schedule_status = 'running'
    ) INTO has_work;
    IF NOT has_work THEN RETURN; END IF;
  ELSIF operation_name = 'catalog.preflight' THEN
    -- Mirrors the candidate query in processCatalogPreflight.
    SELECT EXISTS (
      SELECT 1 FROM public.planning_requests
      WHERE (analysis_status IN ('pending', 'stale')
             OR (analysis_status = 'failed' AND updated_at < now() - interval '6 hours'))
        AND batch_id IS NOT NULL
        AND validation_status = 'ready'
        AND front_image_url IS NOT NULL
        AND back_image_url IS NOT NULL
    ) INTO has_work;
    IF NOT has_work THEN RETURN; END IF;
  END IF;

  SELECT decrypted_secret
    INTO worker_secret
  FROM vault.decrypted_secrets
  WHERE name = 'catalog_worker_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF coalesce(worker_secret, '') = '' THEN
    RAISE WARNING 'catalog_worker_secret is not installed in Supabase Vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://functions-production-b062.up.railway.app/app-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || worker_secret
    ),
    body := jsonb_build_object('operation', operation_name, 'args', '{}'::jsonb),
    timeout_milliseconds := 15000
  );
END;
$$;

REVOKE ALL ON FUNCTION private.dispatch_app_worker(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.dispatch_app_worker(text) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.claim_next_generation_job()
RETURNS SETOF public.generation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  selected_job_id text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.generation_jobs
    WHERE status IN ('processing', 'cancelling')
      AND coalesce(lock_expires_at, now() + interval '1 minute') > now()
  ) THEN
    RETURN;
  END IF;

  SELECT job.job_id INTO selected_job_id
  FROM public.generation_jobs AS job
  WHERE job.status = 'queued'
    AND coalesce(job.available_at, now()) <= now()
  ORDER BY job.available_at, job.created_at, job.job_id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF selected_job_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.generation_jobs AS job
  SET status = 'processing',
      locked_at = now(),
      lock_expires_at = now() + interval '12 minutes',
      started_at = coalesce(job.started_at, now()),
      attempt_count = job.attempt_count + 1,
      updated_at = now(),
      error_code = '',
      error_message = ''
  WHERE job.job_id = selected_job_id
  RETURNING job.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_generation_job() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_generation_job() TO service_role;
