-- Keep legacy Planning records recoverable while removing them from the active
-- queue. Generated images and generation history are intentionally untouched.
alter table public.planning_batches
  add column if not exists archived_at timestamptz;

alter table public.planning_requests
  add column if not exists archived_at timestamptz;

alter table public.catalog_work_items
  add column if not exists archived_at timestamptz;

create index if not exists planning_batches_active_created_idx
  on public.planning_batches (organization_id, created_at desc)
  where archived_at is null;

create index if not exists planning_requests_active_updated_idx
  on public.planning_requests (organization_id, updated_at desc)
  where archived_at is null;

create index if not exists catalog_work_items_active_created_idx
  on public.catalog_work_items (organization_id, created_at desc)
  where archived_at is null;

-- This is a reversible, data-preserving cleanup for the six legacy rows shown
-- in the Planning screenshot. It uses stable business identifiers instead of
-- generated UUIDs and only matches the completed 2 Aug 2026 Begum batch that
-- contains the complete six-SKU set.
with legacy_batches as (
  select b.id
  from public.planning_batches b
  join public.planning_requests r on r.batch_id = b.id
  where b.name = 'Begum -  Sawan'
    and b.created_at >= '2026-08-02T00:00:00Z'::timestamptz
    and b.created_at < '2026-08-03T00:00:00Z'::timestamptz
    and r.request_code = any (array[
      'B-2026-001-0001', 'B-2026-001-0002', 'B-2026-001-0003',
      'B-2026-001-0004', 'B-2026-001-0005', 'B-2026-001-0006'
    ]::text[])
  group by b.id
  having count(distinct r.request_code) = 6
), archived_batches as (
  update public.planning_batches b
  set archived_at = coalesce(b.archived_at, now()), updated_at = now()
  where b.id in (select id from legacy_batches)
  returning b.id
), archived_requests as (
  update public.planning_requests r
  set archived_at = coalesce(r.archived_at, now()), updated_at = now()
  where r.batch_id in (select id from legacy_batches)
  returning r.id
)
update public.catalog_work_items w
set archived_at = coalesce(w.archived_at, now()), updated_at = now()
where w.planning_batch_id in (select id from legacy_batches);
