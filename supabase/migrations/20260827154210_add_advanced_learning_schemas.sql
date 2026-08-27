-- Continuous learning, smart cache, and fashion knowledge base (Supabase PostgreSQL)

CREATE TABLE IF NOT EXISTS public.fashion_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general',
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  guidance TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  priority INT NOT NULL DEFAULT 50,
  source TEXT NOT NULL DEFAULT 'seed',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fkb_category ON public.fashion_knowledge_base (category);
CREATE INDEX IF NOT EXISTS idx_fkb_topic ON public.fashion_knowledge_base (topic);
CREATE INDEX IF NOT EXISTS idx_fkb_org ON public.fashion_knowledge_base (organization_id);
CREATE INDEX IF NOT EXISTS idx_fkb_active ON public.fashion_knowledge_base (is_active) WHERE is_active = TRUE;

ALTER TABLE public.fashion_knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY fashion_knowledge_base_select_current_org ON public.fashion_knowledge_base
FOR SELECT TO authenticated
USING (
  organization_id = (SELECT private.current_organization_id())
  AND (SELECT private.has_permission('planning.view'))
);

REVOKE ALL ON public.fashion_knowledge_base FROM public, anon;
REVOKE INSERT, UPDATE, DELETE ON public.fashion_knowledge_base FROM authenticated;
GRANT SELECT ON public.fashion_knowledge_base TO authenticated;
GRANT ALL ON public.fashion_knowledge_base TO service_role;


CREATE TABLE IF NOT EXISTS public.analysis_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  org_key TEXT NOT NULL DEFAULT 'global',
  cache_kind TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  sku_name TEXT NOT NULL DEFAULT '',
  product_category TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  hit_count INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE public.analysis_cache
SET org_key = COALESCE(organization_id::text, 'global')
WHERE org_key IS NULL OR org_key = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_cache_org_kind_key
  ON public.analysis_cache (org_key, cache_kind, cache_key);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_kind ON public.analysis_cache (cache_kind);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_expires ON public.analysis_cache (expires_at);

ALTER TABLE public.analysis_cache ENABLE ROW LEVEL SECURITY;

-- Cache is backend-only access, but we can grant read if needed. Usually only Edge Functions use it.
REVOKE ALL ON public.analysis_cache FROM public, anon, authenticated;
GRANT ALL ON public.analysis_cache TO service_role;


CREATE TABLE IF NOT EXISTS public.prompt_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_category TEXT NOT NULL DEFAULT 'general',
  pattern_kind TEXT NOT NULL DEFAULT 'pose',
  title TEXT NOT NULL DEFAULT '',
  pattern_text TEXT NOT NULL,
  success_count INT NOT NULL DEFAULT 1,
  failure_count INT NOT NULL DEFAULT 0,
  avg_quality NUMERIC(5, 2),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_patterns_cat ON public.prompt_patterns (product_category);
CREATE INDEX IF NOT EXISTS idx_prompt_patterns_kind ON public.prompt_patterns (pattern_kind);
CREATE INDEX IF NOT EXISTS idx_prompt_patterns_success ON public.prompt_patterns (success_count DESC);

ALTER TABLE public.prompt_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY prompt_patterns_select_current_org ON public.prompt_patterns
FOR SELECT TO authenticated
USING (
  organization_id = (SELECT private.current_organization_id())
  AND (SELECT private.has_permission('planning.view'))
);

REVOKE ALL ON public.prompt_patterns FROM public, anon;
REVOKE INSERT, UPDATE, DELETE ON public.prompt_patterns FROM authenticated;
GRANT SELECT ON public.prompt_patterns TO authenticated;
GRANT ALL ON public.prompt_patterns TO service_role;
