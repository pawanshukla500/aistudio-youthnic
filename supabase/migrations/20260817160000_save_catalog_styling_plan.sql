-- Deciding in app code whether a save revokes approval means comparing against a
-- snapshot read moments earlier. An edit and an approval that overlap then reach
-- different conclusions: the edit sees no approval, so it omits the approval keys
-- from its patch, and the shallow merge preserves the approval the other request
-- just wrote - leaving an unreviewed plan marked approved.
--
-- The comparison and the write happen together here, under a row lock, so the two
-- requests serialise and the later one sees the earlier one's result.

create or replace function public.save_catalog_styling_plan(
  p_batch_id uuid,
  p_plan jsonb,
  p_approve boolean,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_memory jsonb;
  stored_plan jsonb;
  plan_changed boolean;
  patch jsonb;
  next_memory jsonb;
begin
  select coalesce(catalog_memory, '{}'::jsonb) into current_memory
  from public.planning_batches
  where id = p_batch_id
  for update;

  if not found then
    return null;
  end if;

  stored_plan := current_memory -> 'stylingPlan';
  plan_changed := stored_plan is null or stored_plan is distinct from p_plan;

  patch := jsonb_build_object(
    'stylingPlan', p_plan,
    'stylingPlanProposed', coalesce(current_memory -> 'stylingPlanProposed', stored_plan, p_plan),
    'stylingPlanProposedAt', coalesce(current_memory -> 'stylingPlanProposedAt', to_jsonb(now()))
  );

  if p_approve then
    patch := patch || jsonb_build_object(
      'stylingPlanApprovedAt', to_jsonb(now()),
      'stylingPlanApprovedByMemberId', to_jsonb(p_member_id)
    );
  elsif plan_changed then
    -- Written explicitly rather than omitted, so a concurrent approval cannot
    -- survive underneath this revision.
    patch := patch || jsonb_build_object(
      'stylingPlanApprovedAt', 'null'::jsonb,
      'stylingPlanApprovedByMemberId', 'null'::jsonb
    );
  end if;

  next_memory := current_memory || patch;

  update public.planning_batches
  set catalog_memory = next_memory,
      updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'memory', next_memory,
    'revoked', (not p_approve) and plan_changed,
    'previousPlan', stored_plan
  );
end;
$$;

revoke all on function public.save_catalog_styling_plan(uuid, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.save_catalog_styling_plan(uuid, jsonb, boolean, uuid) to service_role;
