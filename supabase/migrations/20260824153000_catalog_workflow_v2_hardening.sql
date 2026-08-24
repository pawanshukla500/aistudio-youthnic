-- Catalog Workflow V2 follow-up hardening.
-- The base V2 migration has already shipped; keep it immutable and apply every
-- permission, notification, state-derivation, versioning, and assertion change
-- through this additive migration.

insert into public.permissions (key, module, description)
values
  ('catalog.assign', 'catalog', 'Assign generation, review, and listing ownership.'),
  ('catalog.handoff.manage', 'catalog', 'Configure, preview, send, retry, and inspect Listing Team handoffs.'),
  ('catalog.listing.complete', 'catalog', 'Start and complete marketplace listing work from an approved handoff.')
on conflict (key) do update set module = excluded.module, description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select role.id, permission.id
from public.roles as role
cross join public.permissions as permission
where role.is_system
  and (
    (role.slug in ('planning-manager','admin') and permission.key in ('catalog.assign','catalog.handoff.manage','catalog.listing.complete'))
    or (role.slug = 'listing-team' and permission.key = 'catalog.listing.complete')
  )
on conflict do nothing;

delete from public.role_permissions as role_permission
using public.roles as role, public.permissions as permission
where role_permission.role_id = role.id
  and role_permission.permission_id = permission.id
  and role.is_system
  and (
    (role.slug = 'listing-team' and permission.key = any (array[
      'planning.analyze','planning.approve','planning.create','planning.generate_images','planning.manage','studio.generate'
    ]))
    or (role.slug = 'creative-team' and permission.key = any (array['planning.approve','planning.manage']))
  );

alter table public.catalog_handoff_settings
  add column if not exists recipient_role_slug text not null default 'listing-team';

-- Notification rows can be addressed to one member, one operational role/team,
-- one email-matched member, or the whole organization. Enforce that visibility
-- in Postgres rather than returning all tenant notifications for client filtering.
drop policy if exists notifications_select_current_org on public.notifications;
create policy notifications_select_current_org on public.notifications
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (
    recipient_member_id = (select private.current_member_id())
    or (
      recipient_member_id is null
      and recipient_team <> ''
      and exists (
        select 1
        from public.member_roles as member_role
        join public.roles as role on role.id = member_role.role_id
        where member_role.member_id = (select private.current_member_id())
          and role.organization_id = notifications.organization_id
          and role.slug = notifications.recipient_team
      )
    )
    or (
      recipient_member_id is null
      and recipient_team = ''
      and (
        recipient_email = ''
        or exists (
          select 1 from public.organization_members as member
          where member.id = (select private.current_member_id())
            and lower(member.email) = lower(notifications.recipient_email)
        )
      )
    )
  )
);

drop policy if exists notifications_update_current_org on public.notifications;
create policy notifications_update_current_org on public.notifications
for update to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (
    recipient_member_id = (select private.current_member_id())
    or (
      recipient_member_id is null
      and recipient_team <> ''
      and exists (
        select 1
        from public.member_roles as member_role
        join public.roles as role on role.id = member_role.role_id
        where member_role.member_id = (select private.current_member_id())
          and role.organization_id = notifications.organization_id
          and role.slug = notifications.recipient_team
      )
    )
    or (
      recipient_member_id is null
      and recipient_team = ''
      and (
        recipient_email = ''
        or exists (
          select 1 from public.organization_members as member
          where member.id = (select private.current_member_id())
            and lower(member.email) = lower(notifications.recipient_email)
        )
      )
    )
  )
)
with check (organization_id = (select private.current_organization_id()));

-- Reset derived guidance when a stage changes so an earlier stage's action is
-- never carried into the new operational state.
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
    when tg_op = 'INSERT' or old.workflow_stage is distinct from derived_stage then coalesce(derived_next_action, '')
    else coalesce(nullif(new.next_action, ''), derived_next_action, '')
  end;
  new.current_step := case
    when derived_stage = 'generation_in_progress' then 'Generating pose set'
    when derived_stage = 'quality_review' then 'Human five-pose review'
    when derived_stage in ('sent_to_listing_team','listing_in_progress') then 'Marketplace listing'
    when tg_op = 'INSERT' or old.workflow_stage is distinct from derived_stage then coalesce(derived_next_action, '')
    else coalesce(nullif(new.current_step, ''), derived_next_action, '')
  end;
  new.asset_folder_key := coalesce(nullif(new.asset_folder_key, ''), new.organization_id::text || '/' || new.id::text || '/approved');
  return new;
end;
$$;

revoke all on function private.enrich_catalog_workflow_state() from public, anon, authenticated;
grant execute on function private.enrich_catalog_workflow_state() to service_role, postgres;

-- A newly completed regeneration becomes the only reviewable current version;
-- earlier approvals or rejections stay immutable in history as superseded rows.
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
  target_version_id uuid;
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
    updated_at = now()
  returning id into target_version_id;

  if target_version = (
    select max(version.version_number)
    from public.catalog_pose_asset_versions as version
    where version.work_item_id = target.id and version.pose_index = new.pose_index
  ) then
    update public.catalog_pose_asset_versions as previous_version
    set approval_status = 'superseded', updated_at = now()
    where previous_version.work_item_id = target.id
      and previous_version.pose_index = new.pose_index
      and previous_version.id <> target_version_id
      and previous_version.approval_status in ('approved','rejected');
  end if;
  return new;
end;
$$;

revoke all on function private.sync_catalog_pose_asset_version() from public, anon, authenticated;
grant execute on function private.sync_catalog_pose_asset_version() to service_role, postgres;

-- Abort deployment if any V2 tenant table is exposed without RLS/current-org
-- reads, if browser mutation grants slipped in, or if the private bucket lost
-- one of its tenant-prefix policies.
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
    if not coalesce((
      select class.relrowsecurity
      from pg_class as class
      join pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public' and class.relname = table_name
    ), false) then
      raise exception 'Catalog Workflow V2 security assertion failed: %.% does not have RLS enabled', 'public', table_name;
    end if;
    if not exists (
      select 1 from pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = table_name
        and policy.cmd = 'SELECT'
        and 'authenticated' = any(policy.roles)
        and coalesce(policy.qual, '') like '%current_organization_id%'
    ) then
      raise exception 'Catalog Workflow V2 security assertion failed: %.% has no tenant read policy', 'public', table_name;
    end if;
    if has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
       or has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then
      raise exception 'Catalog Workflow V2 security assertion failed: authenticated can mutate %.% directly', 'public', table_name;
    end if;
  end loop;

  if not exists (select 1 from storage.buckets where id = 'catalog-assets' and public = false) then
    raise exception 'Catalog Workflow V2 security assertion failed: catalog-assets must be a private bucket';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'catalog_assets_%_current_org') <> 4 then
    raise exception 'Catalog Workflow V2 security assertion failed: catalog-assets needs four tenant path policies';
  end if;
end
$$;
