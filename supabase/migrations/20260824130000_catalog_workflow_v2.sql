-- Catalog Workflow V2 is additive. Existing Planning, generation, QA, and
-- Firebase-backed assets remain valid while the operational workflow gains
-- immutable history, five-pose versions, approval handoffs, and live delivery
-- administration.

create table if not exists public.catalog_workflow_stage_definitions (
  code text primary key,
  group_key text not null,
  title text not null,
  description text not null default '',
  stage_order smallint not null unique,
  progress_percent smallint not null check (progress_percent between 0 and 100),
  default_next_action text not null default '',
  terminal boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.catalog_workflow_stage_definitions
  (code, group_key, title, description, stage_order, progress_percent, default_next_action, terminal)
values
  ('requirement_created', 'intake', 'Requirement created', 'The SKU requirement exists and is ready for production setup.', 10, 5, 'Add references and production details', false),
  ('reference_assets_pending', 'intake', 'Reference assets pending', 'Required product or creative references are incomplete.', 20, 12, 'Upload front and back references', false),
  ('planning', 'preparation', 'Planning', 'Creative direction, ownership, and pose plan are being prepared.', 30, 22, 'Complete and approve the creative plan', false),
  ('ready_for_generation', 'preparation', 'Ready for generation', 'References and planning checks are complete.', 40, 32, 'Start or schedule generation', false),
  ('generation_in_progress', 'generation', 'Generation in progress', 'The five-pose generation job is queued or running.', 50, 52, 'Monitor the current pose', false),
  ('quality_review', 'review', 'Quality review', 'All required outputs are ready for human review.', 60, 68, 'Approve or reject the five-pose set', false),
  ('regeneration_required', 'review', 'Re-generation required', 'Review failed and one or more assets must be regenerated.', 70, 58, 'Retry generation with reviewer guidance', false),
  ('approved', 'review', 'Approved', 'Human quality review passed.', 80, 78, 'Prepare the Listing Team handoff', false),
  ('ready_for_listing', 'handoff', 'Ready for listing', 'A stable approved five-pose handoff is ready.', 90, 84, 'Send to the Listing Team', false),
  ('sent_to_listing_team', 'listing', 'Sent to Listing Team', 'The approved package was delivered to the Listing Team.', 100, 90, 'Start marketplace listing', false),
  ('listing_in_progress', 'listing', 'Listing in progress', 'The Listing Team is publishing the approved assets.', 110, 95, 'Complete and verify the listing', false),
  ('listed', 'complete', 'Listed', 'The marketplace listing is complete.', 120, 100, 'No action required', true),
  ('blocked_failed', 'exception', 'Blocked or failed', 'The workflow cannot continue until the recorded issue is resolved.', 130, 0, 'Resolve the blocker and retry', false)
on conflict (code) do update set
  group_key = excluded.group_key,
  title = excluded.title,
  description = excluded.description,
  stage_order = excluded.stage_order,
  progress_percent = excluded.progress_percent,
  default_next_action = excluded.default_next_action,
  terminal = excluded.terminal;

alter table public.catalog_workflow_stage_definitions enable row level security;
revoke all on table public.catalog_workflow_stage_definitions from anon;
grant select on table public.catalog_workflow_stage_definitions to authenticated;
grant all on table public.catalog_workflow_stage_definitions to service_role;

drop policy if exists catalog_workflow_stages_select_member on public.catalog_workflow_stage_definitions;
create policy catalog_workflow_stages_select_member
on public.catalog_workflow_stage_definitions
for select to authenticated
using ((select private.current_member_id()) is not null);

alter table public.catalog_work_items
  add column if not exists workflow_stage text not null default 'requirement_created',
  add column if not exists workflow_progress smallint not null default 5,
  add column if not exists current_step text not null default '',
  add column if not exists next_action text not null default '',
  add column if not exists stage_started_at timestamptz not null default now(),
  add column if not exists deadline_at timestamptz,
  add column if not exists back_reference_image_url text,
  add column if not exists marketplaces text[] not null default '{}'::text[],
  add column if not exists special_instructions text not null default '',
  add column if not exists campaign_event_details jsonb not null default '{}'::jsonb,
  add column if not exists blocked_reason text not null default '',
  add column if not exists failure_code text not null default '',
  add column if not exists final_approved_at timestamptz,
  add column if not exists final_approved_by_member_id uuid references public.organization_members(id) on delete set null,
  add column if not exists approval_revision integer not null default 0,
  add column if not exists listing_sent_at timestamptz,
  add column if not exists asset_folder_key text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_work_items_workflow_stage_check'
      and conrelid = 'public.catalog_work_items'::regclass
  ) then
    alter table public.catalog_work_items
      add constraint catalog_work_items_workflow_stage_check check (
        workflow_stage = any (array[
          'requirement_created','reference_assets_pending','planning','ready_for_generation',
          'generation_in_progress','quality_review','regeneration_required','approved',
          'ready_for_listing','sent_to_listing_team','listing_in_progress','listed','blocked_failed'
        ])
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_work_items_workflow_progress_check'
      and conrelid = 'public.catalog_work_items'::regclass
  ) then
    alter table public.catalog_work_items
      add constraint catalog_work_items_workflow_progress_check check (workflow_progress between 0 and 100);
  end if;
end
$$;

create index if not exists catalog_work_items_org_workflow_idx
  on public.catalog_work_items (organization_id, workflow_stage, priority, created_at desc);
create index if not exists catalog_work_items_org_deadline_idx
  on public.catalog_work_items (organization_id, deadline_at)
  where deadline_at is not null and workflow_stage <> 'listed';
create index if not exists catalog_work_items_final_approval_idx
  on public.catalog_work_items (organization_id, final_approved_at)
  where final_approved_at is not null;
create index if not exists catalog_work_items_final_approved_by_idx
  on public.catalog_work_items (final_approved_by_member_id)
  where final_approved_by_member_id is not null;

alter table public.catalog_work_item_events
  add column if not exists stage_code text references public.catalog_workflow_stage_definitions(code),
  add column if not exists message text not null default '',
  add column if not exists duration_seconds integer,
  add column if not exists related_asset_version_id uuid;

create index if not exists catalog_work_item_events_org_item_created_idx
  on public.catalog_work_item_events (organization_id, work_item_id, created_at desc);

create table if not exists public.catalog_creative_directions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_item_id uuid not null references public.catalog_work_items(id) on delete cascade,
  look_and_mood text not null default '',
  model_direction text not null default '',
  styling_requirements text not null default '',
  pose_direction jsonb not null default '[]'::jsonb,
  background_backdrop text not null default '',
  lighting text not null default '',
  composition text not null default '',
  marketplace_requirements text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, work_item_id)
);

create index if not exists catalog_creative_directions_work_item_idx
  on public.catalog_creative_directions (work_item_id);

create table if not exists public.catalog_work_item_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_item_id uuid not null references public.catalog_work_items(id) on delete cascade,
  assignment_type text not null check (assignment_type in ('generation','review','listing')),
  member_id uuid references public.organization_members(id) on delete set null,
  assigned_by_member_id uuid references public.organization_members(id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  active boolean not null default true,
  note text not null default ''
);

create unique index if not exists catalog_work_item_assignments_active_uidx
  on public.catalog_work_item_assignments (work_item_id, assignment_type)
  where active;
create index if not exists catalog_work_item_assignments_org_member_idx
  on public.catalog_work_item_assignments (organization_id, member_id, active);
create index if not exists catalog_work_item_assignments_member_idx
  on public.catalog_work_item_assignments (member_id)
  where member_id is not null;
create index if not exists catalog_work_item_assignments_assigned_by_idx
  on public.catalog_work_item_assignments (assigned_by_member_id)
  where assigned_by_member_id is not null;

create table if not exists public.catalog_work_item_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_item_id uuid not null references public.catalog_work_items(id) on delete cascade,
  author_member_id uuid references public.organization_members(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  visibility text not null default 'workspace' check (visibility in ('workspace','listing_team')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists catalog_work_item_comments_org_item_idx
  on public.catalog_work_item_comments (organization_id, work_item_id, created_at desc)
  where deleted_at is null;
create index if not exists catalog_work_item_comments_author_idx
  on public.catalog_work_item_comments (author_member_id)
  where author_member_id is not null;

alter table public.session_generations
  add column if not exists storage_backend text not null default 'firebase';

create table if not exists public.catalog_pose_asset_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_item_id uuid not null references public.catalog_work_items(id) on delete cascade,
  session_id text not null,
  generation_job_id text,
  generation_id text not null,
  pose_index smallint not null check (pose_index between 1 and 5),
  version_number integer not null check (version_number > 0),
  title text not null default '',
  preview_url text not null default '',
  original_url text not null default '',
  storage_backend text not null default 'firebase' check (storage_backend in ('firebase','supabase','external')),
  storage_path text not null default '',
  generation_status text not null default 'completed',
  model text not null default '',
  prompt text not null default '',
  prompt_metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','superseded')),
  approved_by_member_id uuid references public.organization_members(id) on delete set null,
  approved_at timestamptz,
  reviewer_comments text not null default '',
  final_asset_url text not null default '',
  regeneration_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_item_id, pose_index, version_number)
);

alter table public.catalog_work_item_events
  add constraint catalog_work_item_events_asset_version_fkey
  foreign key (related_asset_version_id) references public.catalog_pose_asset_versions(id) on delete set null;

create index if not exists catalog_pose_asset_versions_org_item_idx
  on public.catalog_pose_asset_versions (organization_id, work_item_id, pose_index, version_number desc);
create index if not exists catalog_pose_asset_versions_session_idx
  on public.catalog_pose_asset_versions (session_id, pose_index);
create index if not exists catalog_pose_asset_versions_job_idx
  on public.catalog_pose_asset_versions (generation_job_id)
  where generation_job_id is not null;
create index if not exists catalog_pose_asset_versions_approved_by_idx
  on public.catalog_pose_asset_versions (approved_by_member_id)
  where approved_by_member_id is not null;
create unique index if not exists catalog_pose_asset_versions_current_approved_uidx
  on public.catalog_pose_asset_versions (work_item_id, pose_index)
  where approval_status = 'approved';

create table if not exists public.catalog_asset_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_item_id uuid not null references public.catalog_work_items(id) on delete cascade,
  asset_version_id uuid references public.catalog_pose_asset_versions(id) on delete cascade,
  review_scope text not null default 'pose' check (review_scope in ('pose','sku_set')),
  decision text not null check (decision in ('approved','rejected','changes_requested')),
  reviewer_member_id uuid references public.organization_members(id) on delete set null,
  comments text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists catalog_asset_reviews_org_item_idx
  on public.catalog_asset_reviews (organization_id, work_item_id, created_at desc);
create index if not exists catalog_asset_reviews_asset_idx
  on public.catalog_asset_reviews (asset_version_id, created_at desc)
  where asset_version_id is not null;
create index if not exists catalog_asset_reviews_reviewer_idx
  on public.catalog_asset_reviews (reviewer_member_id)
  where reviewer_member_id is not null;

create table if not exists public.catalog_listing_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_item_id uuid not null references public.catalog_work_items(id) on delete cascade,
  approval_revision integer not null check (approval_revision > 0),
  status text not null default 'ready' check (status in ('ready','sent','listing_in_progress','listed','superseded')),
  folder_key text not null,
  share_token uuid not null default gen_random_uuid(),
  approved_at timestamptz not null,
  approved_by_member_id uuid references public.organization_members(id) on delete set null,
  sent_at timestamptz,
  listing_started_at timestamptz,
  listed_at timestamptz,
  remarks text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_item_id, approval_revision),
  unique (share_token)
);

create index if not exists catalog_listing_handoffs_org_status_idx
  on public.catalog_listing_handoffs (organization_id, status, approved_at);
create index if not exists catalog_listing_handoffs_approved_by_idx
  on public.catalog_listing_handoffs (approved_by_member_id)
  where approved_by_member_id is not null;

create table if not exists public.catalog_listing_handoff_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handoff_id uuid not null references public.catalog_listing_handoffs(id) on delete cascade,
  asset_version_id uuid not null references public.catalog_pose_asset_versions(id) on delete restrict,
  pose_index smallint not null check (pose_index between 1 and 5),
  created_at timestamptz not null default now(),
  unique (handoff_id, pose_index),
  unique (handoff_id, asset_version_id)
);

create index if not exists catalog_listing_handoff_assets_org_handoff_idx
  on public.catalog_listing_handoff_assets (organization_id, handoff_id);
create index if not exists catalog_listing_handoff_assets_version_idx
  on public.catalog_listing_handoff_assets (asset_version_id);

create table if not exists public.catalog_handoff_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  enabled boolean not null default true,
  timezone text not null default 'Asia/Kolkata',
  send_local_time time not null default '10:00',
  recipient_mode text not null default 'listing_team' check (recipient_mode in ('listing_team','custom','listing_team_and_custom')),
  custom_recipients text[] not null default '{}'::text[],
  business_weekdays smallint[] not null default '{1,2,3,4,5}'::smallint[],
  holiday_dates date[] not null default '{}'::date[],
  late_approval_policy text not null default 'next_business_digest' check (late_approval_policy in ('next_business_digest','next_calendar_digest')),
  updated_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_handoff_settings_updated_by_idx
  on public.catalog_handoff_settings (updated_by_member_id)
  where updated_by_member_id is not null;

alter table public.catalog_report_deliveries
  add column if not exists delivery_key text not null default '',
  add column if not exists delivery_kind text not null default 'daily' check (delivery_kind in ('daily','manual')),
  add column if not exists approved_from timestamptz,
  add column if not exists approved_to timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists created_by_member_id uuid references public.organization_members(id) on delete set null;

update public.catalog_report_deliveries
set delivery_key = coalesce(nullif(delivery_key, ''), 'daily:' || report_date::text)
where delivery_key = '';

create unique index if not exists catalog_report_deliveries_org_key_uidx
  on public.catalog_report_deliveries (organization_id, delivery_key);
create index if not exists catalog_report_deliveries_created_by_idx
  on public.catalog_report_deliveries (created_by_member_id)
  where created_by_member_id is not null;

create table if not exists public.catalog_report_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null references public.catalog_report_deliveries(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  trigger_type text not null default 'scheduled' check (trigger_type in ('scheduled','manual','retry','resend')),
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  recipients text[] not null default '{}'::text[],
  provider_message_id text not null default '',
  error_message text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  actor_member_id uuid references public.organization_members(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  unique (delivery_id, attempt_number)
);

create index if not exists catalog_report_delivery_attempts_org_delivery_idx
  on public.catalog_report_delivery_attempts (organization_id, delivery_id, attempt_number desc);
create index if not exists catalog_report_delivery_attempts_actor_idx
  on public.catalog_report_delivery_attempts (actor_member_id)
  where actor_member_id is not null;

create table if not exists public.catalog_report_delivery_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null references public.catalog_report_deliveries(id) on delete cascade,
  handoff_id uuid not null references public.catalog_listing_handoffs(id) on delete restrict,
  work_item_id uuid not null references public.catalog_work_items(id) on delete restrict,
  included_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (handoff_id),
  unique (delivery_id, work_item_id)
);

create index if not exists catalog_report_delivery_items_org_delivery_idx
  on public.catalog_report_delivery_items (organization_id, delivery_id);
create index if not exists catalog_report_delivery_items_work_item_idx
  on public.catalog_report_delivery_items (work_item_id);

-- Server APIs own mutations. Authenticated clients can read only their current
-- organization through RLS; browser-side writes are deliberately not granted.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'catalog_creative_directions',
    'catalog_work_item_assignments',
    'catalog_work_item_comments',
    'catalog_pose_asset_versions',
    'catalog_asset_reviews',
    'catalog_listing_handoffs',
    'catalog_listing_handoff_assets',
    'catalog_handoff_settings',
    'catalog_report_delivery_attempts',
    'catalog_report_delivery_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('revoke insert, update, delete on table public.%I from authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select_current_org', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id = (select private.current_organization_id()))',
      table_name || '_select_current_org', table_name
    );
  end loop;
end
$$;

-- A private Supabase Storage bucket and tenant-prefixed policies are provisioned
-- for the gradual asset cutover. Existing Firebase objects are not moved here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-assets', 'catalog-assets', false, 20971520, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists catalog_assets_select_current_org on storage.objects;
create policy catalog_assets_select_current_org on storage.objects
for select to authenticated
using (
  bucket_id = 'catalog-assets'
  and (storage.foldername(name))[1] = (select private.current_organization_id())::text
);

drop policy if exists catalog_assets_insert_current_org on storage.objects;
create policy catalog_assets_insert_current_org on storage.objects
for insert to authenticated
with check (
  bucket_id = 'catalog-assets'
  and (storage.foldername(name))[1] = (select private.current_organization_id())::text
  and (
    (select private.has_permission('planning.create'))
    or (select private.has_permission('planning.manage'))
    or (select private.has_permission('studio.generate'))
  )
);

drop policy if exists catalog_assets_update_current_org on storage.objects;
create policy catalog_assets_update_current_org on storage.objects
for update to authenticated
using (
  bucket_id = 'catalog-assets'
  and (storage.foldername(name))[1] = (select private.current_organization_id())::text
  and (
    (select private.has_permission('planning.manage'))
    or (select private.has_permission('studio.generate'))
  )
)
with check (
  bucket_id = 'catalog-assets'
  and (storage.foldername(name))[1] = (select private.current_organization_id())::text
);

drop policy if exists catalog_assets_delete_current_org on storage.objects;
create policy catalog_assets_delete_current_org on storage.objects
for delete to authenticated
using (
  bucket_id = 'catalog-assets'
  and (storage.foldername(name))[1] = (select private.current_organization_id())::text
  and (select private.has_permission('planning.manage'))
);

-- Derive the canonical operational stage from real state-bearing columns. This
-- runs after the existing normalizer and also stamps final approval revisions.
create or replace function private.enrich_catalog_workflow_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  derived_stage text;
  derived_progress smallint;
  derived_next_action text;
begin
  if tg_op = 'UPDATE'
     and new.generation_status in ('ready','queued','generating')
     and old.generation_status is distinct from new.generation_status then
    new.final_approved_at := null;
    new.final_approved_by_member_id := null;
    new.listing_sent_at := null;
  end if;

  if new.qc_status = 'passed'
     and (tg_op = 'INSERT' or old.qc_status is distinct from 'passed') then
    new.final_approved_at := coalesce(new.final_approved_at, now());
    new.final_approved_by_member_id := coalesce(new.final_approved_by_member_id, private.current_member_id());
    new.approval_revision := case
      when tg_op = 'INSERT' then greatest(new.approval_revision, 1)
      else greatest(old.approval_revision + 1, 1)
    end;
  end if;

  derived_stage := case
    when new.listing_status = 'completed' or new.status = 'completed' then 'listed'
    when new.listing_status = 'in_progress' then 'listing_in_progress'
    when new.listing_sent_at is not null then 'sent_to_listing_team'
    when new.qc_status = 'passed' and new.final_approved_at is not null then 'ready_for_listing'
    when new.qc_status = 'passed' then 'approved'
    when new.qc_status = 'rejected' then 'regeneration_required'
    when new.status = 'blocked' or new.generation_status = 'failed' then 'blocked_failed'
    when new.generation_status = 'completed' then 'quality_review'
    when new.generation_status in ('queued','generating','processing') then 'generation_in_progress'
    when new.planning_request_id is not null
      and (coalesce(new.reference_image_url, '') = '' or coalesce(new.back_reference_image_url, '') = '') then 'reference_assets_pending'
    when coalesce(new.reference_image_url, '') = '' or coalesce(new.back_reference_image_url, '') = '' then 'reference_assets_pending'
    when new.generation_status = 'ready' then 'ready_for_generation'
    when new.planning_request_id is not null then 'planning'
    else 'requirement_created'
  end;

  select definition.progress_percent, definition.default_next_action
  into derived_progress, derived_next_action
  from public.catalog_workflow_stage_definitions as definition
  where definition.code = derived_stage;

  if tg_op = 'INSERT' or old.workflow_stage is distinct from derived_stage then
    new.stage_started_at := now();
  end if;
  new.workflow_stage := derived_stage;
  new.workflow_progress := coalesce(derived_progress, 0);
  new.next_action := case
    when new.blocked_reason <> '' then 'Resolve: ' || new.blocked_reason
    else coalesce(nullif(new.next_action, ''), derived_next_action, '')
  end;
  new.current_step := case
    when derived_stage = 'generation_in_progress' then 'Generating pose set'
    when derived_stage = 'quality_review' then 'Human five-pose review'
    when derived_stage in ('sent_to_listing_team','listing_in_progress') then 'Marketplace listing'
    else coalesce(nullif(new.current_step, ''), derived_next_action, '')
  end;
  new.asset_folder_key := coalesce(nullif(new.asset_folder_key, ''), new.organization_id::text || '/' || new.id::text || '/approved');
  return new;
end;
$$;

revoke all on function private.enrich_catalog_workflow_state() from public, anon, authenticated;
grant execute on function private.enrich_catalog_workflow_state() to service_role, postgres;

drop trigger if exists catalog_work_item_workflow_state on public.catalog_work_items;
create trigger catalog_work_item_workflow_state
before insert or update on public.catalog_work_items
for each row execute function private.enrich_catalog_workflow_state();

create or replace function private.audit_catalog_workflow_stage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if old.workflow_stage is distinct from new.workflow_stage then
    insert into public.catalog_work_item_events (
      organization_id, work_item_id, event_type, from_status, to_status,
      stage_code, actor_member_id, source, message, duration_seconds
    ) values (
      new.organization_id, new.id, 'workflow_stage_changed', old.workflow_stage, new.workflow_stage,
      new.workflow_stage, private.current_member_id(), 'system',
      'Moved to ' || replace(new.workflow_stage, '_', ' '),
      greatest(0, extract(epoch from (now() - old.stage_started_at))::integer)
    );
  end if;
  return new;
end;
$$;

revoke all on function private.audit_catalog_workflow_stage() from public, anon, authenticated;
grant execute on function private.audit_catalog_workflow_stage() to service_role, postgres;

drop trigger if exists catalog_work_item_workflow_audit on public.catalog_work_items;
create trigger catalog_work_item_workflow_audit
after update on public.catalog_work_items
for each row execute function private.audit_catalog_workflow_stage();

create or replace function private.sync_catalog_pose_asset_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target public.catalog_work_items%rowtype;
  job public.generation_jobs%rowtype;
  source_epoch integer := greatest(coalesce(new.generation_epoch, 1), 1);
  target_version integer;
begin
  if new.status <> 'completed' or coalesce(new.output_url, '') = '' then return new; end if;

  select item.*
  into target
  from public.catalog_work_items as item
  where item.catalog_session_id = new.session_id
  order by item.updated_at desc
  limit 1;
  if target.id is null then return new; end if;

  select generation_job.*
  into job
  from public.generation_jobs as generation_job
  where generation_job.job_id = target.generation_job_id
     or generation_job.session_id = new.session_id
  order by generation_job.created_at desc
  limit 1;

  select version.version_number
  into target_version
  from public.catalog_pose_asset_versions as version
  where version.work_item_id = target.id
    and version.pose_index = new.pose_index
    and version.generation_id = new.generation_id
    and case
      when coalesce(version.prompt_metadata ->> 'sourceGenerationEpoch', '') ~ '^\d+$'
        then (version.prompt_metadata ->> 'sourceGenerationEpoch')::integer
      else 1
    end = source_epoch
  order by version.version_number desc
  limit 1;

  if target_version is null then
    select coalesce(max(version.version_number), 0) + 1
    into target_version
    from public.catalog_pose_asset_versions as version
    where version.work_item_id = target.id
      and version.pose_index = new.pose_index;
  end if;

  insert into public.catalog_pose_asset_versions (
    organization_id, work_item_id, session_id, generation_job_id, generation_id,
    pose_index, version_number, title, preview_url, original_url, storage_backend,
    storage_path, generation_status, model, prompt, prompt_metadata, generated_at,
    regeneration_metadata, updated_at
  ) values (
    target.organization_id, target.id, new.session_id, coalesce(job.job_id, target.generation_job_id), new.generation_id,
    new.pose_index, target_version, new.title,
    new.output_url, new.output_url, coalesce(nullif(new.storage_backend, ''), 'firebase'),
    new.storage_path, new.status, coalesce(job.model, ''), new.full_prompt,
    jsonb_build_object('provider', coalesce(job.provider, ''), 'providerRequestId', new.provider_request_id, 'usage', new.usage_payload, 'sourceGenerationEpoch', source_epoch),
    coalesce(new.updated_at, now()),
    jsonb_build_object('history', new.regeneration_history, 'attemptCount', new.attempt_count),
    now()
  )
  on conflict (work_item_id, pose_index, version_number) do update set
    generation_id = excluded.generation_id,
    preview_url = excluded.preview_url,
    original_url = excluded.original_url,
    storage_backend = excluded.storage_backend,
    storage_path = excluded.storage_path,
    generation_status = excluded.generation_status,
    model = excluded.model,
    prompt = excluded.prompt,
    prompt_metadata = excluded.prompt_metadata,
    generated_at = excluded.generated_at,
    regeneration_metadata = excluded.regeneration_metadata,
    updated_at = now();
  return new;
end;
$$;

revoke all on function private.sync_catalog_pose_asset_version() from public, anon, authenticated;
grant execute on function private.sync_catalog_pose_asset_version() to service_role, postgres;

drop trigger if exists session_generation_sync_catalog_pose_version on public.session_generations;
create trigger session_generation_sync_catalog_pose_version
after insert or update of status, output_url, storage_path, generation_epoch, updated_at
on public.session_generations
for each row execute function private.sync_catalog_pose_asset_version();

create or replace function private.freeze_catalog_handoff_on_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  handoff_id uuid;
begin
  if new.qc_status <> 'passed' or old.qc_status is not distinct from 'passed' then return new; end if;

  update public.catalog_pose_asset_versions as version
  set approval_status = 'superseded', updated_at = now()
  where version.work_item_id = new.id and version.approval_status = 'approved';

  update public.catalog_pose_asset_versions as version
  set approval_status = 'approved',
      approved_by_member_id = new.final_approved_by_member_id,
      approved_at = new.final_approved_at,
      final_asset_url = coalesce(nullif(version.original_url, ''), version.preview_url),
      updated_at = now()
  where version.id in (
    select distinct on (current_version.pose_index) current_version.id
    from public.catalog_pose_asset_versions as current_version
    where current_version.work_item_id = new.id
    order by current_version.pose_index, current_version.version_number desc
  );

  insert into public.catalog_listing_handoffs (
    organization_id, work_item_id, approval_revision, status, folder_key,
    approved_at, approved_by_member_id, remarks
  ) values (
    new.organization_id, new.id, greatest(new.approval_revision, 1), 'ready',
    new.asset_folder_key, coalesce(new.final_approved_at, now()), new.final_approved_by_member_id,
    new.remarks
  )
  on conflict (work_item_id, approval_revision) do update set
    status = 'ready',
    folder_key = excluded.folder_key,
    approved_at = excluded.approved_at,
    approved_by_member_id = excluded.approved_by_member_id,
    updated_at = now()
  returning id into handoff_id;

  insert into public.catalog_listing_handoff_assets
    (organization_id, handoff_id, asset_version_id, pose_index)
  select new.organization_id, handoff_id, version.id, version.pose_index
  from public.catalog_pose_asset_versions as version
  where version.work_item_id = new.id and version.approval_status = 'approved'
  on conflict (handoff_id, pose_index) do update set asset_version_id = excluded.asset_version_id;

  insert into public.catalog_asset_reviews (
    organization_id, work_item_id, asset_version_id, review_scope, decision,
    reviewer_member_id, comments, metadata
  )
  select new.organization_id, new.id, version.id, 'pose', 'approved',
    new.final_approved_by_member_id, '', jsonb_build_object('approvalRevision', new.approval_revision)
  from public.catalog_pose_asset_versions as version
  where version.work_item_id = new.id and version.approval_status = 'approved';

  return new;
end;
$$;

revoke all on function private.freeze_catalog_handoff_on_approval() from public, anon, authenticated;
grant execute on function private.freeze_catalog_handoff_on_approval() to service_role, postgres;

drop trigger if exists catalog_work_item_freeze_handoff on public.catalog_work_items;
create trigger catalog_work_item_freeze_handoff
after update of qc_status on public.catalog_work_items
for each row execute function private.freeze_catalog_handoff_on_approval();

-- Keep planning defaults and the structured batch brief synchronized into the
-- operational work item created by the existing generation-status trigger.
create or replace function private.sync_catalog_workflow_details_from_planning()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  batch public.planning_batches%rowtype;
  target_item_id uuid;
  listing_member_id uuid;
  marketplace_values text[];
begin
  select planning_batch.* into batch
  from public.planning_batches as planning_batch
  where planning_batch.id = new.batch_id
    and planning_batch.organization_id = new.organization_id;

  if coalesce(batch.generation_settings ->> 'listingAssignedMemberId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    listing_member_id := (batch.generation_settings ->> 'listingAssignedMemberId')::uuid;
  end if;
  select coalesce(array_agg(marketplace.value), '{}'::text[]) into marketplace_values
  from jsonb_array_elements_text(coalesce(batch.generation_settings -> 'marketplaces', '[]'::jsonb)) as marketplace(value);

  update public.catalog_work_items as item
  set priority = coalesce(nullif(new.priority, ''), nullif(batch.priority, ''), item.priority),
      reference_image_url = nullif(new.front_image_url, ''),
      back_reference_image_url = nullif(new.back_image_url, ''),
      generation_assigned_member_id = coalesce(new.assigned_member_id, batch.assigned_member_id, item.generation_assigned_member_id),
      listing_assigned_member_id = coalesce(listing_member_id, item.listing_assigned_member_id),
      deadline_at = coalesce(
        case when coalesce(batch.generation_settings ->> 'deadlineAt', '') <> '' then (batch.generation_settings ->> 'deadlineAt')::timestamptz end,
        new.expected_shoot_date::timestamptz,
        item.deadline_at
      ),
      marketplaces = case when cardinality(marketplace_values) > 0 then marketplace_values else item.marketplaces end,
      special_instructions = coalesce(nullif(new.notes, ''), nullif(batch.generation_settings ->> 'specialInstructions', ''), item.special_instructions),
      campaign_season = coalesce(nullif(batch.campaign_season, ''), item.campaign_season),
      event_id = coalesce(batch.event_id, batch.source_event_id, item.event_id),
      campaign_event_details = jsonb_strip_nulls(jsonb_build_object(
        'campaign', nullif(batch.campaign_season, ''),
        'eventId', coalesce(batch.event_id, batch.source_event_id),
        'batchName', batch.name
      )),
      updated_at = now()
  where item.organization_id = new.organization_id and item.planning_request_id = new.id
  returning item.id into target_item_id;

  if target_item_id is not null then
    insert into public.catalog_creative_directions (
      organization_id, work_item_id, look_and_mood, model_direction, styling_requirements,
      pose_direction, background_backdrop, lighting, composition, marketplace_requirements,
      metadata, created_by_member_id, updated_at
    ) values (
      new.organization_id, target_item_id,
      coalesce(batch.generation_settings ->> 'lookAndMood', ''),
      coalesce(batch.generation_settings ->> 'modelDirection', ''),
      coalesce(batch.generation_settings ->> 'stylingRequirements', ''),
      coalesce(new.pose_plan, '[]'::jsonb),
      coalesce(batch.generation_settings ->> 'sceneDirection', ''),
      coalesce(batch.generation_settings ->> 'lighting', ''),
      coalesce(batch.generation_settings ->> 'composition', ''),
      coalesce(batch.generation_settings ->> 'marketplaceRequirements', ''),
      jsonb_build_object('poseDirection', coalesce(batch.generation_settings ->> 'poseDirection', ''), 'selectedStyling', new.selected_styling),
      new.created_by_member_id,
      now()
    )
    on conflict (organization_id, work_item_id) do update set
      look_and_mood = excluded.look_and_mood,
      model_direction = excluded.model_direction,
      styling_requirements = excluded.styling_requirements,
      pose_direction = excluded.pose_direction,
      background_backdrop = excluded.background_backdrop,
      lighting = excluded.lighting,
      composition = excluded.composition,
      marketplace_requirements = excluded.marketplace_requirements,
      metadata = excluded.metadata,
      updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function private.sync_catalog_workflow_details_from_planning() from public, anon, authenticated;
grant execute on function private.sync_catalog_workflow_details_from_planning() to service_role, postgres;

drop trigger if exists planning_request_sync_catalog_workflow_details on public.planning_requests;
create trigger planning_request_sync_catalog_workflow_details
after insert or update of priority, assigned_member_id, expected_shoot_date, notes, batch_id, pose_plan, selected_styling, front_image_url, back_image_url
on public.planning_requests
for each row execute function private.sync_catalog_workflow_details_from_planning();

-- Backfill operational fields from the existing planning model.
update public.catalog_work_items as item
set priority = case when item.priority = 'normal' then coalesce(nullif(request.priority, ''), item.priority) else item.priority end,
    reference_image_url = coalesce(nullif(item.reference_image_url, ''), nullif(request.front_image_url, '')),
    back_reference_image_url = coalesce(nullif(item.back_reference_image_url, ''), nullif(request.back_image_url, '')),
    generation_assigned_member_id = coalesce(item.generation_assigned_member_id, request.assigned_member_id),
    special_instructions = coalesce(nullif(item.special_instructions, ''), nullif(request.notes, ''), ''),
    campaign_season = coalesce(nullif(item.campaign_season, ''), nullif(batch.campaign_season, ''), item.campaign_season),
    event_id = coalesce(item.event_id, batch.event_id, batch.source_event_id),
    asset_folder_key = item.organization_id::text || '/' || item.id::text || '/approved',
    workflow_stage = case
      when item.listing_status = 'completed' or item.status = 'completed' then 'listed'
      when item.listing_status = 'in_progress' then 'listing_in_progress'
      when item.qc_status = 'passed' then 'ready_for_listing'
      when item.qc_status = 'rejected' then 'regeneration_required'
      when item.status = 'blocked' or item.generation_status = 'failed' then 'blocked_failed'
      when item.generation_status = 'completed' then 'quality_review'
      when item.generation_status in ('queued','generating','processing') then 'generation_in_progress'
      when item.planning_request_id is not null
        and (coalesce(item.reference_image_url, request.front_image_url, '') = '' or coalesce(item.back_reference_image_url, request.back_image_url, '') = '') then 'reference_assets_pending'
      when coalesce(item.reference_image_url, '') = '' or coalesce(item.back_reference_image_url, '') = '' then 'reference_assets_pending'
      when item.generation_status = 'ready' then 'ready_for_generation'
      when item.planning_request_id is not null then 'planning'
      else 'requirement_created'
    end,
    workflow_progress = case
      when item.listing_status = 'completed' or item.status = 'completed' then 100
      when item.listing_status = 'in_progress' then 95
      when item.qc_status = 'passed' then 84
      when item.qc_status = 'rejected' then 58
      when item.status = 'blocked' or item.generation_status = 'failed' then 0
      when item.generation_status = 'completed' then 68
      when item.generation_status in ('queued','generating','processing') then 52
      when coalesce(item.reference_image_url, request.front_image_url, '') = ''
        or coalesce(item.back_reference_image_url, request.back_image_url, '') = '' then 12
      when item.generation_status = 'ready' then 32
      when item.planning_request_id is not null then 22
      else 5
    end,
    stage_started_at = coalesce(
      item.listing_completed_at, item.listing_started_at, item.generation_completed_at,
      item.generation_started_at, item.updated_at, item.created_at
    ),
    deadline_at = coalesce(item.deadline_at, request.expected_shoot_date::timestamptz),
    campaign_event_details = case
      when coalesce(item.campaign_event_details, '{}'::jsonb) = '{}'::jsonb then jsonb_strip_nulls(jsonb_build_object(
        'campaign', nullif(batch.campaign_season, ''),
        'eventId', coalesce(batch.event_id, batch.source_event_id),
        'batchName', batch.name
      ))
      else item.campaign_event_details
    end
from public.planning_requests as request
left join public.planning_batches as batch on batch.id = request.batch_id
where request.id = item.planning_request_id;

update public.catalog_work_items as item
set asset_folder_key = item.organization_id::text || '/' || item.id::text || '/approved'
where item.asset_folder_key = '';

insert into public.catalog_creative_directions (
  organization_id, work_item_id, look_and_mood, model_direction, styling_requirements,
  pose_direction, background_backdrop, lighting, composition, marketplace_requirements,
  metadata, created_by_member_id
)
select
  item.organization_id,
  item.id,
  coalesce(batch.generation_settings ->> 'lookAndMood', batch.generation_settings ->> 'mood', ''),
  coalesce(batch.generation_settings ->> 'modelDirection', ''),
  coalesce(batch.generation_settings ->> 'stylingRequirements', ''),
  coalesce(request.pose_plan, '[]'::jsonb),
  coalesce(batch.generation_settings ->> 'sceneDirection', ''),
  coalesce(batch.generation_settings ->> 'lighting', ''),
  coalesce(batch.generation_settings ->> 'composition', ''),
  coalesce(batch.generation_settings ->> 'marketplaceRequirements', ''),
  jsonb_build_object('source', 'workflow_v2_backfill', 'selectedStyling', request.selected_styling),
  item.created_by_member_id
from public.catalog_work_items as item
join public.planning_requests as request on request.id = item.planning_request_id
left join public.planning_batches as batch on batch.id = request.batch_id
on conflict (organization_id, work_item_id) do nothing;

insert into public.catalog_work_item_assignments (
  organization_id, work_item_id, assignment_type, member_id, assigned_by_member_id,
  assigned_at, active, note
)
select item.organization_id, item.id, assignment.assignment_type, assignment.member_id,
  item.created_by_member_id, item.updated_at, true, 'Backfilled from the active Catalog Production owner'
from public.catalog_work_items as item
cross join lateral (
  values
    ('generation'::text, item.generation_assigned_member_id),
    ('listing'::text, item.listing_assigned_member_id)
) as assignment(assignment_type, member_id)
where assignment.member_id is not null
on conflict (work_item_id, assignment_type) where active do nothing;

insert into public.catalog_pose_asset_versions (
  organization_id, work_item_id, session_id, generation_job_id, generation_id,
  pose_index, version_number, title, preview_url, original_url, storage_backend,
  storage_path, generation_status, model, prompt, prompt_metadata, generated_at,
  regeneration_metadata
)
select
  item.organization_id, item.id, generation.session_id, coalesce(job.job_id, item.generation_job_id), generation.generation_id,
  generation.pose_index, greatest(coalesce(generation.generation_epoch, 1), 1), generation.title,
  generation.output_url, generation.output_url, coalesce(nullif(generation.storage_backend, ''), 'firebase'),
  generation.storage_path, generation.status, coalesce(job.model, ''), generation.full_prompt,
  jsonb_build_object('provider', coalesce(job.provider, ''), 'providerRequestId', generation.provider_request_id, 'usage', generation.usage_payload, 'sourceGenerationEpoch', greatest(coalesce(generation.generation_epoch, 1), 1)),
  coalesce(generation.updated_at, generation.created_at),
  jsonb_build_object('history', generation.regeneration_history, 'attemptCount', generation.attempt_count)
from public.catalog_work_items as item
join public.session_generations as generation on generation.session_id = item.catalog_session_id
left join public.generation_jobs as job on job.job_id = item.generation_job_id
where generation.pose_index between 1 and 5
  and generation.status = 'completed'
  and generation.output_url <> ''
on conflict (work_item_id, pose_index, version_number) do nothing;

update public.catalog_work_items
set final_approved_at = coalesce(final_approved_at, listing_started_at, updated_at),
    final_approved_by_member_id = coalesce(final_approved_by_member_id, created_by_member_id),
    approval_revision = greatest(approval_revision, 1)
where qc_status = 'passed';

insert into public.catalog_listing_handoffs (
  organization_id, work_item_id, approval_revision, status, folder_key,
  approved_at, approved_by_member_id, sent_at, listing_started_at, listed_at, remarks
)
select item.organization_id, item.id, greatest(item.approval_revision, 1),
  case when item.listing_status = 'completed' then 'listed' when item.listing_status = 'in_progress' then 'listing_in_progress' when item.listing_sent_at is not null then 'sent' else 'ready' end,
  item.asset_folder_key, coalesce(item.final_approved_at, item.updated_at), item.final_approved_by_member_id,
  item.listing_sent_at, item.listing_started_at, item.listing_completed_at, coalesce(item.remarks, '')
from public.catalog_work_items as item
where item.qc_status = 'passed'
on conflict (work_item_id, approval_revision) do nothing;

with latest as (
  select distinct on (version.work_item_id, version.pose_index)
    version.id, version.work_item_id, version.pose_index
  from public.catalog_pose_asset_versions as version
  order by version.work_item_id, version.pose_index, version.version_number desc
)
update public.catalog_pose_asset_versions as version
set approval_status = 'approved',
    approved_by_member_id = item.final_approved_by_member_id,
    approved_at = item.final_approved_at,
    final_asset_url = coalesce(nullif(version.original_url, ''), version.preview_url),
    updated_at = now()
from latest
join public.catalog_work_items as item on item.id = latest.work_item_id and item.qc_status = 'passed'
where version.id = latest.id;

insert into public.catalog_listing_handoff_assets
  (organization_id, handoff_id, asset_version_id, pose_index)
select handoff.organization_id, handoff.id, version.id, version.pose_index
from public.catalog_listing_handoffs as handoff
join public.catalog_pose_asset_versions as version
  on version.work_item_id = handoff.work_item_id and version.approval_status = 'approved'
on conflict (handoff_id, pose_index) do nothing;

insert into public.catalog_handoff_settings (
  organization_id, enabled, timezone, send_local_time, recipient_mode,
  custom_recipients, business_weekdays, holiday_dates, late_approval_policy
)
select organization.id, true, coalesce(setting.timezone, 'Asia/Kolkata'), '10:00'::time,
  'listing_team', coalesce(setting.report_recipients, '{}'::text[]),
  '{1,2,3,4,5}'::smallint[], '{}'::date[], 'next_business_digest'
from public.organizations as organization
left join public.event_automation_settings as setting on setting.organization_id = organization.id
on conflict (organization_id) do nothing;

-- Preserve idempotency for handoffs already mentioned by a successful legacy
-- catalog report. This prevents the V2 approval digest from emailing the same
-- SKU again during rollout.
insert into public.catalog_report_delivery_items (
  organization_id, delivery_id, handoff_id, work_item_id, included_at, sent_at
)
select delivery.organization_id, delivery.id, handoff.id, item.id,
  delivery.created_at, delivery.sent_at
from public.catalog_report_deliveries as delivery
cross join lateral jsonb_array_elements_text(coalesce(delivery.payload -> 'workItemIds', '[]'::jsonb)) as payload_item(work_item_id)
join public.catalog_work_items as item on item.id::text = payload_item.work_item_id
join public.catalog_listing_handoffs as handoff on handoff.work_item_id = item.id
where delivery.status = 'sent'
on conflict (handoff_id) do nothing;

update public.catalog_listing_handoffs as handoff
set status = case when handoff.status = 'listed' then 'listed' else 'sent' end,
    sent_at = coalesce(handoff.sent_at, delivery_item.sent_at),
    updated_at = now()
from public.catalog_report_delivery_items as delivery_item
where delivery_item.handoff_id = handoff.id;

update public.catalog_work_items as item
set listing_sent_at = coalesce(item.listing_sent_at, delivery_item.sent_at),
    workflow_stage = case when item.workflow_stage = 'listed' then 'listed' else 'sent_to_listing_team' end,
    workflow_progress = case when item.workflow_stage = 'listed' then 100 else 90 end
from public.catalog_report_delivery_items as delivery_item
where delivery_item.work_item_id = item.id;

-- Publish operational state for live UI updates. Low-frequency polling remains
-- only as a recovery mechanism for disconnected clients.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'catalog_work_items',
    'catalog_work_item_events',
    'catalog_work_item_comments',
    'catalog_pose_asset_versions',
    'catalog_asset_reviews',
    'catalog_listing_handoffs',
    'catalog_report_deliveries',
    'catalog_report_delivery_attempts'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables as publication_table
      where publication_table.pubname = 'supabase_realtime'
        and publication_table.schemaname = 'public'
        and publication_table.tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;

alter table public.catalog_work_items replica identity full;
alter table public.catalog_report_deliveries replica identity full;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'ai-studio-catalog-production-report'
  limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end
$$;

-- The worker checks each organization's local send time and business calendar;
-- the frequent schedule only supplies a reliable wake-up and retry cadence.
select cron.schedule(
  'ai-studio-catalog-production-report',
  '7,22,37,52 * * * *',
  $$select private.dispatch_app_worker('catalogProduction.automation')$$
);
