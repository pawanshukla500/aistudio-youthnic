-- Reference-led pose planning (Pose 4 "creative" and Pose 6 "showcase").
--
-- The LangGraph planner (FastAPI /api/v1/plan) decides per slot whether to copy
-- the STYLE REFERENCE person's posture or keep the product-led pose. Each
-- finished job records how that decision fared (DNA consistency check and human
-- review) so later plans prefer what worked for the same garment family,
-- bottom cut, posture and distinctiveness.

create table if not exists public.pose_plan_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- pose_family|bottom_cut_class|slot_id|source|posture|distinctiveness
  outcome_key text not null,
  pose_family text not null default '',
  bottom_cut_class text not null default '',
  slot_id text not null check (slot_id in ('creative', 'showcase')),
  source text not null check (source in ('reference', 'product')),
  posture text not null default 'none',
  distinctiveness text not null default 'generic',
  use_count integer not null default 0 check (use_count >= 0),
  dna_pass_count integer not null default 0 check (dna_pass_count >= 0),
  dna_fail_count integer not null default 0 check (dna_fail_count >= 0),
  dna_score_avg numeric(5, 2),
  human_approved_count integer not null default 0 check (human_approved_count >= 0),
  human_rejected_count integer not null default 0 check (human_rejected_count >= 0),
  -- Best-scoring plan seen for this key: { directive, expression, dnaScore, sessionId }.
  best_plan jsonb not null default '{}'::jsonb,
  -- catalog_sessions.session_id ("session_<uuid>"), not a uuid.
  last_session_id text,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, outcome_key)
);

create index if not exists pose_plan_outcomes_org_family_idx
  on public.pose_plan_outcomes (organization_id, pose_family, slot_id);

alter table public.pose_plan_outcomes enable row level security;

drop policy if exists pose_plan_outcomes_select_current_org on public.pose_plan_outcomes;
create policy pose_plan_outcomes_select_current_org on public.pose_plan_outcomes
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.view'))
);

revoke all on public.pose_plan_outcomes from public, anon;
revoke insert, update, delete on public.pose_plan_outcomes from authenticated;
grant select on public.pose_plan_outcomes to authenticated;
grant all on public.pose_plan_outcomes to service_role;

-- Per-job ledger: the pose plan that was used and the per-pose scores it earned.
alter table public.generation_learnings
  add column if not exists pose_planning jsonb not null default '{}'::jsonb,
  add column if not exists pose_scores jsonb not null default '{}'::jsonb;
