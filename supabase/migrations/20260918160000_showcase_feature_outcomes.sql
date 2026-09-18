-- Feedback for the sixth frame's subject choice.
--
-- The vision analysis now picks what the sixth frame sells, per SKU. This table
-- records how those choices were received so the next analysis can break ties
-- with evidence instead of repeating a framing operators keep sending back.
--
-- One row per (organization, category, garment family, feature region, shot
-- type). It is house taste, never product truth: prompt selection treats it as
-- advice that the current product references always outrank.
create table if not exists public.showcase_feature_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_category text not null,
  garment_family text not null default '',
  feature_region text not null,
  shot_type text not null,
  -- A human kept the frame (approved the pose version or the whole set).
  selected_count integer not null default 0 check (selected_count >= 0),
  -- A human rejected it outright.
  rejected_count integer not null default 0 check (rejected_count >= 0),
  -- A human asked for the same subject to be shot again.
  regenerated_count integer not null default 0 check (regenerated_count >= 0),
  -- Automatic QA refused it.
  qa_failed_count integer not null default 0 check (qa_failed_count >= 0),
  avg_quality numeric(5, 2),
  last_feedback_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_category, garment_family, feature_region, shot_type)
);

create index if not exists showcase_feature_outcomes_org_category_idx
  on public.showcase_feature_outcomes (organization_id, product_category, garment_family);
create index if not exists showcase_feature_outcomes_selected_idx
  on public.showcase_feature_outcomes (selected_count desc);

alter table public.showcase_feature_outcomes enable row level security;

create policy showcase_feature_outcomes_select_current_org on public.showcase_feature_outcomes
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.view'))
);

revoke all on public.showcase_feature_outcomes from public, anon;
revoke insert, update, delete on public.showcase_feature_outcomes from authenticated;
grant select on public.showcase_feature_outcomes to authenticated;
grant all on public.showcase_feature_outcomes to service_role;
