create table if not exists public.generation_flow_nodes (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.catalog_sessions(session_id) on delete cascade,
  node_type text not null,
  status text not null default 'pending',
  inputs jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  logs text[] not null default '{}',
  attempt integer not null default 1,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
);

create table if not exists public.generation_flow_edges (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.catalog_sessions(session_id) on delete cascade,
  source_node_id uuid not null references public.generation_flow_nodes(id) on delete cascade,
  target_node_id uuid not null references public.generation_flow_nodes(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Indexes for efficient orchestration lookup
create index if not exists idx_gen_flow_nodes_session on public.generation_flow_nodes(session_id);
create index if not exists idx_gen_flow_nodes_status on public.generation_flow_nodes(status);
create index if not exists idx_gen_flow_edges_session on public.generation_flow_edges(session_id);
create index if not exists idx_gen_flow_edges_target on public.generation_flow_edges(target_node_id);

-- Enable RLS
alter table public.generation_flow_nodes enable row level security;
alter table public.generation_flow_edges enable row level security;

-- Basic policies for owners (inheriting from catalog_sessions)
drop policy if exists generation_flow_nodes_select_owner on public.generation_flow_nodes;
create policy generation_flow_nodes_select_owner on public.generation_flow_nodes
  for select
  using (
    exists (
      select 1 from public.catalog_sessions s
      where s.session_id = generation_flow_nodes.session_id
      and s.organization_id in (select organization_id from app_current_user_memberships())
    )
  );

drop policy if exists generation_flow_edges_select_owner on public.generation_flow_edges;
create policy generation_flow_edges_select_owner on public.generation_flow_edges
  for select
  using (
    exists (
      select 1 from public.catalog_sessions s
      where s.session_id = generation_flow_edges.session_id
      and s.organization_id in (select organization_id from app_current_user_memberships())
    )
  );
