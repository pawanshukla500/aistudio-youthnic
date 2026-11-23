-- One free trial shoot per new store, and prepaid recharge requests.
--
-- 1. A newly enrolled seller store gets 1 trial credit (one six-frame shoot) instead of 5.
--    Existing organizations keep the balance they have.
-- 2. credit_recharges records a store asking for a prepaid pack. An administrator of the
--    primary organization approves it, which adds the pack's shoots to the store. A payment
--    gateway can later mark the same row paid through provider / provider_ref.
--
-- The table and its two functions are server-only: the app-api Edge Function authenticates
-- the caller and passes organization and member ids from the verified workspace.

create or replace function public.app_enroll_seller(
  store_name text,
  contact_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_firebase_uid text;
  v_existing_org_id uuid;
  v_clean_name text;
  v_base_slug text;
  v_slug text;
  v_counter integer := 1;
  v_new_org_id uuid;
  v_new_member_id uuid;
  v_admin_role_id uuid;
  v_email text;
  v_primary_org_id uuid;
begin
  -- Validate caller authentication strictly against verified session JWT
  v_firebase_uid := private.current_firebase_uid();
  if v_firebase_uid is null then
    raise exception 'Authentication required to enroll a seller organization.';
  end if;

  -- Advisory lock keyed by firebase_uid to serialize concurrent enrollment attempts for the same user
  perform pg_advisory_xact_lock(hashtext(v_firebase_uid));

  v_clean_name := trim(both from store_name);
  if length(v_clean_name) < 2 then
    raise exception 'Store name must be at least 2 characters long.';
  end if;

  -- Sybil check: If member already exists and has an active organization, return that workspace
  select member.organization_id into v_existing_org_id
  from public.organization_members as member
  where member.firebase_uid = v_firebase_uid
    and member.status = 'active'
  limit 1;

  if v_existing_org_id is not null then
    return public.app_current_workspace();
  end if;

  -- Generate unique slug with collision resistance
  v_base_slug := lower(regexp_replace(v_clean_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then
    v_base_slug := 'seller-store';
  end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_counter := v_counter + 1;
    v_slug := v_base_slug || '-' || substr(md5((v_counter + random())::text || clock_timestamp()::text), 1, 6);
  end loop;

  -- Determine contact email: prioritize verified email from token claims, falling back to contact_email
  v_email := lower(trim(both from coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    nullif(contact_email, ''),
    v_firebase_uid || '@seller.youthnic.com'
  )));

  -- 1. Create Organization with 1 free trial credit (one six-frame shoot) and prepaid-pack pricing metadata
  insert into public.organizations (
    name,
    slug,
    is_primary,
    credits,
    trial_credits_allocated,
    settings
  ) values (
    v_clean_name,
    v_slug,
    false,
    1,
    1,
    jsonb_build_object(
      'seller_type', 'external',
      'plan', 'trial',
      'pricing_tier', 'prepaid_packs'
    )
  ) returning id into v_new_org_id;

  -- 2. Create Organization Member as Owner
  insert into public.organization_members (
    organization_id,
    firebase_uid,
    email,
    display_name,
    status,
    profile,
    notification_preferences
  ) values (
    v_new_org_id,
    v_firebase_uid,
    v_email,
    v_clean_name,
    'active',
    jsonb_build_object('jobTitle', 'Store Owner'),
    '{"catalog_assignments_in_app": true, "catalog_handoff_email": true}'::jsonb
  ) returning id into v_new_member_id;

  -- 3. Create Tenant-Scoped Admin Role and Assign All Permissions
  insert into public.roles (
    organization_id,
    name,
    slug,
    description,
    is_system
  ) values (
    v_new_org_id,
    'Administrator',
    'admin',
    'Full administrative access to the seller studio workspace.',
    true
  ) returning id into v_admin_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select v_admin_role_id, id
  from public.permissions
  on conflict do nothing;

  insert into public.member_roles (member_id, role_id)
  values (v_new_member_id, v_admin_role_id)
  on conflict do nothing;

  -- 4. Seed default AI Model Policies (Meta 1.3 Contributor Medium primary, GPT 6.1 Terra Medium fallback, Sunburst 2.6 generator)
  insert into public.organization_ai_model_policies (
    organization_id,
    purpose,
    primary_provider,
    primary_model,
    primary_reasoning,
    fallback_enabled,
    fallback_provider,
    fallback_model,
    fallback_reasoning,
    updated_by_member_id
  ) values
    (v_new_org_id, 'product_truth', 'meta', 'muse-spark-1.3-contributor', 'medium', true, 'openai', 'gpt-6.1-terra', 'medium', v_new_member_id),
    (v_new_org_id, 'qa', 'gemini', 'gemini-3.8-flash', 'low', false, null, null, null, v_new_member_id),
    (v_new_org_id, 'qa_escalation', 'openai', 'gpt-5.6-luna', 'low', false, null, null, null, v_new_member_id),
    (v_new_org_id, 'image_generation', 'openai', 'gpt-image-2.6-sunburst', 'none', false, null, null, null, v_new_member_id)
  on conflict (organization_id, purpose) do nothing;

  -- 5. Copy base fashion knowledge to tenant workspace
  select id into v_primary_org_id from public.organizations where is_primary is true order by created_at limit 1;
  if v_primary_org_id is not null then
    insert into public.fashion_knowledge_base (
      organization_id,
      category,
      topic,
      title,
      guidance,
      tags,
      priority,
      source,
      is_active
    )
    select
      v_new_org_id,
      category,
      topic,
      title,
      guidance,
      tags,
      priority,
      'seed',
      is_active
    from public.fashion_knowledge_base
    where organization_id = v_primary_org_id
    on conflict do nothing;
  end if;

  -- Return the newly populated workspace context
  return public.app_current_workspace();
end;
$$;

revoke all on function public.app_enroll_seller(text, text) from public, anon;
grant execute on function public.app_enroll_seller(text, text) to authenticated, service_role;

-- 2. Prepaid recharge requests
create table if not exists public.credit_recharges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pack_skus integer not null check (pack_skus > 0),
  amount_inr integer not null check (amount_inr > 0),
  status text not null default 'requested' check (status in ('requested', 'paid', 'cancelled')),
  -- 'manual' while an administrator approves by hand. A payment gateway writes its own name
  -- and payment id here when it marks the row paid.
  provider text not null default 'manual',
  provider_ref text,
  requested_by_member_id uuid references public.organization_members(id) on delete set null,
  approved_by_member_id uuid references public.organization_members(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_recharges_org_created_idx
  on public.credit_recharges (organization_id, created_at desc);

-- One open request per store keeps the approval list unambiguous.
create unique index if not exists credit_recharges_one_open_per_org_idx
  on public.credit_recharges (organization_id)
  where status = 'requested';

-- A gateway payment id can pay for one recharge only.
create unique index if not exists credit_recharges_provider_ref_idx
  on public.credit_recharges (provider, provider_ref)
  where provider_ref is not null;

alter table public.credit_recharges enable row level security;

revoke all on public.credit_recharges from public, anon, authenticated;
grant all on public.credit_recharges to service_role;

-- 3. A store asks for a pack. The client never sends an amount: the price comes from this list.
create or replace function public.app_request_credit_recharge(
  p_org_id uuid,
  p_member_id uuid,
  p_pack_skus integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_amount integer;
  v_row public.credit_recharges;
begin
  -- The price list. It must equal PACKS in src/lib/pricingPacks.ts
  -- (parity test: supabase/functions/app-api/tests/seller_access.test.ts).
  select pack.amount_inr into v_amount
  from (values (2, 500), (11, 2000), (30, 5000), (60, 10000)) as pack(skus, amount_inr)
  where pack.skus = p_pack_skus;

  if v_amount is null then
    raise exception 'Unknown recharge pack.';
  end if;

  if exists (
    select 1
    from public.credit_recharges
    where organization_id = p_org_id
      and status = 'requested'
  ) then
    raise exception 'A recharge request is already waiting for approval. Cancel it to choose another pack.';
  end if;

  insert into public.credit_recharges (
    organization_id,
    pack_skus,
    amount_inr,
    requested_by_member_id
  ) values (
    p_org_id,
    p_pack_skus,
    v_amount,
    p_member_id
  ) returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.app_request_credit_recharge(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.app_request_credit_recharge(uuid, uuid, integer) to service_role;

-- 4. Mark a request paid and add its shoots, once.
create or replace function public.app_approve_credit_recharge(
  p_recharge_id uuid,
  p_approved_by uuid,
  p_provider text default 'manual',
  p_provider_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.credit_recharges;
begin
  -- Marking the row paid and adding the shoots happen in one transaction, and only the first
  -- call finds status = 'requested', so a repeat click or a gateway retry adds nothing.
  update public.credit_recharges
  set status = 'paid',
      provider = coalesce(nullif(trim(both from p_provider), ''), provider),
      provider_ref = coalesce(nullif(trim(both from p_provider_ref), ''), provider_ref),
      approved_by_member_id = p_approved_by,
      paid_at = now(),
      updated_at = now()
  where id = p_recharge_id
    and status = 'requested'
  returning * into v_row;

  if not found then
    return jsonb_build_object('applied', false);
  end if;

  update public.organizations
  set credits = credits + v_row.pack_skus,
      updated_at = now()
  where id = v_row.organization_id;

  return jsonb_build_object(
    'applied', true,
    'organization_id', v_row.organization_id,
    'credits_added', v_row.pack_skus
  );
end;
$$;

revoke all on function public.app_approve_credit_recharge(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.app_approve_credit_recharge(uuid, uuid, text, text) to service_role;

-- Let the database API see the new table and functions at once.
notify pgrst, 'reload schema';
