-- Organization-scoped event automation, authoritative OpenAI organization
-- usage snapshots, regeneration guidance, and readiness metadata.

create table if not exists public.event_automation_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  monthly_report_enabled boolean not null default true,
  monthly_report_day smallint not null default 1 check (monthly_report_day between 1 and 28),
  reminder_enabled boolean not null default true,
  reminder_days_before smallint not null default 30 check (reminder_days_before between 1 and 180),
  research_enabled boolean not null default true,
  state_filters text[] not null default array['Pan-India', 'All Indian states and union territories']::text[],
  report_recipients text[] not null default '{}'::text[],
  timezone text not null default 'Asia/Kolkata',
  last_automation_at timestamptz,
  last_monthly_report_at timestamptz,
  last_usage_sync_at timestamptz,
  updated_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

create index if not exists event_automation_settings_updated_by_idx
  on public.event_automation_settings (updated_by_member_id)
  where updated_by_member_id is not null;

create table if not exists public.event_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid references public.marketing_events(id) on delete set null,
  delivery_kind text not null check (delivery_kind in ('monthly_report', 'event_reminder', 'manual_digest')),
  delivery_key text not null,
  recipients text[] not null default '{}'::text[],
  subject text not null default '',
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text not null default '',
  error_message text not null default '',
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, delivery_kind, delivery_key)
);

create index if not exists event_email_deliveries_org_created_idx
  on public.event_email_deliveries (organization_id, created_at desc);
create index if not exists event_email_deliveries_event_idx
  on public.event_email_deliveries (event_id)
  where event_id is not null;

create table if not exists public.openai_usage_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  usage_date date not null,
  dimension_key text not null,
  model text not null default 'unknown',
  image_size text not null default 'unknown',
  source text not null default 'unknown',
  openai_project_id text not null default '',
  image_count integer not null default 0 check (image_count >= 0),
  request_count integer not null default 0 check (request_count >= 0),
  actual_cost_usd numeric(14,6) not null default 0 check (actual_cost_usd >= 0),
  currency text not null default 'usd',
  usage_payload jsonb not null default '{}'::jsonb,
  cost_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (organization_id, usage_date, dimension_key)
);

create index if not exists openai_usage_daily_org_date_idx
  on public.openai_usage_daily (organization_id, usage_date desc);

alter table public.session_generations
  add column if not exists regeneration_instructions text not null default '',
  add column if not exists regeneration_history jsonb not null default '[]'::jsonb;

alter table public.generation_jobs
  add column if not exists readiness_status text not null default 'pending',
  add column if not exists readiness_reasons jsonb not null default '[]'::jsonb;

alter table public.event_automation_settings enable row level security;
alter table public.event_email_deliveries enable row level security;
alter table public.openai_usage_daily enable row level security;

drop policy if exists event_automation_settings_select_current_org on public.event_automation_settings;
create policy event_automation_settings_select_current_org on public.event_automation_settings
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('admin.settings'))
);

drop policy if exists event_email_deliveries_select_current_org on public.event_email_deliveries;
create policy event_email_deliveries_select_current_org on public.event_email_deliveries
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('admin.settings'))
);

drop policy if exists openai_usage_daily_select_current_org on public.openai_usage_daily;
create policy openai_usage_daily_select_current_org on public.openai_usage_daily
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('reports.view'))
);

revoke all on public.event_automation_settings, public.event_email_deliveries, public.openai_usage_daily from anon;
revoke insert, update, delete on public.event_automation_settings, public.event_email_deliveries, public.openai_usage_daily from authenticated;
grant select on public.event_automation_settings, public.event_email_deliveries, public.openai_usage_daily to authenticated;
grant all on public.event_automation_settings, public.event_email_deliveries, public.openai_usage_daily to service_role;

insert into public.event_automation_settings (organization_id, report_recipients)
select organization.id,
       coalesce(array_agg(member.email order by member.email) filter (where role.slug = 'admin' and member.status = 'active'), '{}'::text[])
from public.organizations as organization
left join public.organization_members as member on member.organization_id = organization.id
left join public.member_roles as member_role on member_role.member_id = member.id
left join public.roles as role on role.id = member_role.role_id
group by organization.id
on conflict (organization_id) do nothing;

create or replace function private.initialize_event_automation_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.event_automation_settings (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

revoke all on function private.initialize_event_automation_settings() from public, anon, authenticated;
grant execute on function private.initialize_event_automation_settings() to service_role, postgres;

drop trigger if exists organizations_initialize_event_automation on public.organizations;
create trigger organizations_initialize_event_automation
after insert on public.organizations
for each row execute function private.initialize_event_automation_settings();

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'ai-studio-event-automation' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  select jobid into existing_job from cron.job where jobname = 'ai-studio-openai-usage-sync' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

-- Four bounded attempts per day provide automatic recovery from a transient
-- mail/provider failure. Idempotency keys prevent duplicate delivery.
select cron.schedule(
  'ai-studio-event-automation',
  '35 0,6,12,18 * * *',
  $$select private.dispatch_app_worker('events.automation')$$
);

-- Organization usage data is delayed and aggregated by OpenAI. Hourly syncs
-- provide current dashboard totals without touching the generation queue.
select cron.schedule(
  'ai-studio-openai-usage-sync',
  '10 * * * *',
  $$select private.dispatch_app_worker('usage.sync')$$
);
