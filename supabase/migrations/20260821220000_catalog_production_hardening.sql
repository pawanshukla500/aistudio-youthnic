-- Harden Catalog Production and connect it to every generation entry point.
-- The Supabase CLI generated this migration at 20260821160009, but the
-- repository already contains local-time migrations through 20260821210300,
-- so it is ordered after those dependencies before being committed.

create unique index if not exists catalog_work_items_org_planning_request_uidx
  on public.catalog_work_items (organization_id, planning_request_id)
  where planning_request_id is not null;

create unique index if not exists catalog_external_source_request_uidx
  on public.catalog_work_item_external_sources (
    external_source,
    coalesce(external_file_id, ''),
    external_request_id
  )
  where external_request_id is not null;

create index if not exists catalog_work_items_active_queue_idx
  on public.catalog_work_items (organization_id, status, priority, created_at desc);

create index if not exists catalog_work_items_generation_completed_idx
  on public.catalog_work_items (organization_id, generation_completed_at)
  where generation_completed_at is not null;

create table if not exists public.catalog_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_date date not null,
  recipients text[] not null default '{}'::text[],
  subject text not null default '',
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text not null default '',
  error_message text not null default '',
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, report_date)
);

create index if not exists catalog_report_deliveries_org_date_idx
  on public.catalog_report_deliveries (organization_id, report_date desc);

alter table public.catalog_report_deliveries enable row level security;

revoke all on table
  public.catalog_work_items,
  public.catalog_work_item_events,
  public.catalog_work_item_external_sources,
  public.catalog_report_deliveries
from anon;

revoke insert, update, delete on table
  public.catalog_work_items,
  public.catalog_work_item_events,
  public.catalog_work_item_external_sources,
  public.catalog_report_deliveries
from authenticated;

grant select on table
  public.catalog_work_items,
  public.catalog_work_item_events,
  public.catalog_work_item_external_sources,
  public.catalog_report_deliveries
to authenticated;

grant all on table
  public.catalog_work_items,
  public.catalog_work_item_events,
  public.catalog_work_item_external_sources,
  public.catalog_report_deliveries
to service_role;

drop policy if exists catalog_work_items_select on public.catalog_work_items;
create policy catalog_work_items_select on public.catalog_work_items
for select to authenticated
using (organization_id = (select private.current_organization_id()));

drop policy if exists catalog_work_items_insert on public.catalog_work_items;
drop policy if exists catalog_work_items_update on public.catalog_work_items;
drop policy if exists catalog_work_items_delete on public.catalog_work_items;

drop policy if exists catalog_work_item_events_select on public.catalog_work_item_events;
create policy catalog_work_item_events_select on public.catalog_work_item_events
for select to authenticated
using (organization_id = (select private.current_organization_id()));

drop policy if exists catalog_work_item_events_insert on public.catalog_work_item_events;

drop policy if exists cwies_select on public.catalog_work_item_external_sources;
create policy cwies_select on public.catalog_work_item_external_sources
for select to authenticated
using (exists (
  select 1
  from public.catalog_work_items as work_item
  where work_item.id = catalog_work_item_external_sources.work_item_id
    and work_item.organization_id = (select private.current_organization_id())
));

drop policy if exists catalog_report_deliveries_select on public.catalog_report_deliveries;
create policy catalog_report_deliveries_select on public.catalog_report_deliveries
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (
    (select private.has_permission('reports.view'))
    or (select private.has_permission('planning.view'))
  )
);

drop trigger if exists catalog_work_item_status_audit on public.catalog_work_items;
drop trigger if exists sync_catalog_generation_status_trigger on public.generation_jobs;
drop function if exists public.catalog_work_item_status_trigger();
drop function if exists public.sync_catalog_generation_status();

create or replace function private.normalize_catalog_work_item_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  new.updated_at := now();

  if new.generation_status in ('queued', 'generating')
     and old.generation_status is distinct from new.generation_status then
    new.generation_started_at := coalesce(new.generation_started_at, now());
    if new.status <> 'blocked' then new.status := 'in_progress'; end if;
  end if;

  if new.generation_status = 'completed'
     and old.generation_status is distinct from 'completed' then
    new.generation_started_at := coalesce(new.generation_started_at, old.generation_started_at, now());
    new.generation_completed_at := coalesce(new.generation_completed_at, now());
    if new.qc_status in ('not_started', 'pending') then new.qc_status := 'needs_review'; end if;
    if new.listing_status not in ('completed', 'not_required') then new.listing_status := 'pending'; end if;
    if new.listing_status = 'not_required' then new.listing_status := 'pending'; end if;
    if new.status <> 'blocked' then new.status := 'in_progress'; end if;
  end if;

  if new.generation_status = 'failed'
     and old.generation_status is distinct from 'failed' then
    new.status := 'blocked';
  end if;

  if new.qc_status = 'passed' and old.qc_status is distinct from 'passed' then
    if new.generation_status <> 'completed' then
      raise exception 'QC cannot pass before generation is completed';
    end if;
    new.listing_status := case when new.listing_status = 'completed' then 'completed' else 'pending' end;
    new.listing_started_at := coalesce(new.listing_started_at, now());
    if new.status <> 'blocked' then new.status := 'in_progress'; end if;
  end if;

  if new.listing_status = 'completed'
     and old.listing_status is distinct from 'completed' then
    if new.generation_status <> 'completed' or new.qc_status <> 'passed' then
      raise exception 'Listing cannot complete until generation is complete and QC has passed';
    end if;
    new.listing_started_at := coalesce(new.listing_started_at, old.listing_started_at, now());
    new.listing_completed_at := coalesce(new.listing_completed_at, now());
    new.completed_at := coalesce(new.completed_at, new.listing_completed_at, now());
    new.status := 'completed';
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_catalog_work_item_state() from public, anon, authenticated;
grant execute on function private.normalize_catalog_work_item_state() to service_role, postgres;

create trigger catalog_work_item_normalize_state
before update on public.catalog_work_items
for each row execute function private.normalize_catalog_work_item_state();

create or replace function private.audit_catalog_work_item_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if old.generation_status is distinct from new.generation_status then
    insert into public.catalog_work_item_events
      (organization_id, work_item_id, event_type, from_status, to_status, actor_member_id, source)
    values
      (new.organization_id, new.id, 'generation_status_changed', old.generation_status, new.generation_status, private.current_member_id(), 'system');
  end if;
  if old.qc_status is distinct from new.qc_status then
    insert into public.catalog_work_item_events
      (organization_id, work_item_id, event_type, from_status, to_status, actor_member_id, source)
    values
      (new.organization_id, new.id, 'qc_status_changed', old.qc_status, new.qc_status, private.current_member_id(), 'system');
  end if;
  if old.listing_status is distinct from new.listing_status then
    insert into public.catalog_work_item_events
      (organization_id, work_item_id, event_type, from_status, to_status, actor_member_id, source)
    values
      (new.organization_id, new.id, 'listing_status_changed', old.listing_status, new.listing_status, private.current_member_id(), 'system');
  end if;
  if old.status is distinct from new.status then
    insert into public.catalog_work_item_events
      (organization_id, work_item_id, event_type, from_status, to_status, actor_member_id, source)
    values
      (new.organization_id, new.id, 'status_changed', old.status, new.status, private.current_member_id(), 'system');
  end if;
  return new;
end;
$$;

revoke all on function private.audit_catalog_work_item_status() from public, anon, authenticated;
grant execute on function private.audit_catalog_work_item_status() to service_role, postgres;

create trigger catalog_work_item_status_audit
after update on public.catalog_work_items
for each row execute function private.audit_catalog_work_item_status();

create or replace function private.sync_catalog_from_planning_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  mapped_generation_status text;
  mapped_status text;
begin
  if new.generation_status is null
     or new.generation_status in ('', 'not_required') then
    return new;
  end if;

  mapped_generation_status := case
    when new.generation_status = 'processing' then 'generating'
    when new.generation_status in ('completed', 'failed', 'queued', 'ready') then new.generation_status
    when new.generation_status in ('cancelled', 'cancelling') then 'failed'
    else 'ready'
  end;
  mapped_status := case when mapped_generation_status = 'failed' then 'blocked' else 'in_progress' end;

  insert into public.catalog_work_items (
    organization_id, request_code, request_date, sku_name, color_label,
    work_type, work_mode, priority, status, generation_status, qc_status,
    listing_status, planning_request_id, planning_batch_id, generation_job_id,
    created_by_member_id, generation_started_at, generation_completed_at
  ) values (
    new.organization_id, new.request_code, new.created_at, new.sku_name, new.color_label,
    new.photoshoot_type, 'ai', 'normal', mapped_status, mapped_generation_status,
    case when mapped_generation_status = 'completed' then 'needs_review' else 'not_started' end,
    case when mapped_generation_status = 'completed' then 'pending' else 'not_required' end,
    new.id, new.batch_id, new.generation_job_id, new.created_by_member_id,
    case when mapped_generation_status in ('queued', 'generating', 'completed') then coalesce(new.generation_started_at, new.queued_at) end,
    case when mapped_generation_status = 'completed' then coalesce(new.generation_finished_at, now()) end
  )
  on conflict (organization_id, planning_request_id) where planning_request_id is not null
  do update set
    sku_name = excluded.sku_name,
    color_label = excluded.color_label,
    planning_batch_id = excluded.planning_batch_id,
    generation_job_id = coalesce(excluded.generation_job_id, catalog_work_items.generation_job_id),
    generation_status = excluded.generation_status,
    generation_started_at = coalesce(catalog_work_items.generation_started_at, excluded.generation_started_at),
    generation_completed_at = coalesce(excluded.generation_completed_at, catalog_work_items.generation_completed_at),
    qc_status = case
      when excluded.generation_status = 'completed' and catalog_work_items.qc_status in ('not_started', 'pending') then 'needs_review'
      else catalog_work_items.qc_status
    end,
    listing_status = case
      when excluded.generation_status = 'completed' and catalog_work_items.listing_status <> 'completed' then 'pending'
      else catalog_work_items.listing_status
    end,
    status = case when catalog_work_items.status = 'completed' then 'completed' else excluded.status end,
    updated_at = now();

  return new;
end;
$$;

revoke all on function private.sync_catalog_from_planning_request() from public, anon, authenticated;
grant execute on function private.sync_catalog_from_planning_request() to service_role, postgres;

create trigger planning_request_sync_catalog_work_item
after insert or update of generation_status, generation_job_id, generation_started_at, generation_finished_at
on public.planning_requests
for each row execute function private.sync_catalog_from_planning_request();

create or replace function private.sync_catalog_from_generation_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  mapped_status text;
begin
  if new.planning_request_id is null then return new; end if;

  mapped_status := case
    when new.status = 'processing' then 'generating'
    when new.status in ('queued', 'completed', 'failed') then new.status
    when new.status in ('cancelled', 'cancelling') then 'failed'
    else 'ready'
  end;

  update public.catalog_work_items
  set generation_job_id = new.job_id,
      catalog_session_id = new.session_id,
      generation_status = mapped_status,
      generation_started_at = coalesce(generation_started_at, new.started_at,
        case when mapped_status in ('generating', 'completed') then now() end),
      generation_completed_at = case
        when mapped_status = 'completed' then coalesce(new.completed_at, generation_completed_at, now())
        else generation_completed_at
      end,
      qc_status = case
        when mapped_status = 'completed' and qc_status in ('not_started', 'pending') then 'needs_review'
        else qc_status
      end,
      listing_status = case
        when mapped_status = 'completed' and listing_status <> 'completed' then 'pending'
        else listing_status
      end
  where organization_id = (select request.organization_id from public.planning_requests as request where request.id = new.planning_request_id)
    and planning_request_id = new.planning_request_id;

  if not found then
    insert into public.catalog_work_items (
      organization_id, request_code, request_date, sku_name, color_label,
      work_type, work_mode, priority, status, generation_status, qc_status,
      listing_status, planning_request_id, planning_batch_id, generation_job_id,
      catalog_session_id, created_by_member_id, generation_started_at,
      generation_completed_at
    )
    select
      request.organization_id, request.request_code, request.created_at,
      request.sku_name, request.color_label, request.photoshoot_type, 'ai',
      'normal', case when mapped_status = 'failed' then 'blocked' else 'in_progress' end,
      mapped_status,
      case when mapped_status = 'completed' then 'needs_review' else 'not_started' end,
      case when mapped_status = 'completed' then 'pending' else 'not_required' end,
      request.id, request.batch_id, new.job_id, new.session_id,
      request.created_by_member_id,
      coalesce(new.started_at, case when mapped_status in ('generating', 'completed') then now() end),
      case when mapped_status = 'completed' then coalesce(new.completed_at, now()) end
    from public.planning_requests as request
    where request.id = new.planning_request_id
    on conflict (organization_id, planning_request_id) where planning_request_id is not null
    do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_catalog_from_generation_job() from public, anon, authenticated;
grant execute on function private.sync_catalog_from_generation_job() to service_role, postgres;

create trigger sync_catalog_generation_status_trigger
after insert or update of status, planning_request_id, started_at, completed_at
on public.generation_jobs
for each row execute function private.sync_catalog_from_generation_job();

create or replace function private.sync_catalog_from_session()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  mapped_status text;
begin
  if new.planning_request_id is null then return new; end if;

  mapped_status := case
    when new.status = 'generating' then 'generating'
    when new.status in ('completed', 'needs_review') then 'completed'
    when new.status = 'failed' then 'failed'
    else 'ready'
  end;

  update public.catalog_work_items
  set catalog_session_id = new.session_id,
      generation_status = mapped_status,
      generation_started_at = coalesce(generation_started_at,
        case when mapped_status in ('generating', 'completed') then new.updated_at end,
        case when mapped_status in ('generating', 'completed') then now() end),
      generation_completed_at = case
        when mapped_status = 'completed' then coalesce(generation_completed_at, new.updated_at, now())
        else generation_completed_at
      end,
      qc_status = case
        when mapped_status = 'completed' and qc_status in ('not_started', 'pending') then 'needs_review'
        else qc_status
      end,
      listing_status = case
        when mapped_status = 'completed' and listing_status <> 'completed' then 'pending'
        else listing_status
      end
  where organization_id = new.organization_id
    and planning_request_id = new.planning_request_id;

  return new;
end;
$$;

revoke all on function private.sync_catalog_from_session() from public, anon, authenticated;
grant execute on function private.sync_catalog_from_session() to service_role, postgres;

create trigger catalog_session_sync_catalog_work_item
after insert or update of status, planning_request_id, updated_at
on public.catalog_sessions
for each row execute function private.sync_catalog_from_session();

-- Backfill current work so generation completed before this migration is not
-- left outside the production queue.
insert into public.catalog_work_items (
  organization_id, request_code, request_date, sku_name, color_label,
  work_type, work_mode, priority, status, generation_status, qc_status,
  listing_status, planning_request_id, planning_batch_id, generation_job_id,
  catalog_session_id, created_by_member_id, generation_started_at,
  generation_completed_at
)
select
  request.organization_id, request.request_code, request.created_at, request.sku_name,
  request.color_label, request.photoshoot_type, 'ai', 'normal',
  case when request.generation_status in ('failed', 'cancelled') then 'blocked' else 'in_progress' end,
  case
    when request.generation_status = 'processing' then 'generating'
    when request.generation_status in ('completed', 'failed', 'queued', 'ready') then request.generation_status
    when request.generation_status in ('cancelled', 'cancelling') then 'failed'
    else 'ready'
  end,
  case when request.generation_status = 'completed' then 'needs_review' else 'not_started' end,
  case when request.generation_status = 'completed' then 'pending' else 'not_required' end,
  request.id, request.batch_id, request.generation_job_id, session.session_id,
  request.created_by_member_id, request.generation_started_at, request.generation_finished_at
from public.planning_requests as request
left join lateral (
  select catalog_session.session_id
  from public.catalog_sessions as catalog_session
  where catalog_session.planning_request_id = request.id
  order by catalog_session.updated_at desc
  limit 1
) as session on true
where request.generation_status not in ('', 'not_required')
on conflict (organization_id, planning_request_id) where planning_request_id is not null
do update set
  generation_job_id = coalesce(excluded.generation_job_id, catalog_work_items.generation_job_id),
  catalog_session_id = coalesce(excluded.catalog_session_id, catalog_work_items.catalog_session_id),
  generation_started_at = coalesce(catalog_work_items.generation_started_at, excluded.generation_started_at),
  generation_completed_at = coalesce(catalog_work_items.generation_completed_at, excluded.generation_completed_at);

do $$
declare existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'ai-studio-catalog-production-report'
  limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

-- Four daily attempts give mail delivery automatic recovery. The Edge worker
-- uses organization timezones and the unique report date to avoid duplicates.
select cron.schedule(
  'ai-studio-catalog-production-report',
  '20 2,8,14,20 * * *',
  $$select private.dispatch_app_worker('catalogProduction.automation')$$
);
