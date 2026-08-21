create table if not exists public.catalog_work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  
  request_code text not null default 'REQ-' || upper(substr(md5(random()::text), 1, 6)),
  request_date timestamptz not null default now(),
  
  sku_name text not null,
  color_label text,
  in_house_brand text,
  marketplace_brand text,
  
  work_type text not null default 'ai_product_listing',
  work_mode text not null default 'ai',
  shoot_reference_type text,
  portal text,
  
  priority text not null default 'normal',
  theme text,
  campaign_season text,
  
  status text not null default 'draft',
  generation_status text not null default 'not_required',
  qc_status text not null default 'not_started',
  listing_status text not null default 'not_required',
  
  generation_assigned_member_id uuid references public.organization_members(id) on delete set null,
  listing_assigned_member_id uuid references public.organization_members(id) on delete set null,
  
  generation_started_at timestamptz,
  generation_completed_at timestamptz,
  listing_started_at timestamptz,
  listing_completed_at timestamptz,
  
  ai_generation_remarks text,
  listing_action text,
  listing_team_remarks text,
  remarks text,
  
  reference_image_url text,
  legacy_external_link text,
  external_link text,
  
  planning_request_id uuid references public.planning_requests(id) on delete set null,
  planning_batch_id uuid references public.planning_batches(id) on delete set null,
  
  generation_job_id text,
  catalog_session_id text,
  event_id uuid, -- references a hypothetical roadmap_events table if it exists
  
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists catalog_work_items_org_idx on public.catalog_work_items (organization_id);
create index if not exists catalog_work_items_date_idx on public.catalog_work_items (request_date);
create index if not exists catalog_work_items_sku_idx on public.catalog_work_items (sku_name);
create index if not exists catalog_work_items_status_idx on public.catalog_work_items (status);
create index if not exists catalog_work_items_gen_status_idx on public.catalog_work_items (generation_status);
create index if not exists catalog_work_items_qc_status_idx on public.catalog_work_items (qc_status);
create index if not exists catalog_work_items_listing_status_idx on public.catalog_work_items (listing_status);
create index if not exists catalog_work_items_priority_idx on public.catalog_work_items (priority);
create index if not exists catalog_work_items_gen_job_idx on public.catalog_work_items (generation_job_id) where generation_job_id is not null;
create index if not exists catalog_work_items_request_idx on public.catalog_work_items (planning_request_id) where planning_request_id is not null;

create table if not exists public.catalog_work_item_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  work_item_id uuid references public.catalog_work_items(id) on delete cascade not null,
  
  event_type text not null,
  from_status text,
  to_status text,
  
  actor_member_id uuid references public.organization_members(id) on delete set null,
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  
  created_at timestamptz not null default now()
);

create index if not exists catalog_work_item_events_item_idx on public.catalog_work_item_events (work_item_id);

-- Metadata table for external tracking (Google Sheets)
create table if not exists public.catalog_work_item_external_sources (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid references public.catalog_work_items(id) on delete cascade not null,
  
  external_source text not null default 'google_sheet',
  external_file_id text,
  external_sheet_id text,
  external_tab_name text,
  external_row_number int,
  external_request_id text,
  external_row_hash text,
  
  last_synced_at timestamptz not null default now()
);

create unique index if not exists cwies_request_id_idx on public.catalog_work_item_external_sources (external_source, external_file_id, external_request_id) where external_request_id is not null;


-- RLS Policies
alter table public.catalog_work_items enable row level security;
alter table public.catalog_work_item_events enable row level security;
alter table public.catalog_work_item_external_sources enable row level security;

create policy catalog_work_items_select on public.catalog_work_items
  for select using (organization_id = private.current_organization_id());

create policy catalog_work_items_insert on public.catalog_work_items
  for insert with check (organization_id = private.current_organization_id());

create policy catalog_work_items_update on public.catalog_work_items
  for update using (organization_id = private.current_organization_id());

create policy catalog_work_items_delete on public.catalog_work_items
  for delete using (organization_id = private.current_organization_id());

create policy catalog_work_item_events_select on public.catalog_work_item_events
  for select using (organization_id = private.current_organization_id());

create policy catalog_work_item_events_insert on public.catalog_work_item_events
  for insert with check (organization_id = private.current_organization_id());

create policy cwies_select on public.catalog_work_item_external_sources
  for select using (
    work_item_id in (
      select id from public.catalog_work_items where organization_id = private.current_organization_id()
    )
  );
