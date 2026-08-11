-- Persist provider-reported image usage per pose and expose automatic catalog
-- analysis state. Firebase Storage remains the binary media authority; these
-- columns contain only durable metadata and cost/accounting facts.

alter table public.session_generations
  add column if not exists provider_request_id text not null default '',
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists input_text_tokens bigint not null default 0,
  add column if not exists input_image_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists total_tokens bigint not null default 0,
  add column if not exists actual_cost_usd numeric(12,6) not null default 0,
  add column if not exists usage_payload jsonb not null default '{}'::jsonb;

alter table public.generation_jobs
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists input_text_tokens bigint not null default 0,
  add column if not exists input_image_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists total_tokens bigint not null default 0;

alter table public.ai_runs
  add column if not exists provider_request_id text not null default '',
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists input_text_tokens bigint not null default 0,
  add column if not exists input_image_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists total_tokens bigint not null default 0,
  add column if not exists usage_payload jsonb not null default '{}'::jsonb;

alter table public.planning_requests
  add column if not exists analysis_status text not null default 'pending',
  add column if not exists analysis_fingerprint text not null default '',
  add column if not exists analysis_updated_at timestamptz,
  add column if not exists pose_plan jsonb not null default '[]'::jsonb;

create index if not exists planning_requests_catalog_preflight_idx
  on public.planning_requests (batch_id, analysis_status, queue_position)
  where front_image_url is not null and back_image_url is not null;

create index if not exists session_generations_provider_request_idx
  on public.session_generations (provider_request_id)
  where provider_request_id <> '';

-- Safety-net preflight poll. Uploads also dispatch immediately, while this cron
-- recovers browser closures or transient Edge delivery failures.
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'ai-studio-catalog-preflight' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

select cron.schedule(
  'ai-studio-catalog-preflight',
  '*/2 * * * *',
  $$select private.dispatch_app_worker('catalog.preflight')$$
);
