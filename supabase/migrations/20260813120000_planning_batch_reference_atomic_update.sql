-- saveReferenceOperation and removeCatalogStyleReferenceOperation both used to read
-- planning_batches.reference_images into app code, transform it (filter/append), and write
-- the whole array back with a plain UPDATE. Two concurrent calls against the same catalog
-- (e.g. one member uploading a model reference while another removes a style reference)
-- could each read the same starting array and the second write would silently clobber the
-- first's change - a classic lost-update race. Do the read-modify-write as one atomic
-- statement in the database instead, where Postgres's own row lock on the UPDATE serializes
-- concurrent callers. Also returns the entries this call actually removed/replaced, so the
-- caller can best-effort clean up their now-orphaned Firebase Storage objects.

create or replace function public.mutate_planning_batch_reference_images(
  p_batch_id text,
  p_add jsonb default null,
  p_replace_role text default null,
  p_remove_id text default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  with removed as (
    select coalesce(jsonb_agg(entry), '[]'::jsonb) as entries
    from public.planning_batches as batch,
         jsonb_array_elements(coalesce(batch.reference_images, '[]'::jsonb)) as entry
    where batch.id::text = p_batch_id
      and (
        (p_replace_role is not null and entry ->> 'role' = p_replace_role)
        or (p_remove_id is not null and entry ->> 'id' = p_remove_id)
      )
  ),
  updated as (
    update public.planning_batches as batch
    set reference_images = coalesce(
          (
            select jsonb_agg(entry)
            from jsonb_array_elements(coalesce(batch.reference_images, '[]'::jsonb)) as entry
            where not (
              (p_replace_role is not null and entry ->> 'role' = p_replace_role)
              or (p_remove_id is not null and entry ->> 'id' = p_remove_id)
            )
          ),
          '[]'::jsonb
        ) || case when p_add is not null then jsonb_build_array(p_add) else '[]'::jsonb end,
        updated_at = now()
    where batch.id::text = p_batch_id
    returning batch.id
  )
  select removed.entries from removed;
$$;

revoke all on function public.mutate_planning_batch_reference_images(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.mutate_planning_batch_reference_images(text, jsonb, text, text) to service_role;
