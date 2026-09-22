-- Migration: 20260922170000_railway_idle_sleep_and_night_window.sql
-- Description:
-- 1. Updates private.dispatch_app_worker to check for active work before triggering background HTTP requests.
-- 2. Enforces night sleeping mode from 1:00 AM to 7:00 AM Indian Standard Time (Asia/Kolkata).
-- 3. Adjusts pg_cron schedules to run every 5 minutes only during awake hours (02:00-19:00 UTC = 07:30 AM to 12:30 AM IST).

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
  -- 1. Check Indian Standard Time (IST) Sleeping Window: 1:00 AM to 7:00 AM (01:00:00 - 07:00:00 IST)
  ist_time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
  IF ist_time >= '01:00:00'::time AND ist_time < '07:00:00'::time THEN
    -- In scheduled night sleeping mode. Do not send any network packets.
    RETURN;
  END IF;

  -- 2. Check if there is actual work to do before waking up / calling the Railway functions service
  IF operation_name = 'worker' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.generation_jobs
      WHERE status IN ('queued', 'processing', 'cancelling')
    ) OR EXISTS (
      SELECT 1 FROM public.session_generations
      WHERE status IN ('queued', 'processing')
    ) INTO has_work;

    IF NOT has_work THEN
      -- No generation jobs in flight. Avoid waking up Railway functions service.
      RETURN;
    END IF;
  ELSIF operation_name = 'catalog.process' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.planning_requests
      WHERE analysis_status IN ('queued', 'processing')
         OR status IN ('queued', 'processing')
    ) OR EXISTS (
      SELECT 1 FROM public.catalog_work_items
      WHERE status IN ('queued', 'processing')
    ) INTO has_work;

    IF NOT has_work THEN
      -- No catalog items in flight. Avoid waking up Railway functions service.
      RETURN;
    END IF;
  END IF;

  -- 3. Only if there is active work and outside 1 AM - 7 AM IST, retrieve secret and dispatch
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
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'ai-studio-generation-recovery' LIMIT 1;
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'ai-studio-due-catalogs' LIMIT 1;
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
END;
$$;

SELECT cron.schedule(
  'ai-studio-generation-recovery',
  '*/5 2-19 * * *',
  $$SELECT private.dispatch_app_worker('worker')$$
);

SELECT cron.schedule(
  'ai-studio-due-catalogs',
  '*/5 2-19 * * *',
  $$SELECT private.dispatch_app_worker('catalog.process')$$
);
