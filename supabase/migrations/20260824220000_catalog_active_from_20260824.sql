-- Keep Catalog Production and Planning focused on the new operational cutover.
-- This is intentionally a reversible archive, not a delete: generation history,
-- planning assets, and Firebase-backed outputs remain available in History.
-- The cutoff is the start of today in the configured Asia/Kolkata workspace timezone.

update public.planning_batches
set archived_at = coalesce(archived_at, now()),
    updated_at = now()
where archived_at is null
  and created_at < '2026-08-24T00:00:00+05:30'::timestamptz;

update public.planning_requests
set archived_at = coalesce(archived_at, now()),
    updated_at = now()
where archived_at is null
  and created_at < '2026-08-24T00:00:00+05:30'::timestamptz;

update public.catalog_work_items
set archived_at = coalesce(archived_at, now()),
    updated_at = now()
where archived_at is null
  and created_at < '2026-08-24T00:00:00+05:30'::timestamptz;
