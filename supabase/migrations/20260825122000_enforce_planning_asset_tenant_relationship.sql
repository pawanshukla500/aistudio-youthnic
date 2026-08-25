-- A planning asset belongs to both an organization and a planning request.
-- Independent FKs permit a malformed row to join a request from another tenant,
-- which a service-role worker could otherwise read into a generation prompt.
-- Verify the existing history before rejecting every future cross-tenant link.
do $$
begin
  if exists (
    select 1
    from public.planning_assets as asset
    join public.planning_requests as request on request.id = asset.planning_request_id
    where asset.organization_id is distinct from request.organization_id
  ) then
    raise exception 'Cannot enforce planning asset tenant relationship while cross-organization asset links exist';
  end if;
end;
$$;

create or replace function private.enforce_planning_asset_tenant_relationship()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_organization_id uuid;
begin
  select request.organization_id
  into request_organization_id
  from public.planning_requests as request
  where request.id = new.planning_request_id;

  if request_organization_id is null then
    raise exception using
      errcode = '23503',
      message = 'Planning asset references a missing planning request';
  end if;

  if request_organization_id is distinct from new.organization_id then
    raise exception using
      errcode = '23514',
      message = 'Planning asset tenant relationship violation';
  end if;

  return new;
end;
$$;

-- This private SECURITY DEFINER trigger is not a callable browser endpoint.
revoke all on function private.enforce_planning_asset_tenant_relationship() from public, anon, authenticated;
grant execute on function private.enforce_planning_asset_tenant_relationship() to service_role, postgres;

drop trigger if exists planning_assets_tenant_relationship_check on public.planning_assets;
create trigger planning_assets_tenant_relationship_check
before insert or update of organization_id, planning_request_id on public.planning_assets
for each row execute function private.enforce_planning_asset_tenant_relationship();
