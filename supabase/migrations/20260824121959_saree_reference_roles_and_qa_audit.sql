-- Sarees need region-specific product evidence. Keep every legacy role valid so
-- existing Studio and catalog sessions continue to load without data rewrites.
alter table public.planning_assets
  drop constraint if exists planning_assets_asset_role_check;

alter table public.planning_assets
  add constraint planning_assets_asset_role_check check (
    asset_role = any (array[
      'front'::text,
      'back'::text,
      'fabric_pattern'::text,
      'mannequin'::text,
      'additional_product'::text,
      'saree_front_drape'::text,
      'saree_back_drape'::text,
      'saree_body_detail'::text,
      'saree_pallu_spread'::text,
      'saree_border_tassels'::text,
      'saree_blouse_front'::text,
      'saree_blouse_back_piece'::text,
      'style_reference'::text,
      'model_identity'::text,
      'catalog_reference'::text,
      'reference'::text,
      'generated'::text
    ])
  );

-- Current worker/reference code persists private Supabase objects as `supabase`
-- and spreadsheet-supplied HTTPS evidence as `external`; keep the two deployed
-- legacy values valid as well. Without this parity, a valid saree reference or
-- generated asset can fail only when the configured backend changes.
alter table public.planning_assets
  drop constraint if exists planning_assets_storage_backend_check;

alter table public.planning_assets
  add constraint planning_assets_storage_backend_check check (
    storage_backend = any (array[
      'supabase_temp'::text,
      'supabase'::text,
      'firebase'::text,
      'external'::text
    ])
  );

-- Each QA execution is an immutable audit record. The session pose keeps the
-- latest outcome for fast reads while qa_reviews retains every earlier result,
-- including reruns made after the QA policy changes.
alter table public.qa_reviews
  add column if not exists qa_version text not null default 'legacy',
  add column if not exists outcome text not null default 'legacy',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.qa_reviews
  drop constraint if exists qa_reviews_outcome_check;

alter table public.qa_reviews
  add constraint qa_reviews_outcome_check check (
    outcome = any (array[
      'automatically_verified'::text,
      'requires_human_review'::text,
      'unverified'::text,
      'rejected_by_qa'::text,
      'human_approved'::text,
      'human_rejected'::text,
      'legacy'::text
    ])
  );

-- History and QC load one job and then group its poses chronologically. Keep
-- generation_job_id as the leftmost equality column so service-role reads can
-- use the index too; tenant isolation remains enforced by the existing RLS
-- policy and organization_id stored on every row.
create index if not exists qa_reviews_job_pose_attempt_idx
  on public.qa_reviews (generation_job_id, pose_index, created_at desc);
