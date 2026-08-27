-- Production Pipeline Enhancements: Reference Library, Approval Workflow, Budgets, and Batch Uploads

-- 1. Reference Image Library
CREATE TABLE IF NOT EXISTS public.reference_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  download_url TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'aesthetic',
  tags TEXT[] NOT NULL DEFAULT '{}',
  usage_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reference_library_org ON public.reference_library (organization_id);
ALTER TABLE public.reference_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY reference_library_select_current_org ON public.reference_library
FOR SELECT TO authenticated
USING (
  organization_id = (SELECT private.current_organization_id())
  AND (SELECT private.has_permission('planning.view'))
);
-- We allow inserts from Edge functions or authenticated users (with permission)
CREATE POLICY reference_library_insert_current_org ON public.reference_library
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = (SELECT private.current_organization_id())
  AND (SELECT private.has_permission('planning.edit'))
);
CREATE POLICY reference_library_update_current_org ON public.reference_library
FOR UPDATE TO authenticated
USING (
  organization_id = (SELECT private.current_organization_id())
  AND (SELECT private.has_permission('planning.edit'))
);


-- 2. Generation Approval Workflow
-- Altering session_generations to add approval fields
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='session_generations' AND column_name='approval_status') THEN
    ALTER TABLE public.session_generations ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected'));
    ALTER TABLE public.session_generations ADD COLUMN approved_by UUID REFERENCES public.organization_members(id) ON DELETE SET NULL;
    ALTER TABLE public.session_generations ADD COLUMN approved_at TIMESTAMPTZ;
    ALTER TABLE public.session_generations ADD COLUMN approval_notes TEXT;
  END IF;
END $$;


-- 3. Organization Budgets
CREATE TABLE IF NOT EXISTS public.organization_budgets (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  daily_limit NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
  weekly_limit NUMERIC(10, 2) NOT NULL DEFAULT 200.00,
  monthly_limit NUMERIC(10, 2) NOT NULL DEFAULT 1000.00,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.organization_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_budgets_select_current_org ON public.organization_budgets
FOR SELECT TO authenticated
USING (
  organization_id = (SELECT private.current_organization_id())
  AND (SELECT private.has_permission('admin.view'))
);


-- 4. Batch Upload Jobs
CREATE TABLE IF NOT EXISTS public.batch_upload_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  completed_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_by UUID REFERENCES public.organization_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_upload_jobs_org ON public.batch_upload_jobs (organization_id);
ALTER TABLE public.batch_upload_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY batch_upload_jobs_select_current_org ON public.batch_upload_jobs
FOR SELECT TO authenticated
USING (
  organization_id = (SELECT private.current_organization_id())
  AND (SELECT private.has_permission('planning.view'))
);
CREATE POLICY batch_upload_jobs_insert_current_org ON public.batch_upload_jobs
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = (SELECT private.current_organization_id())
  AND (SELECT private.has_permission('planning.edit'))
);
