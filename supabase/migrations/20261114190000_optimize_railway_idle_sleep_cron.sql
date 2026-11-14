-- Migration: 20261114190000_optimize_railway_idle_sleep_cron.sql
-- Purpose:
-- Eliminate unconditional background HTTP wakeups from pg_cron to the Railway functions
-- service when no work is pending, allowing Railway services (functions, FastAPI,
-- celery-worker, Valkey, Postgrest, Envoy, Postgres) to stay in Serverless Sleep when idle.
--
-- Specifically:
-- 1. Adds zero-cost SQL pre-checks in private.dispatch_app_worker(text) for:
--    - 'catalogProduction.automation' (only wakes functions if failed deliveries are due for
--      retry OR ready/approved listing handoffs await delivery)
--    - 'usage.sync' (only wakes functions if generation_jobs ran recently or initial sync is needed)
--    - 'events.automation' (only wakes functions when automation is enabled and due)
-- 2. Aligns all remaining pg_cron jobs (preflight, catalog production report, usage sync,
--    event automation) with the 02:00-19:00 UTC awake window and right-sized cadences.

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
    SELECT EXISTS (
      SELECT 1 FROM public.planning_batches
      WHERE (schedule_status = 'scheduled' AND scheduled_at <= now())
         OR schedule_status = 'running'
    ) INTO has_work;
    IF NOT has_work THEN RETURN; END IF;

  ELSIF operation_name = 'catalog.preflight' THEN
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

  ELSIF operation_name = 'catalogProduction.automation' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.catalog_report_deliveries
      WHERE status = 'failed'
        AND coalesce(next_retry_at, now()) <= now()
    ) OR EXISTS (
      SELECT 1
      FROM public.catalog_listing_handoffs AS h
      JOIN public.catalog_work_items AS w ON w.id = h.work_item_id
      WHERE h.status = 'ready'
        AND w.qc_status = 'passed'
        AND w.final_approved_at IS NOT NULL
        AND w.listing_sent_at IS NULL
    ) INTO has_work;
    IF NOT has_work THEN RETURN; END IF;

  ELSIF operation_name = 'usage.sync' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.generation_jobs
      WHERE updated_at >= now() - interval '2 hours'
    ) OR EXISTS (
      SELECT 1 FROM public.event_automation_settings AS eas
      WHERE (eas.last_usage_sync_at IS NULL OR eas.last_usage_sync_at < now() - interval '12 hours')
        AND EXISTS (
          SELECT 1 FROM public.generation_jobs AS gj
          WHERE eas.last_usage_sync_at IS NULL OR gj.updated_at >= eas.last_usage_sync_at
        )
    ) INTO has_work;
    IF NOT has_work THEN RETURN; END IF;

  ELSIF operation_name = 'events.automation' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.event_automation_settings
      WHERE (research_enabled = true OR monthly_report_enabled = true OR reminder_enabled = true)
        AND (last_automation_at IS NULL OR last_automation_at < now() - interval '20 hours')
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

DO $$
DECLARE
  existing_job bigint;
  job_name text;
BEGIN
  FOREACH job_name IN ARRAY ARRAY[
    'ai-studio-catalog-preflight',
    'ai-studio-catalog-production-report',
    'ai-studio-openai-usage-sync',
    'ai-studio-event-automation'
  ]
  LOOP
    SELECT jobid INTO existing_job FROM cron.job WHERE jobname = job_name LIMIT 1;
    IF existing_job IS NOT NULL THEN
      PERFORM cron.unschedule(existing_job);
    END IF;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'ai-studio-catalog-preflight',
  '*/5 2-19 * * *',
  $$SELECT private.dispatch_app_worker('catalog.preflight')$$
);

SELECT cron.schedule(
  'ai-studio-catalog-production-report',
  '7,37 2-19 * * *',
  $$SELECT private.dispatch_app_worker('catalogProduction.automation')$$
);

SELECT cron.schedule(
  'ai-studio-openai-usage-sync',
  '10 2-19 * * *',
  $$SELECT private.dispatch_app_worker('usage.sync')$$
);

SELECT cron.schedule(
  'ai-studio-event-automation',
  '35 3,11 * * *',
  $$SELECT private.dispatch_app_worker('events.automation')$$
);
