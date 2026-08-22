-- Replacing the state normalizer in a forward migration keeps the already
-- deployed Catalog Production migration immutable while making regeneration
-- reopen completed or failed work.
create or replace function private.normalize_catalog_work_item_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  new.updated_at := now();

  -- Clear downstream state when a deliberate retry/regeneration begins. Without
  -- this, a row that reached Listing Done remains visually completed while its
  -- replacement assets are being generated.
  if new.generation_status in ('ready', 'queued', 'generating')
     and old.generation_status is distinct from new.generation_status then
    new.status := 'in_progress';
    new.generation_completed_at := null;
    new.qc_status := 'not_started';
    new.listing_status := 'not_required';
    new.listing_started_at := null;
    new.listing_completed_at := null;
    new.completed_at := null;
  end if;

  if new.generation_status in ('queued', 'generating')
     and old.generation_status is distinct from new.generation_status then
    new.generation_started_at := coalesce(new.generation_started_at, now());
    if new.status <> 'blocked' then new.status := 'in_progress'; end if;
  end if;

  if new.generation_status = 'completed'
     and old.generation_status is distinct from 'completed' then
    new.generation_started_at := coalesce(new.generation_started_at, old.generation_started_at, now());
    new.generation_completed_at := coalesce(new.generation_completed_at, now());
    if new.qc_status in ('not_started', 'pending') then new.qc_status := 'needs_review'; end if;
    if new.listing_status not in ('completed', 'not_required') then new.listing_status := 'pending'; end if;
    if new.listing_status = 'not_required' then new.listing_status := 'pending'; end if;
    if new.status <> 'blocked' then new.status := 'in_progress'; end if;
  end if;

  if new.generation_status = 'failed'
     and old.generation_status is distinct from 'failed' then
    new.status := 'blocked';
  end if;

  if new.qc_status = 'passed' and old.qc_status is distinct from 'passed' then
    if new.generation_status <> 'completed' then
      raise exception 'QC cannot pass before generation is completed';
    end if;
    new.listing_status := case when new.listing_status = 'completed' then 'completed' else 'pending' end;
    new.listing_started_at := coalesce(new.listing_started_at, now());
    if new.status <> 'blocked' then new.status := 'in_progress'; end if;
  end if;

  if new.listing_status = 'completed'
     and old.listing_status is distinct from 'completed' then
    if new.generation_status <> 'completed' or new.qc_status <> 'passed' then
      raise exception 'Listing cannot complete until generation is complete and QC has passed';
    end if;
    new.listing_started_at := coalesce(new.listing_started_at, old.listing_started_at, now());
    new.listing_completed_at := coalesce(new.listing_completed_at, now());
    new.completed_at := coalesce(new.completed_at, new.listing_completed_at, now());
    new.status := 'completed';
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_catalog_work_item_state() from public, anon, authenticated;
grant execute on function private.normalize_catalog_work_item_state() to service_role, postgres;
