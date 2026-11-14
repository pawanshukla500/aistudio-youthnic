-- Standardize product_truth routing to Meta Muse Spark 1.3 Contributor (medium thinking)
-- with OpenAI GPT 6.1 Terra (medium thinking) fallback, repair any invalid image_generation
-- reasoning values ('none' required, default gpt-image-2.6-sunburst), and update app_enroll_seller.

-- 1. Update existing organization product_truth policies
UPDATE public.organization_ai_model_policies
SET
  primary_model = CASE
    WHEN primary_provider = 'meta'
      AND primary_model IN ('muse-spark-1.2-contributor', 'muse-spark-1.2')
    THEN 'muse-spark-1.3-contributor'
    ELSE primary_model
  END,
  primary_reasoning = CASE
    WHEN primary_provider = 'meta' THEN 'medium'
    WHEN primary_provider = 'openai' AND primary_model = 'gpt-6.1-terra' THEN 'medium'
    ELSE primary_reasoning
  END,
  fallback_model = CASE
    WHEN fallback_enabled IS TRUE
      AND primary_provider = 'meta'
      AND fallback_provider = 'openai'
    THEN 'gpt-6.1-terra'
    ELSE fallback_model
  END,
  fallback_reasoning = CASE
    WHEN fallback_enabled IS TRUE
      AND primary_provider = 'meta'
      AND fallback_provider = 'openai'
    THEN 'medium'
    ELSE fallback_reasoning
  END,
  revision = revision + 1,
  updated_at = now()
WHERE purpose = 'product_truth'
  AND (
    (primary_provider = 'meta' AND (primary_model IN ('muse-spark-1.2-contributor', 'muse-spark-1.2') OR primary_reasoning IS DISTINCT FROM 'medium'))
    OR (primary_provider = 'openai' AND primary_model = 'gpt-6.1-terra' AND primary_reasoning IS DISTINCT FROM 'medium')
    OR (
      fallback_enabled IS TRUE
      AND primary_provider = 'meta'
      AND fallback_provider = 'openai'
      AND (
        fallback_model IS DISTINCT FROM 'gpt-6.1-terra'
        OR fallback_reasoning IS DISTINCT FROM 'medium'
      )
    )
  );

-- 2. Repair image_generation policies (primary_reasoning must be 'none'; default OpenAI model gpt-image-2.6-sunburst)
UPDATE public.organization_ai_model_policies
SET
  primary_model = CASE
    WHEN primary_provider = 'openai'
      AND primary_model IN (
        'gpt-image-2',
        'gpt-image-2.5-flare-2026-09-08',
        'gpt-image-2.5-flare',
        'gpt-image-2.5-sunburst'
      )
    THEN 'gpt-image-2.6-sunburst'
    ELSE primary_model
  END,
  primary_reasoning = 'none',
  revision = revision + 1,
  updated_at = now()
WHERE purpose = 'image_generation'
  AND (
    primary_reasoning IS DISTINCT FROM 'none'
    OR (
      primary_provider = 'openai'
      AND primary_model IN (
        'gpt-image-2',
        'gpt-image-2.5-flare-2026-09-08',
        'gpt-image-2.5-flare',
        'gpt-image-2.5-sunburst'
      )
    )
  );

-- 3. Update app_enroll_seller so new external sellers receive valid medium product_truth and 'none' image_generation reasoning
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
