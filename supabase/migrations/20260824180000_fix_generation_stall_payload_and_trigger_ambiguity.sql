-- The catalog tenant trigger used a PL/pgSQL variable named `payload`. When a
-- tenant check queried a table that also has a payload column, PostgreSQL
-- resolved the reference ambiguously and rejected otherwise valid job/status
-- updates. Keep the trigger security boundary, but use an unambiguous name.
create or replace function private.enforce_catalog_tenant_relationships()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  row_payload jsonb := to_jsonb(new);
  org_id uuid := (row_payload ->> 'organization_id')::uuid;
  member_column text;
  member_value text;
  team_column text;
  team_value text;
begin
  foreach member_column in array array[
    'created_by_member_id', 'generation_assigned_member_id', 'listing_assigned_member_id',
    'final_approved_by_member_id', 'actor_member_id', 'author_member_id',
    'approved_by_member_id', 'reviewer_member_id', 'updated_by_member_id',
    'member_id', 'assigned_by_member_id'
  ]
  loop
    if row_payload ? member_column then
      member_value := row_payload ->> member_column;
      if coalesce(member_value, '') <> '' and not exists (
        select 1 from public.organization_members as member
        where member.id::text = member_value and member.organization_id = org_id
      ) then
        raise exception 'Catalog tenant relationship violation: % does not belong to organization %', member_column, org_id;
      end if;
    end if;
  end loop;

  foreach team_column in array array['team_id', 'recipient_team_id']
  loop
    if row_payload ? team_column then
      team_value := row_payload ->> team_column;
      if coalesce(team_value, '') <> '' and not exists (
        select 1 from public.organization_teams as team
        where team.id::text = team_value and team.organization_id = org_id
      ) then
        raise exception 'Catalog tenant relationship violation: % does not belong to organization %', team_column, org_id;
      end if;
    end if;
  end loop;

  if coalesce(row_payload ->> 'work_item_id', '') <> '' and not exists (
    select 1 from public.catalog_work_items as item
    where item.id::text = row_payload ->> 'work_item_id' and item.organization_id = org_id
  ) then raise exception 'Catalog tenant relationship violation: work item'; end if;
  if coalesce(row_payload ->> 'planning_request_id', '') <> '' and not exists (
    select 1 from public.planning_requests as request
    where request.id::text = row_payload ->> 'planning_request_id' and request.organization_id = org_id
  ) then raise exception 'Catalog tenant relationship violation: planning request'; end if;
  if coalesce(row_payload ->> 'planning_batch_id', '') <> '' and not exists (
    select 1 from public.planning_batches as batch
    where batch.id::text = row_payload ->> 'planning_batch_id' and batch.organization_id = org_id
  ) then raise exception 'Catalog tenant relationship violation: planning batch'; end if;
  if coalesce(row_payload ->> 'event_id', '') <> '' and not exists (
    select 1 from public.marketing_events as event
    where event.id::text = row_payload ->> 'event_id' and event.organization_id = org_id
  ) then raise exception 'Catalog tenant relationship violation: campaign event'; end if;
  if coalesce(row_payload ->> 'asset_version_id', '') <> '' and not exists (
    select 1 from public.catalog_pose_asset_versions as asset
    where asset.id::text = row_payload ->> 'asset_version_id' and asset.organization_id = org_id
  ) then raise exception 'Catalog tenant relationship violation: asset version'; end if;
  if coalesce(row_payload ->> 'related_asset_version_id', '') <> '' and not exists (
    select 1 from public.catalog_pose_asset_versions as asset
    where asset.id::text = row_payload ->> 'related_asset_version_id' and asset.organization_id = org_id
  ) then raise exception 'Catalog tenant relationship violation: related asset version'; end if;
  if coalesce(row_payload ->> 'handoff_id', '') <> '' and not exists (
    select 1 from public.catalog_listing_handoffs as handoff
    where handoff.id::text = row_payload ->> 'handoff_id' and handoff.organization_id = org_id
  ) then raise exception 'Catalog tenant relationship violation: handoff'; end if;
  if coalesce(row_payload ->> 'delivery_id', '') <> '' and not exists (
    select 1 from public.catalog_report_deliveries as delivery
    where delivery.id::text = row_payload ->> 'delivery_id' and delivery.organization_id = org_id
  ) then raise exception 'Catalog tenant relationship violation: delivery'; end if;
  return new;
end;
$function$;

revoke all on function private.enforce_catalog_tenant_relationships() from public, anon, authenticated;
grant execute on function private.enforce_catalog_tenant_relationships() to service_role, postgres;

-- A stale worker with no queued/processing poses must not be requeued forever.
-- Recover it as a terminal failure and leave the generated/paid history intact.
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
      when not exists (
        select 1 from public.session_generations as pose
        where pose.session_id = stale_job.session_id
          and pose.status in ('queued', 'processing')
      ) then 'failed'
      when stale_job.attempt_count < 3 then 'queued'
      else 'failed'
    end;
    recovery_message := case
      when next_status = 'queued' then 'The previous worker reached its runtime limit. The same pose was safely requeued.'
      when next_status = 'cancelled' then 'Generation cancellation completed after the worker lease expired.'
      else 'Generation worker lease expired with no active pose remaining.'
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

revoke all on function public.recover_stale_generation_jobs() from public, anon, authenticated;
grant execute on function public.recover_stale_generation_jobs() to service_role;

create index if not exists generation_learnings_org_category_created_idx
  on public.generation_learnings (organization_id, product_category, created_at desc);
