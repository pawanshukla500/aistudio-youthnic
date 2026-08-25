-- Reusable learning is deliberately separate from generation_learnings.
-- The latter remains an append-only audit/observation ledger, including legacy
-- failed generations, and must never be treated as prompt input by itself.
-- A rule becomes reusable only after an authorized human explicitly approves it.

create table if not exists public.generation_learning_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_learning_id uuid references public.generation_learnings(id) on delete set null,
  source_qa_review_id uuid references public.qa_reviews(id) on delete set null,
  garment_family text not null,
  product_category text not null default '',
  pose_id text not null default '',
  -- Category rules can help presentation; pose rules add a pose-specific version
  -- of that guidance. Product rules are reference-bound guards only, never a
  -- substitute for Product Identity or the uploaded product references.
  scope text not null check (scope in ('category', 'pose', 'product')),
  rule_kind text not null check (rule_kind in ('presentation', 'qa_guard', 'reference_guard')),
  reference_fingerprint text not null default '',
  guidance text not null check (char_length(btrim(guidance)) between 1 and 1200),
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'rejected', 'disabled')),
  created_by_member_id uuid references public.organization_members(id) on delete set null,
  approved_by_member_id uuid references public.organization_members(id) on delete set null,
  approved_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A product-specific rule is safe only when it is bound to the exact current
  -- source-reference fingerprint. General rules cannot carry product evidence.
  constraint generation_learning_rules_scope_shape_check check (
    (scope = 'category' and pose_id = '' and reference_fingerprint = '' and rule_kind in ('presentation', 'qa_guard'))
    or (scope = 'pose' and pose_id <> '' and reference_fingerprint = '' and rule_kind in ('presentation', 'qa_guard'))
    or (scope = 'product' and reference_fingerprint <> '' and rule_kind = 'reference_guard')
  ),
  -- Approval cannot be inferred from a completion or an automated QA estimate.
  constraint generation_learning_rules_approval_check check (
    status <> 'approved' or (approved_by_member_id is not null and approved_at is not null)
  )
);

comment on table public.generation_learning_rules is
  'Tenant-scoped, human-approved reusable generation guidance. generation_learnings remains an audit-only observation ledger.';

comment on column public.generation_learning_rules.reference_fingerprint is
  'Required for product-scoped rules. Must exactly match the current authoritative reference fingerprint before retrieval.';

create index if not exists generation_learning_rules_approved_lookup_idx
  on public.generation_learning_rules (
    organization_id,
    garment_family,
    product_category,
    pose_id,
    updated_at desc
  )
  where status = 'approved';

create index if not exists generation_learning_rules_source_learning_idx
  on public.generation_learning_rules (source_learning_id)
  where source_learning_id is not null;

create index if not exists generation_learning_rules_source_qa_review_idx
  on public.generation_learning_rules (source_qa_review_id)
  where source_qa_review_id is not null;

alter table public.generation_learning_rules enable row level security;

-- The browser may inspect approved/candidate history only when the member can
-- view planning data. Creation, promotion, rejection and disabling stay in the
-- permission-checked Edge Function and are audited there; no browser DML is
-- granted or policy-enabled here.
drop policy if exists generation_learning_rules_select_current_org on public.generation_learning_rules;
create policy generation_learning_rules_select_current_org on public.generation_learning_rules
for select to authenticated
using (
  organization_id = (select private.current_organization_id())
  and (select private.has_permission('planning.view'))
);

revoke all on public.generation_learning_rules from public, anon;
revoke insert, update, delete on public.generation_learning_rules from authenticated;
grant select on public.generation_learning_rules to authenticated;
grant all on public.generation_learning_rules to service_role;
