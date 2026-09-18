-- The catalog shoot grew from five frames to six (the garment-led "showcase"
-- frame). Both catalog tables hard-capped pose_index at 5, so a sixth
-- completed pose would fail its insert and strand the work item.
--
-- The new ceiling is deliberately higher than six: relaxing this bound again
-- later is a migration nobody should have to write for one extra frame.
alter table public.catalog_pose_asset_versions
  drop constraint if exists catalog_pose_asset_versions_pose_index_check;

alter table public.catalog_pose_asset_versions
  add constraint catalog_pose_asset_versions_pose_index_check
  check (pose_index between 1 and 12);

alter table public.catalog_listing_handoff_assets
  drop constraint if exists catalog_listing_handoff_assets_pose_index_check;

alter table public.catalog_listing_handoff_assets
  add constraint catalog_listing_handoff_assets_pose_index_check
  check (pose_index between 1 and 12);

-- Existing jobs keep the pose count they were queued with. Only the column
-- default moves, so a newly queued shoot records six frames when the caller
-- does not send an explicit count.
alter table public.generation_jobs
  alter column total_poses set default 6;
