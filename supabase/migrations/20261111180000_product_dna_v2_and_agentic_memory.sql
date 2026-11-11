-- Migration: Product DNA V2, Reference Evidence, Visual QA & pgvector Knowledge Memory
-- Enables immutable evidence-linked garment attributes, region crops, pgvector hybrid search,
-- and structured QA evaluation records.

create extension if not exists vector;

-- 1. Product DNA Versions (Immutable, approved snapshots of verified garment specs)
create table if not exists public.product_dna_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku_id text not null,
  sku_name text not null,
  version integer not null default 1,
  garment_family text not null default 'kurta_or_kurti_set',
  dna_payload jsonb not null default '{}'::jsonb,
  source_fingerprint text not null,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'deprecated', 'rejected')),
  approved boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_dna_versions_unique_sku_version unique (organization_id, sku_id, version)
);

create index if not exists idx_product_dna_versions_org_sku
  on public.product_dna_versions (organization_id, sku_id, version desc);

create index if not exists idx_product_dna_versions_fingerprint
  on public.product_dna_versions (organization_id, source_fingerprint);

-- 2. Product Reference Evidence (Explicit source authority for each uploaded photo)
create table if not exists public.product_reference_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku_id text not null,
  role text not null check (role in (
    'front', 'back', 'bottom', 'fabric_pattern', 'mannequin',
    'additional_product', 'model_identity', 'style_reference', 'approved_pose'
  )),
  storage_path text not null,
  download_url text not null,
  sha256_hash text not null,
  mime_type text not null default 'image/jpeg',
  dimensions jsonb default '{"width": 0, "height": 0}'::jsonb,
  region_type text default 'general',
  confidence numeric not null default 1.0 check (confidence >= 0 and confidence <= 1.0),
  is_authoritative boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_reference_evidence_sku
  on public.product_reference_evidence (organization_id, sku_id, role);

create index if not exists idx_product_reference_evidence_hash
  on public.product_reference_evidence (sha256_hash);

-- 3. Product Region Crops (Pixel & bounding-box evidence for macro details & cuts)
create table if not exists public.product_region_crops (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.product_reference_evidence(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku_id text not null,
  region_name text not null,
  bounding_box jsonb not null default '{"x": 0, "y": 0, "width": 1, "height": 1}'::jsonb,
  crop_storage_path text,
  crop_download_url text,
  mask_storage_path text,
  construction_notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_region_crops_sku_region
  on public.product_region_crops (organization_id, sku_id, region_name);

-- 4. QA Assessments (Structured per-pose visual fidelity evaluation)
create table if not exists public.qa_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id text not null,
  generation_id text not null,
  sku_id text not null,
  pose_index integer not null,
  pose_type text not null,
  attempt_number integer not null default 1,
  overall_score numeric not null,
  product_fidelity_score numeric not null,
  scores jsonb not null default '{}'::jsonb,
  checks jsonb not null default '{}'::jsonb,
  failed_checks text[] not null default '{}'::text[],
  anatomical_defect_detected boolean not null default false,
  style_quarantine_violation boolean not null default false,
  review_recommended boolean not null default false,
  outcome text not null check (outcome in ('pass', 'retry', 'fail', 'unverified')),
  correction_guidance text,
  assessed_by text not null default 'cv_qa_agent',
  created_at timestamptz not null default now()
);

create index if not exists idx_qa_assessments_job_pose
  on public.qa_assessments (organization_id, job_id, pose_index);

create index if not exists idx_qa_assessments_generation
  on public.qa_assessments (generation_id);

-- 5. Correction History (Track user corrections, mismatches and resolutions)
create table if not exists public.correction_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id text not null,
  generation_id text not null,
  sku_id text not null,
  pose_index integer not null,
  root_cause_stage text not null check (root_cause_stage in (
    'dna_extraction', 'reference_selection', 'prompt_composition', 'generation_model', 'qa_evaluation', 'user_preference'
  )),
  specific_mismatch text not null,
  source_evidence_id uuid references public.product_reference_evidence(id) on delete set null,
  attempted_action text not null check (attempted_action in (
    'region_repair', 'pose_regeneration', 'prompt_refinement', 'human_override'
  )),
  resolution text not null default 'pending' check (resolution in ('pending', 'resolved', 'discarded')),
  final_approved_asset_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_correction_history_job_pose
  on public.correction_history (organization_id, job_id, pose_index);

-- 6. Knowledge Embeddings (pgvector store for fashion knowledge & learning retrieval)
create table if not exists public.knowledge_embeddings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  category text not null,
  sub_category text,
  content text not null,
  embedding vector(1536),
  model text not null default 'text-embedding-3-small',
  source_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_embeddings_category
  on public.knowledge_embeddings (category, is_active);

-- HNSW index for fast approximate nearest neighbor search
create index if not exists idx_knowledge_embeddings_vector_hnsw
  on public.knowledge_embeddings using hnsw (embedding vector_cosine_ops);

-- 7. Learning Outcomes (Controlled continuous-improvement rules promoted after approval)
create table if not exists public.learning_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku_id text,
  rule_type text not null check (rule_type in (
    'bottom_wear_preservation', 'back_pose_boundary', 'anatomical_correction',
    'print_scale', 'embroidery_geometry', 'scene_continuity', 'fabric_fall'
  )),
  rule_text text not null,
  trigger_condition jsonb not null default '{}'::jsonb,
  positive_guidance text not null,
  negative_constraints text[] not null default '{}'::text[],
  effectiveness_score numeric not null default 1.0,
  usage_count integer not null default 0,
  success_count integer not null default 0,
  is_active boolean not null default true,
  approved boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_learning_outcomes_org_type
  on public.learning_outcomes (organization_id, rule_type, is_active);

-- Enable RLS across all new tables
alter table public.product_dna_versions enable row level security;
alter table public.product_reference_evidence enable row level security;
alter table public.product_region_crops enable row level security;
alter table public.qa_assessments enable row level security;
alter table public.correction_history enable row level security;
alter table public.knowledge_embeddings enable row level security;
alter table public.learning_outcomes enable row level security;

-- Create service role and authenticated RLS policies
drop policy if exists "Allow service role full access to product_dna_versions" on public.product_dna_versions;
create policy "Allow service role full access to product_dna_versions"
  on public.product_dna_versions for all using (true) with check (true);

drop policy if exists "Allow service role full access to product_reference_evidence" on public.product_reference_evidence;
create policy "Allow service role full access to product_reference_evidence"
  on public.product_reference_evidence for all using (true) with check (true);

drop policy if exists "Allow service role full access to product_region_crops" on public.product_region_crops;
create policy "Allow service role full access to product_region_crops"
  on public.product_region_crops for all using (true) with check (true);

drop policy if exists "Allow service role full access to qa_assessments" on public.qa_assessments;
create policy "Allow service role full access to qa_assessments"
  on public.qa_assessments for all using (true) with check (true);

drop policy if exists "Allow service role full access to correction_history" on public.correction_history;
create policy "Allow service role full access to correction_history"
  on public.correction_history for all using (true) with check (true);

drop policy if exists "Allow service role full access to knowledge_embeddings" on public.knowledge_embeddings;
create policy "Allow service role full access to knowledge_embeddings"
  on public.knowledge_embeddings for all using (true) with check (true);

drop policy if exists "Allow service role full access to learning_outcomes" on public.learning_outcomes;
create policy "Allow service role full access to learning_outcomes"
  on public.learning_outcomes for all using (true) with check (true);
