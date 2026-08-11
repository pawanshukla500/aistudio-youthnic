-- Keep each hosted Edge invocation to one OpenAI image attempt. This preserves
-- enough of the Free-plan wall-clock budget for Gemini QA, Firebase upload, and
-- database commits while respecting GPT Image 2 Tier 1 throughput.

alter table public.generation_jobs
  add column if not exists available_at timestamptz not null default now();

create index if not exists generation_jobs_claimable_idx
  on public.generation_jobs (status, available_at, created_at);

create or replace function public.claim_next_generation_job()
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_job_id text;
begin
  if exists (
    select 1 from public.generation_jobs
    where status in ('processing', 'cancelling')
      and coalesce(lock_expires_at, now() + interval '1 minute') > now()
  ) then
    return;
  end if;

  select job.job_id into selected_job_id
  from public.generation_jobs as job
  where job.status = 'queued'
    and coalesce(job.available_at, now()) <= now()
  order by job.available_at, job.created_at, job.job_id
  for update skip locked
  limit 1;

  if selected_job_id is null then return; end if;

  return query
  update public.generation_jobs as job
  set status = 'processing',
      locked_at = now(),
      lock_expires_at = now() + interval '4 minutes',
      started_at = coalesce(job.started_at, now()),
      attempt_count = job.attempt_count + 1,
      updated_at = now()
  where job.job_id = selected_job_id
  returning job.*;
end;
$$;

create or replace function public.recover_stale_generation_jobs()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  recovered integer := 0;
  stale_job record;
  next_status text;
  recovery_message text;
begin
  for stale_job in
    select job_id, session_id, planning_request_id, batch_id, status, attempt_count
    from public.generation_jobs
    where status in ('processing', 'cancelling')
      and lock_expires_at < now()
    order by lock_expires_at
    for update skip locked
  loop
    next_status := case
      when stale_job.status = 'cancelling' then 'cancelled'
      when stale_job.attempt_count < 3 then 'queued'
      else 'failed'
    end;
    recovery_message := case
      when next_status = 'queued' then 'The previous worker reached its runtime limit. The same pose was safely requeued.'
      when next_status = 'cancelled' then 'Generation cancellation completed after the worker lease expired.'
      else 'Generation worker lease expired after maximum recovery attempts.'
    end;

    update public.generation_jobs
    set status = next_status,
        available_at = case when next_status = 'queued' then now() + interval '15 seconds' else available_at end,
        error_code = case when next_status = 'queued' then 'worker_requeued' when next_status = 'cancelled' then 'cancelled' else 'worker_lease_expired' end,
        error_message = recovery_message,
        lock_expires_at = null,
        locked_at = null,
        completed_at = case when next_status in ('cancelled', 'failed') then now() else completed_at end,
        updated_at = now()
    where job_id = stale_job.job_id;

    if next_status = 'queued' then
      update public.session_generations
      set status = 'queued', qa_status = 'pending', error = recovery_message, updated_at = now()
      where session_id = stale_job.session_id and status = 'processing';

      update public.catalog_sessions set status = 'generating', updated_at = now()
      where session_id = stale_job.session_id;

      update public.planning_requests
      set status = 'generating', generation_status = 'queued', error_message = recovery_message, updated_at = now()
      where id = stale_job.planning_request_id;
    else
      update public.session_generations
      set status = 'failed', qa_status = 'failed', error = recovery_message, updated_at = now()
      where session_id = stale_job.session_id and status in ('queued', 'processing');

      update public.catalog_sessions set status = 'needs_review', updated_at = now()
      where session_id = stale_job.session_id;

      update public.planning_requests
      set status = 'failed', generation_status = 'failed', completion_status = 'failed',
          error_message = recovery_message, generation_finished_at = now(), updated_at = now()
      where id = stale_job.planning_request_id;
    end if;

    recovered := recovered + 1;
  end loop;
  return recovered;
end;
$$;

-- Running batches must be polled as well as newly due batches. This makes the
-- cron schedule a durable safety net when an HTTP/background chain is retired.
create or replace function public.claim_due_catalog_batch()
returns setof public.planning_batches
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_batch_id uuid;
begin
  select batch.id into selected_batch_id
  from public.planning_batches as batch
  where (
      batch.schedule_status = 'scheduled'
      and batch.scheduled_at <= now()
    ) or (
      batch.schedule_status = 'running'
      and batch.queue_status = 'running'
    )
  order by coalesce(batch.schedule_started_at, batch.scheduled_at), batch.id
  for update skip locked
  limit 1;

  if selected_batch_id is null then return; end if;

  return query
  update public.planning_batches as batch
  set schedule_status = 'running',
      schedule_started_at = coalesce(batch.schedule_started_at, now()),
      queue_status = 'running',
      updated_at = now()
  where batch.id = selected_batch_id
  returning batch.*;
end;
$$;

revoke all on function public.claim_next_generation_job() from public, anon, authenticated;
revoke all on function public.recover_stale_generation_jobs() from public, anon, authenticated;
revoke all on function public.claim_due_catalog_batch() from public, anon, authenticated;
grant execute on function public.claim_next_generation_job() to service_role;
grant execute on function public.recover_stale_generation_jobs() to service_role;
grant execute on function public.claim_due_catalog_batch() to service_role;
