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
  using (organization_id = (select private.current_organization_id()));

create policy product_reference_evidence_select_current_org on public.product_reference_evidence
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy product_region_crops_select_current_org on public.product_region_crops
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy qa_assessments_select_current_org on public.qa_assessments
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy correction_history_select_current_org on public.correction_history
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy learning_outcomes_select_current_org on public.learning_outcomes
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy knowledge_embeddings_select_current_org on public.knowledge_embeddings
  for select to authenticated
  using (
    organization_id is null
    or organization_id = (select private.current_organization_id())
  );
