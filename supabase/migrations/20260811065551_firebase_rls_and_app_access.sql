-- Firebase Auth remains the identity source. This migration exposes only the
-- rows belonging to the active Firebase member's organization.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.current_firebase_uid()
returns text
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select nullif(auth.jwt() ->> 'sub', '');
$$;

create or replace function private.is_expected_firebase_jwt()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select
    auth.jwt() ->> 'role' = 'authenticated'
    and auth.jwt() ->> 'iss' = 'https://securetoken.google.com/ai-studio-app-be068'
    and auth.jwt() ->> 'aud' = 'ai-studio-app-be068';
$$;

create or replace function private.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select member.id
  from public.organization_members as member
  where private.is_expected_firebase_jwt()
    and member.firebase_uid = private.current_firebase_uid()
    and member.status = 'active'
  limit 1;
$$;

create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select member.organization_id
  from public.organization_members as member
  where member.id = private.current_member_id()
    and member.status = 'active'
  limit 1;
$$;

create or replace function private.has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(bool_or(role.slug = 'admin' or permission.key = required_permission), false)
  from public.organization_members as member
  join public.member_roles as member_role on member_role.member_id = member.id
  join public.roles as role on role.id = member_role.role_id
  left join public.role_permissions as role_permission on role_permission.role_id = role.id
  left join public.permissions as permission on permission.id = role_permission.permission_id
  where member.id = private.current_member_id()
    and member.status = 'active';
$$;

revoke all on function private.current_firebase_uid() from public;
revoke all on function private.is_expected_firebase_jwt() from public;
revoke all on function private.current_member_id() from public;
revoke all on function private.current_organization_id() from public;
revoke all on function private.has_permission(text) from public;
grant execute on function private.current_firebase_uid() to authenticated, service_role;
grant execute on function private.is_expected_firebase_jwt() to authenticated, service_role;
grant execute on function private.current_member_id() to authenticated, service_role;
grant execute on function private.current_organization_id() to authenticated, service_role;
grant execute on function private.has_permission(text) to authenticated, service_role;

-- The new Studio distinguishes all product and style-reference roles. Existing
-- rows already use values in this expanded set.
alter table public.planning_assets
  drop constraint if exists planning_assets_asset_role_check;
alter table public.planning_assets
  add constraint planning_assets_asset_role_check check (
    asset_role = any (array[
      'front'::text,
      'back'::text,
      'fabric_pattern'::text,
      'additional_product'::text,
      'style_reference'::text,
      'model_identity'::text,
      'catalog_reference'::text,
      'reference'::text,
      'generated'::text
    ])
  );

-- RLS is enabled on every table in the exposed public schema. Tables without
-- an authenticated grant remain server-only and continue to work through the
-- secret/service role used by backend jobs.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ai_runs','analysis_cache','app_audit_logs','app_settings','app_system_settings',
    'audit_logs','batch_approvals','catalog_sessions','event_research_runs',
    'execution_events','fashion_knowledge_base','generation_jobs',
    'generation_learnings','learning_daily_digests','marketing_events',
    'marketplace_campaign_catalog','member_roles','notifications',
    'organization_members','organizations','permissions','planning_assets',
    'planning_batches','planning_requests','prompt_patterns','prompt_versions',
    'qa_reviews','regional_festival_catalog','role_permissions','roles',
    'scene_analyses','session_generations','visual_attributes'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

-- Explicit Data API grants. The 2026 Supabase defaults no longer expose new
-- public tables automatically, so grants and RLS are deliberately paired.
grant select on table
  public.organizations,
  public.organization_members,
  public.roles,
  public.permissions,
  public.role_permissions,
  public.member_roles,
  public.planning_batches,
  public.planning_requests,
  public.planning_assets,
  public.notifications,
  public.marketing_events,
  public.marketplace_campaign_catalog,
  public.regional_festival_catalog,
  public.event_research_runs,
  public.ai_runs,
  public.analysis_cache,
  public.generation_learnings,
  public.learning_daily_digests,
  public.fashion_knowledge_base,
  public.prompt_patterns,
  public.prompt_versions,
  public.audit_logs,
  public.execution_events,
  public.qa_reviews,
  public.visual_attributes,
  public.catalog_sessions,
  public.generation_jobs,
  public.scene_analyses,
  public.session_generations
to authenticated;

grant insert, update, delete on table
  public.planning_batches,
  public.planning_requests,
  public.planning_assets
to authenticated;

grant update (read_at, status) on table public.notifications to authenticated;
grant insert on table public.batch_approvals to authenticated;
grant select on table public.batch_approvals to authenticated;
grant insert, update, delete on table public.marketing_events to authenticated;

-- Workspace and RBAC reads.
drop policy if exists organizations_select_current on public.organizations;
create policy organizations_select_current on public.organizations
for select to authenticated
using (id = (select private.current_organization_id()));

drop policy if exists organization_members_select_current_org on public.organization_members;
create policy organization_members_select_current_org on public.organization_members
for select to authenticated
using (organization_id = (select private.current_organization_id()));

drop policy if exists roles_select_current_org on public.roles;
create policy roles_select_current_org on public.roles
for select to authenticated
using (organization_id = (select private.current_organization_id()));

drop policy if exists permissions_select_authenticated_member on public.permissions;
create policy permissions_select_authenticated_member on public.permissions
for select to authenticated
using ((select private.current_member_id()) is not null);

drop policy if exists role_permissions_select_current_org on public.role_permissions;
create policy role_permissions_select_current_org on public.role_permissions
for select to authenticated
using (exists (
  select 1 from public.roles as role
  where role.id = role_permissions.role_id
    and role.organization_id = (select private.current_organization_id())
));

drop policy if exists member_roles_select_current_org on public.member_roles;
create policy member_roles_select_current_org on public.member_roles
for select to authenticated
using (exists (
  select 1 from public.organization_members as member
  where member.id = member_roles.member_id
    and member.organization_id = (select private.current_organization_id())
));

-- Organization-scoped operational reads.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'audit_logs','batch_approvals','execution_events','notifications',
    'planning_assets','planning_batches','planning_requests','qa_reviews','visual_attributes'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_current_org', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id = (select private.current_organization_id()))',
      table_name || '_select_current_org', table_name
    );
  end loop;
end;
$$;

-- Global learning rows (organization_id null) are shared; organization rows
-- are isolated. They are read-only from the browser and written by backend jobs.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ai_runs','analysis_cache','event_research_runs','fashion_knowledge_base',
    'generation_learnings','learning_daily_digests','marketing_events',
    'prompt_patterns','prompt_versions'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_visible', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id is null or organization_id = (select private.current_organization_id()))',
      table_name || '_select_visible', table_name
    );
  end loop;
end;
$$;

drop policy if exists marketplace_campaign_catalog_select_member on public.marketplace_campaign_catalog;
create policy marketplace_campaign_catalog_select_member on public.marketplace_campaign_catalog
for select to authenticated
using ((select private.current_member_id()) is not null);

drop policy if exists regional_festival_catalog_select_member on public.regional_festival_catalog;
create policy regional_festival_catalog_select_member on public.regional_festival_catalog
for select to authenticated
using ((select private.current_member_id()) is not null);

-- Legacy session-operation tables use Firebase UID/text organization keys.
drop policy if exists catalog_sessions_select_owner on public.catalog_sessions;
create policy catalog_sessions_select_owner on public.catalog_sessions
for select to authenticated
using (user_id = (select private.current_firebase_uid()));

drop policy if exists generation_jobs_select_owner_or_org on public.generation_jobs;
create policy generation_jobs_select_owner_or_org on public.generation_jobs
for select to authenticated
using (
  user_id = (select private.current_firebase_uid())
  or org_id = coalesce((select private.current_organization_id())::text, '')
);

drop policy if exists scene_analyses_select_owner on public.scene_analyses;
create policy scene_analyses_select_owner on public.scene_analyses
for select to authenticated
using (user_id = (select private.current_firebase_uid()));

drop policy if exists session_generations_select_owner on public.session_generations;
create policy session_generations_select_owner on public.session_generations
for select to authenticated
using (exists (
  select 1 from public.catalog_sessions as session
  where session.session_id = session_generations.session_id
    and session.user_id = (select private.current_firebase_uid())
));

-- Planning writes are permission-gated and cannot change organization ownership.
drop policy if exists planning_batches_insert on public.planning_batches;
create policy planning_batches_insert on public.planning_batches
for insert to authenticated
with check (
  organization_id = (select private.current_organization_id())
  and ((select private.has_permission('planning.create')) or (select private.has_permission('planning.manage')))
);
drop policy if exists planning_batches_update on public.planning_batches;
create policy planning_batches_update on public.planning_batches
for update to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.manage'))
)
with check (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.manage'))
);
drop policy if exists planning_batches_delete on public.planning_batches;
create policy planning_batches_delete on public.planning_batches
for delete to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.manage'))
);

drop policy if exists planning_requests_insert on public.planning_requests;
create policy planning_requests_insert on public.planning_requests
for insert to authenticated
with check (
  organization_id = (select private.current_organization_id())
  and ((select private.has_permission('planning.create')) or (select private.has_permission('planning.manage')))
);
drop policy if exists planning_requests_update on public.planning_requests;
create policy planning_requests_update on public.planning_requests
for update to authenticated
using (
  organization_id = (select private.current_organization_id())
  and ((select private.has_permission('planning.create')) or (select private.has_permission('planning.manage')))
)
with check (
  organization_id = (select private.current_organization_id())
  and ((select private.has_permission('planning.create')) or (select private.has_permission('planning.manage')))
);
drop policy if exists planning_requests_delete on public.planning_requests;
create policy planning_requests_delete on public.planning_requests
for delete to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.manage'))
);

drop policy if exists planning_assets_insert on public.planning_assets;
create policy planning_assets_insert on public.planning_assets
for insert to authenticated
with check (
  organization_id = (select private.current_organization_id())
  and (
    (select private.has_permission('planning.create'))
    or (select private.has_permission('planning.manage'))
    or (select private.has_permission('studio.generate'))
  )
);
drop policy if exists planning_assets_update on public.planning_assets;
create policy planning_assets_update on public.planning_assets
for update to authenticated
using (
  organization_id = (select private.current_organization_id())
  and ((select private.has_permission('planning.manage')) or (select private.has_permission('studio.generate')))
)
with check (
  organization_id = (select private.current_organization_id())
  and ((select private.has_permission('planning.manage')) or (select private.has_permission('studio.generate')))
);
drop policy if exists planning_assets_delete on public.planning_assets;
create policy planning_assets_delete on public.planning_assets
for delete to authenticated
using (
  organization_id = (select private.current_organization_id())
  and ((select private.has_permission('planning.manage')) or (select private.has_permission('studio.generate')))
);

drop policy if exists notifications_update_current_org on public.notifications;
create policy notifications_update_current_org on public.notifications
for update to authenticated
using (organization_id = (select private.current_organization_id()))
with check (organization_id = (select private.current_organization_id()));

drop policy if exists batch_approvals_insert on public.batch_approvals;
create policy batch_approvals_insert on public.batch_approvals
for insert to authenticated
with check (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.approve'))
);

drop policy if exists marketing_events_insert on public.marketing_events;
create policy marketing_events_insert on public.marketing_events
for insert to authenticated
with check (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.manage'))
);
drop policy if exists marketing_events_update on public.marketing_events;
create policy marketing_events_update on public.marketing_events
for update to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.manage'))
)
with check (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.manage'))
);
drop policy if exists marketing_events_delete on public.marketing_events;
create policy marketing_events_delete on public.marketing_events
for delete to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.manage'))
);

-- Realtime is limited to the status-bearing tables used by the new UI.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'planning_batches','planning_requests','planning_assets','notifications','generation_jobs'
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
end;
$$;
