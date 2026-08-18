-- catalog_memory is written from several places at once: preflight proposing a
-- styling plan, a stylist approving one, and a finishing job recording the anchor
-- frame. Reading the object into app code and writing it back whole means the
-- last writer silently drops whatever the others added in between - and two
-- preflights racing on the same batch could each believe they were the first to
-- propose a plan. Merge in the database instead, in one statement.

create or replace function public.merge_catalog_memory(
  p_batch_id uuid,
  p_patch jsonb,
  p_require_absent text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.planning_batches
  set catalog_memory = coalesce(catalog_memory, '{}'::jsonb) || p_patch,
      updated_at = now()
  where id = p_batch_id
    -- First writer wins: with p_require_absent set, the update matches no row
    -- once that key exists, so a concurrent proposal cannot overwrite it.
    and (
      p_require_absent is null
      or coalesce(catalog_memory, '{}'::jsonb) -> p_require_absent is null
    )
  returning catalog_memory;
$$;

revoke all on function public.merge_catalog_memory(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.merge_catalog_memory(uuid, jsonb, text) to service_role;
