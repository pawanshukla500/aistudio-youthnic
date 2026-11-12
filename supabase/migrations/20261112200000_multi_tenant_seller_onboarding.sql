-- Multi-Tenant Seller Onboarding & Autonomous Enrollment
-- Enables external e-commerce sellers to enroll their own dedicated organization,
-- automatically grants 5 free photoshoot generations, allocates admin/owner privileges,
-- configures isolated storage scopes, and provisions default AI model routing policies.

-- 1. Add credit tracking columns to public.organizations
alter table public.organizations
  add column if not exists credits integer not null default 5,
  add column if not exists trial_credits_allocated integer not null default 5;

-- Ensure internal / primary organization has ample operational credits
update public.organizations
set credits = 1000,
    trial_credits_allocated = 1000
where is_primary is true
   or name ilike '%vbexport%'
   or name ilike '%youthnic%';

-- 2. Atomic Seller Enrollment RPC
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

  -- Determine contact email
  v_email := lower(trim(both from coalesce(nullif(contact_email, ''), v_firebase_uid || '@seller.youthnic.com')));

  -- 1. Create Organization with 5 Free Trial Credits and transparent pricing metadata
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
    5,
    5,
    jsonb_build_object(
      'seller_type', 'external',
      'plan', 'trial',
      'pricing_tier', 'standard_payg',
      'pricing', jsonb_build_object(
        'high_rate_usd', 1.00,
        'qa_addon_usd', 0.50
      )
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

  -- 3. Assign Admin Role
  select id into v_admin_role_id from public.roles where slug = 'admin' limit 1;
  if v_admin_role_id is not null then
    insert into public.member_roles (member_id, role_id)
    values (v_new_member_id, v_admin_role_id)
    on conflict do nothing;
  end if;

  -- 4. Seed default AI Model Policies (Meta High primary, GPT 6.1 Terra High fallback, Sunburst generator)
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
    (v_new_org_id, 'product_truth', 'meta', 'muse-spark-1.2-contributor', 'high', true, 'openai', 'gpt-6.1-terra', 'high', v_new_member_id),
    (v_new_org_id, 'qa', 'gemini', 'gemini-3.8-flash', 'low', false, null, null, null, v_new_member_id),
    (v_new_org_id, 'qa_escalation', 'openai', 'gpt-5.6-luna', 'low', false, null, null, null, v_new_member_id),
    (v_new_org_id, 'image_generation', 'openai', 'gpt-image-2.6-sunburst', 'medium', false, null, null, null, v_new_member_id)
  on conflict (organization_id, purpose) do nothing;

  -- 5. Copy base fashion knowledge to tenant workspace
  select id into v_primary_org_id from public.organizations where is_primary is true order by created_at limit 1;
  if v_primary_org_id is not null then
    insert into public.fashion_knowledge_base (
      organization_id,
      category,
      topic,
      rules,
      context_data,
      is_active
    )
    select
      v_new_org_id,
      category,
      topic,
      rules,
      context_data,
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

-- 3. Atomic Credit Consumption Helper for External Sellers
create or replace function public.app_consume_seller_credit(p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  update public.organizations
  set credits = credits - 1,
      updated_at = now()
  where id = p_org_id
    and credits > 0;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.app_consume_seller_credit(uuid) from public, anon;
grant execute on function public.app_consume_seller_credit(uuid) to service_role;
