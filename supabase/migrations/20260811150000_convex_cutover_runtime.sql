-- Complete Convex -> Supabase runtime cutover.
-- Firebase Auth remains the identity authority and Firebase Storage remains the
-- media authority. Supabase owns application data, queue state, schedules,
-- analysis memory, QA, and audit history.

create extension if not exists pgcrypto;

-- Preserve every migrated Convex business document verbatim and record its
-- canonical Supabase destination. Convex auth/session/password rows are
-- intentionally excluded from the import because Firebase is authoritative.
create table if not exists public.app_migration_archive (
  source_system text not null default 'convex',
  source_table text not null,
  source_id text not null,
  payload jsonb not null,
  destination_table text,
  destination_id text,
  migrated_at timestamptz not null default now(),
  primary key (source_system, source_table, source_id)
);

revoke all on public.app_migration_archive from anon, authenticated;
grant all on public.app_migration_archive to service_role;
alter table public.app_migration_archive enable row level security;

-- Existing session-operation tables are retained and enriched instead of
-- creating a parallel business schema.
alter table public.catalog_sessions
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists planning_request_id uuid references public.planning_requests(id) on delete set null,
  add column if not exists status text not null default 'ready',
  add column if not exists analysis_fingerprint text not null default '',
  add column if not exists product_hash text not null default '',
  add column if not exists reference_hash text not null default '',
  add column if not exists legacy_convex_id text;

create unique index if not exists catalog_sessions_legacy_convex_id_idx
  on public.catalog_sessions (legacy_convex_id)
  where legacy_convex_id is not null;
create index if not exists catalog_sessions_organization_updated_idx
  on public.catalog_sessions (organization_id, updated_at desc);
create index if not exists catalog_sessions_planning_request_idx
  on public.catalog_sessions (planning_request_id)
  where planning_request_id is not null;

alter table public.generation_jobs
  add column if not exists planning_request_id uuid references public.planning_requests(id) on delete set null,
  add column if not exists batch_id uuid references public.planning_batches(id) on delete set null,
  add column if not exists total_poses integer not null default 5,
  add column if not exists completed_poses integer not null default 0,
  add column if not exists failed_poses integer not null default 0,
  add column if not exists current_pose integer,
  add column if not exists provider text not null default 'openai',
  add column if not exists model text not null default 'gpt-image-2',
  add column if not exists aspect_ratio text not null default '3:4',
  add column if not exists image_size text not null default '2K',
  add column if not exists quality text not null default 'medium',
  add column if not exists pose_qa boolean not null default true,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists locked_at timestamptz,
  add column if not exists lock_expires_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists error_code text not null default '',
  add column if not exists error_message text not null default '',
  add column if not exists estimated_cost_usd numeric(12,6) not null default 0,
  add column if not exists actual_cost_usd numeric(12,6) not null default 0,
  add column if not exists legacy_convex_id text;

create unique index if not exists generation_jobs_legacy_convex_id_idx
  on public.generation_jobs (legacy_convex_id)
  where legacy_convex_id is not null;
create index if not exists generation_jobs_org_created_idx
  on public.generation_jobs (org_id, created_at desc);
create index if not exists generation_jobs_queue_idx
  on public.generation_jobs (created_at, job_id)
  where status = 'queued';
create index if not exists generation_jobs_processing_lease_idx
  on public.generation_jobs (lock_expires_at)
  where status in ('processing', 'cancelling');
create index if not exists generation_jobs_planning_request_idx
  on public.generation_jobs (planning_request_id)
  where planning_request_id is not null;

alter table public.session_generations
  add column if not exists title text not null default '',
  add column if not exists pose_type text not null default '',
  add column if not exists instructions text not null default '',
  add column if not exists full_prompt text not null default '',
  add column if not exists status text not null default 'queued',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists output_url text not null default '',
  add column if not exists storage_path text not null default '',
  add column if not exists qa_status text not null default 'pending',
  add column if not exists qa_payload jsonb not null default '{}'::jsonb,
  add column if not exists error text not null default '',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists legacy_convex_id text;

create unique index if not exists session_generations_legacy_convex_id_idx
  on public.session_generations (legacy_convex_id)
  where legacy_convex_id is not null;
create index if not exists session_generations_status_idx
  on public.session_generations (session_id, status, pose_index);

-- Add traceable Convex IDs to reused canonical tables. Natural-key upserts avoid
-- duplicating the existing organization, RBAC, event, and planning rows.
alter table public.organizations add column if not exists legacy_convex_id text;
alter table public.organization_members add column if not exists legacy_convex_id text;
alter table public.roles add column if not exists legacy_convex_id text;
alter table public.permissions add column if not exists legacy_convex_id text;
alter table public.planning_batches add column if not exists legacy_convex_id text;
alter table public.planning_requests add column if not exists legacy_convex_id text;
alter table public.planning_assets add column if not exists legacy_convex_id text;
alter table public.analysis_cache add column if not exists legacy_convex_id text;
alter table public.marketing_events add column if not exists legacy_convex_id text;
alter table public.notifications add column if not exists legacy_convex_id text;
alter table public.audit_logs add column if not exists legacy_convex_id text;

create unique index if not exists organizations_legacy_convex_id_idx on public.organizations (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists organization_members_legacy_convex_id_idx on public.organization_members (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists roles_legacy_convex_id_idx on public.roles (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists permissions_legacy_convex_id_idx on public.permissions (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists planning_batches_legacy_convex_id_idx on public.planning_batches (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists planning_requests_legacy_convex_id_idx on public.planning_requests (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists planning_assets_legacy_convex_id_idx on public.planning_assets (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists analysis_cache_legacy_convex_id_idx on public.analysis_cache (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists marketing_events_legacy_convex_id_idx on public.marketing_events (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists notifications_legacy_convex_id_idx on public.notifications (legacy_convex_id) where legacy_convex_id is not null;
create unique index if not exists audit_logs_legacy_convex_id_idx on public.audit_logs (legacy_convex_id) where legacy_convex_id is not null;

alter table public.planning_batches
  add column if not exists generation_settings jsonb not null default '{}'::jsonb;

-- Firebase-aware workspace bootstrap. The browser receives only its current
-- organization/member/RBAC bundle and never uses a service key.
create or replace function public.app_current_workspace()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  with current_member as (
    select member.*
    from public.organization_members as member
    where member.id = private.current_member_id()
      and member.status = 'active'
    limit 1
  ), current_roles as (
    select role.*
    from public.member_roles as member_role
    join public.roles as role on role.id = member_role.role_id
    where member_role.member_id = (select id from current_member)
  ), current_permissions as (
    select distinct permission.key
    from public.member_roles as member_role
    join public.role_permissions as role_permission on role_permission.role_id = member_role.role_id
    join public.permissions as permission on permission.id = role_permission.permission_id
    where member_role.member_id = (select id from current_member)
  )
  select case when not exists (select 1 from current_member) then null else jsonb_build_object(
    'organization', (select to_jsonb(organization) from public.organizations as organization where organization.id = (select organization_id from current_member)),
    'member', (select to_jsonb(member) from current_member as member),
    'user', jsonb_build_object(
      'id', (select id from current_member),
      'firebaseUid', (select firebase_uid from current_member),
      'email', (select email from current_member),
      'name', (select display_name from current_member)
    ),
    'roles', coalesce((select jsonb_agg(to_jsonb(role) order by role.name) from current_roles as role), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(permission.key order by permission.key) from current_permissions as permission), '[]'::jsonb),
    'isAdmin', exists (select 1 from current_roles where slug = 'admin')
  ) end;
$$;

revoke all on function public.app_current_workspace() from public, anon;
grant execute on function public.app_current_workspace() to authenticated, service_role;

-- Atomic global single-worker claim. External API calls happen after this short
-- transaction, never while database locks are held.
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
  order by job.created_at, job.job_id
  for update skip locked
  limit 1;

  if selected_job_id is null then return; end if;

  return query
  update public.generation_jobs as job
  set status = 'processing',
      locked_at = now(),
      lock_expires_at = now() + interval '12 minutes',
      started_at = coalesce(job.started_at, now()),
      attempt_count = job.attempt_count + 1,
      updated_at = now(),
      error_code = '',
      error_message = ''
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
declare recovered integer;
begin
  with recovered_jobs as (
    update public.generation_jobs
    set status = case
          when status = 'cancelling' then 'cancelled'
          when attempt_count < 3 then 'queued'
          else 'failed'
        end,
        error_code = case when status = 'processing' and attempt_count >= 3 then 'worker_lease_expired' else error_code end,
        error_message = case when status = 'processing' and attempt_count >= 3 then 'Generation worker lease expired after maximum retries.' else error_message end,
        lock_expires_at = null,
        locked_at = null,
        completed_at = case when status = 'cancelling' or attempt_count >= 3 then now() else completed_at end,
        updated_at = now()
    where status in ('processing', 'cancelling')
      and lock_expires_at < now()
    returning 1
  )
  select count(*) into recovered from recovered_jobs;
  return recovered;
end;
$$;

create or replace function public.claim_due_catalog_batch()
returns setof public.planning_batches
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare selected_batch_id uuid;
begin
  select batch.id into selected_batch_id
  from public.planning_batches as batch
  where batch.schedule_status = 'scheduled'
    and batch.scheduled_at <= now()
  order by batch.scheduled_at, batch.id
  for update skip locked
  limit 1;

  if selected_batch_id is null then return; end if;

  return query
  update public.planning_batches as batch
  set schedule_status = 'running',
      schedule_started_at = now(),
      queue_status = 'running',
      updated_at = now(),
      schedule_error = ''
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

-- Existing owner/org policies continue to protect these tables. Expose only
-- read access needed by the authenticated UI; writes go through the Edge API.
grant select on public.catalog_sessions, public.session_generations, public.generation_jobs to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_generations'
  ) then
    alter publication supabase_realtime add table public.session_generations;
  end if;
end;
$$;

