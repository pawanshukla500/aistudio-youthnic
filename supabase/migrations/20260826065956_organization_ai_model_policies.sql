-- Per-organization routing for server-side AI work. This table deliberately
-- stores identifiers and policy choices only: provider credentials remain Edge
-- Function secrets and may never be written to, or read from, the database.
-- The application validates the provider/model pairs against its own registry
-- before a policy can be used.

create table if not exists public.organization_ai_model_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purpose text not null check (purpose in (
    'product_truth',
    'qa',
    'qa_escalation',
    'image_generation'
  )),
  primary_provider text not null check (primary_provider in (
    'gemini',
    'openai',
    'qwen',
    'meta'
  )),
  primary_model text not null check (char_length(btrim(primary_model)) between 1 and 160),
  -- `none` means provider reasoning is explicitly disabled. The Edge Function
  -- validates each provider's supported values; notably, structured Qwen
  -- vision requests require this setting.
  primary_reasoning text not null default 'high' check (primary_reasoning in (
    'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
  )),
  fallback_enabled boolean not null default false,
  fallback_provider text check (fallback_provider in (
    'gemini',
    'openai',
    'qwen',
    'meta'
  )),
  fallback_model text check (
    fallback_model is null
    or char_length(btrim(fallback_model)) between 1 and 160
  ),
  fallback_reasoning text check (fallback_reasoning in (
    'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
  )),
  revision integer not null default 1 check (revision >= 1),
  updated_by_member_id uuid references public.organization_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_ai_model_policies_org_purpose_key unique (organization_id, purpose),
  constraint organization_ai_model_policies_fallback_shape_check check (
    (not fallback_enabled and fallback_provider is null and fallback_model is null and fallback_reasoning is null)
    or
    (fallback_enabled and fallback_provider is not null and fallback_model is not null and fallback_reasoning is not null)
  ),
  -- A cross-provider/model fallback must actually change the route. The same
  -- provider remains valid when it selects a different, approved model.
  constraint organization_ai_model_policies_distinct_fallback_check check (
    not fallback_enabled
    or fallback_provider is distinct from primary_provider
    or fallback_model is distinct from primary_model
  ),
  -- Image generation has its own explicit provider model selection. It cannot
  -- silently fall back to a vision/planning provider.
  constraint organization_ai_model_policies_image_generation_no_fallback_check check (
    purpose <> 'image_generation' or not fallback_enabled
  )
);

comment on table public.organization_ai_model_policies is
  'Organization-scoped, server-managed model routing. Only validated non-secret provider/model identifiers are stored here.';

comment on column public.organization_ai_model_policies.revision is
  'Monotonic policy version used to snapshot routing decisions in AI runs and invalidate stale analysis caches.';

create index if not exists organization_ai_model_policies_updated_by_idx
  on public.organization_ai_model_policies (updated_by_member_id)
  where updated_by_member_id is not null;

create or replace function private.touch_organization_ai_model_policies()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- Do not allow an otherwise valid policy to attribute a configuration change
  -- to a member of another tenant.
  if new.updated_by_member_id is not null and not exists (
    select 1
    from public.organization_members as member
    where member.id = new.updated_by_member_id
      and member.organization_id = new.organization_id
  ) then
    raise exception 'updated_by_member_id must belong to the policy organization';
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.purpose is distinct from old.purpose then
      raise exception 'organization_id and purpose are immutable for organization AI model policies';
    end if;

    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.touch_organization_ai_model_policies() from public, anon, authenticated;
grant execute on function private.touch_organization_ai_model_policies() to service_role, postgres;

drop trigger if exists organization_ai_model_policies_touch on public.organization_ai_model_policies;
create trigger organization_ai_model_policies_touch
before insert or update on public.organization_ai_model_policies
for each row execute function private.touch_organization_ai_model_policies();

alter table public.organization_ai_model_policies enable row level security;

-- Browsers may inspect their own administrator-visible routing configuration,
-- but all mutations must go through the audited, permission-checked Edge
-- Function. No client receives insert, update, or delete privileges.
drop policy if exists organization_ai_model_policies_select_current_admin on public.organization_ai_model_policies;
create policy organization_ai_model_policies_select_current_admin on public.organization_ai_model_policies
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('admin.settings'))
);

revoke all on public.organization_ai_model_policies from public, anon;
revoke insert, update, delete on public.organization_ai_model_policies from authenticated;
grant select on public.organization_ai_model_policies to authenticated;
grant all on public.organization_ai_model_policies to service_role;
