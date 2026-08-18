-- Structured memory for styling decisions: what the AI proposed, what a human
-- approved, and which fields they had to change. This is deliberately not another
-- write-only log - the analysis stage reads it back as house preference, so a
-- correction made once stops having to be made again.

create table if not exists public.styling_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope text not null check (scope in ('studio', 'catalog')),
  batch_id uuid references public.planning_batches(id) on delete set null,
  planning_request_id uuid references public.planning_requests(id) on delete set null,
  session_id text not null default '',
  category text not null default '',
  theme_summary text not null default '',
  ai_plan jsonb not null default '{}'::jsonb,
  approved_plan jsonb not null default '{}'::jsonb,
  changed_fields text[] not null default '{}'::text[],
  approved boolean not null default false,
  decided_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The retrieval path is always "recent decisions for this organization and
-- category", newest first, so that is the index.
create index if not exists styling_decisions_org_category_idx
  on public.styling_decisions (organization_id, category, created_at desc);

-- Corrections are the valuable rows: the ones where a human disagreed with the AI.
create index if not exists styling_decisions_corrections_idx
  on public.styling_decisions (organization_id, created_at desc)
  where array_length(changed_fields, 1) > 0;

alter table public.styling_decisions enable row level security;

drop policy if exists styling_decisions_select_current_org on public.styling_decisions;
create policy styling_decisions_select_current_org on public.styling_decisions
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.view'))
);

revoke all on public.styling_decisions from anon;
revoke insert, update, delete on public.styling_decisions from authenticated;
grant select on public.styling_decisions to authenticated;
grant all on public.styling_decisions to service_role;
