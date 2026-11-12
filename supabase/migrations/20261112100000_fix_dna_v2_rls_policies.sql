-- Fix overly permissive RLS policies introduced in 20261111180000_product_dna_v2_and_agentic_memory.sql
-- Restricts full-table access strictly to service_role and scopes authenticated reads by organization_id.

do $$
declare
  tbl text;
  policy_name text;
begin
  foreach tbl in array array[
    'product_dna_versions',
    'product_reference_evidence',
    'product_region_crops',
    'qa_assessments',
    'correction_history',
    'knowledge_embeddings',
    'learning_outcomes'
  ] loop
    policy_name := format('Allow service role full access to %s', tbl);
    execute format('drop policy if exists %I on public.%I', policy_name, tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_service_role_all', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_select_current_org', tbl);

    execute format('revoke all on public.%I from public, anon', tbl);
    execute format('revoke insert, update, delete on public.%I from authenticated', tbl);
    execute format('grant select on public.%I to authenticated', tbl);
    execute format('grant all on public.%I to service_role', tbl);

    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      tbl || '_service_role_all',
      tbl
    );
  end loop;
end $$;

create policy product_dna_versions_select_current_org on public.product_dna_versions
  for select to authenticated
  using (
    organization_id = (select private.current_organization_id())
    and (select private.has_permission('planning.view'))
  );

create policy product_reference_evidence_select_current_org on public.product_reference_evidence
  for select to authenticated
  using (
    organization_id = (select private.current_organization_id())
    and (select private.has_permission('planning.view'))
  );

create policy product_region_crops_select_current_org on public.product_region_crops
  for select to authenticated
  using (
    organization_id = (select private.current_organization_id())
    and (select private.has_permission('planning.view'))
  );

create policy qa_assessments_select_current_org on public.qa_assessments
  for select to authenticated
  using (
    organization_id = (select private.current_organization_id())
    and (select private.has_permission('planning.view'))
  );

create policy correction_history_select_current_org on public.correction_history
  for select to authenticated
  using (
    organization_id = (select private.current_organization_id())
    and (select private.has_permission('planning.view'))
  );

create policy learning_outcomes_select_current_org on public.learning_outcomes
  for select to authenticated
  using (
    organization_id = (select private.current_organization_id())
    and (select private.has_permission('planning.view'))
  );

create policy knowledge_embeddings_select_current_org on public.knowledge_embeddings
  for select to authenticated
  using (
    (
      organization_id is null
      or organization_id = (select private.current_organization_id())
    )
    and (select private.has_permission('planning.view'))
  );

-- Deduplicate existing rows before creating the unique index on knowledge_embeddings
delete from public.knowledge_embeddings a
using public.knowledge_embeddings b
where a.ctid < b.ctid
  and coalesce(a.organization_id, '00000000-0000-0000-0000-000000000000'::uuid) =
      coalesce(b.organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
  and a.category = b.category
  and a.source_hash = b.source_hash;

-- Deduplication unique index on knowledge_embeddings (org + source_hash + category)
create unique index if not exists idx_knowledge_embeddings_org_source_hash
  on public.knowledge_embeddings (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), category, source_hash);

-- Lock down LangGraph checkpoint tables in public schema if already created by PostgresSaver
do $$
declare
  cp_tbl text;
begin
  foreach cp_tbl in array array[
    'checkpoints',
    'checkpoint_blobs',
    'checkpoint_writes',
    'checkpoint_migrations'
  ] loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = cp_tbl
    ) then
      execute format('alter table public.%I enable row level security', cp_tbl);
      execute format('revoke all on public.%I from public, anon, authenticated', cp_tbl);
      execute format('grant all on public.%I to service_role', cp_tbl);
      execute format('drop policy if exists %I on public.%I', cp_tbl || '_service_role_all', cp_tbl);
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        cp_tbl || '_service_role_all',
        cp_tbl
      );
    end if;
  end loop;
end $$;

