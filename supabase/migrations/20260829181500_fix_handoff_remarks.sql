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
    coalesce(new.remarks, '')
  )
  on conflict (work_item_id, approval_revision) do update set
    status = 'ready',
    folder_key = excluded.folder_key,
    approved_at = excluded.approved_at,
    approved_by_member_id = excluded.approved_by_member_id,
    remarks = excluded.remarks,
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
