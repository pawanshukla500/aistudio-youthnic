-- Catalog jobs are created by the service worker, so their catalog session is
-- owned by `catalog-worker` rather than the Firebase user who is viewing the
-- organization. Allow organization members to read those sessions and their
-- pose rows without weakening cross-organization isolation.

drop policy if exists catalog_sessions_select_owner on public.catalog_sessions;
drop policy if exists catalog_sessions_select_owner_or_org on public.catalog_sessions;
create policy catalog_sessions_select_owner_or_org on public.catalog_sessions
for select to authenticated
using (
  user_id = (select private.current_firebase_uid())
  or organization_id = (select private.current_organization_id())
);

drop policy if exists session_generations_select_owner on public.session_generations;
drop policy if exists session_generations_select_owner_or_org on public.session_generations;
create policy session_generations_select_owner_or_org on public.session_generations
for select to authenticated
using (exists (
  select 1
  from public.catalog_sessions as session
  where session.session_id = session_generations.session_id
    and (
      session.user_id = (select private.current_firebase_uid())
      or session.organization_id = (select private.current_organization_id())
    )
));

-- One normalized field keeps History search server-side so pagination only
-- returns the ten requested jobs instead of downloading the full archive.
alter table public.generation_jobs
  add column if not exists history_search text generated always as (
    lower(
      coalesce(sku_name, '') || ' ' ||
      coalesce(user_email, '') || ' ' ||
      coalesce(job_data ->> 'skuId', '') || ' ' ||
      coalesce(job_data ->> 'skuName', '') || ' ' ||
      coalesce(job_data ->> 'productDetails', '')
    )
  ) stored;
