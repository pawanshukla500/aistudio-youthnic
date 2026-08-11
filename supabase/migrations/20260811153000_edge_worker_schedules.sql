-- Durable Supabase scheduling for generation lease recovery and due catalogs.
-- The bearer token is stored in Supabase Vault under catalog_worker_secret and
-- is also installed as the CATALOG_WORKER_SECRET Edge Function secret.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function private.dispatch_app_worker(operation_name text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, vault, extensions
as $$
declare
  worker_secret text;
begin
  select decrypted_secret
    into worker_secret
  from vault.decrypted_secrets
  where name = 'catalog_worker_secret'
  order by created_at desc
  limit 1;

  if coalesce(worker_secret, '') = '' then
    raise warning 'catalog_worker_secret is not installed in Supabase Vault';
    return;
  end if;

  perform net.http_post(
    url := 'https://cyygmyiqgdzgeoayxbro.supabase.co/functions/v1/app-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || worker_secret
    ),
    body := jsonb_build_object('operation', operation_name, 'args', '{}'::jsonb),
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function private.dispatch_app_worker(text) from public, anon, authenticated;
grant execute on function private.dispatch_app_worker(text) to service_role, postgres;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'ai-studio-generation-recovery' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  select jobid into existing_job from cron.job where jobname = 'ai-studio-due-catalogs' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

select cron.schedule(
  'ai-studio-generation-recovery',
  '* * * * *',
  $$select private.dispatch_app_worker('worker')$$
);

select cron.schedule(
  'ai-studio-due-catalogs',
  '* * * * *',
  $$select private.dispatch_app_worker('catalog.process')$$
);
