-- Drop the old primary_provider check constraint if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'organization_ai_model_policies_primary_provider_check'
    ) THEN
        ALTER TABLE public.organization_ai_model_policies 
        DROP CONSTRAINT organization_ai_model_policies_primary_provider_check;
    END IF;
END $$;

-- Drop the old fallback_provider check constraint if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'organization_ai_model_policies_fallback_provider_check'
    ) THEN
        ALTER TABLE public.organization_ai_model_policies 
        DROP CONSTRAINT organization_ai_model_policies_fallback_provider_check;
    END IF;
END $$;

-- Add the new constraints that include 'reve'
ALTER TABLE public.organization_ai_model_policies 
ADD CONSTRAINT organization_ai_model_policies_primary_provider_check 
CHECK (primary_provider IN ('gemini', 'openai', 'qwen', 'meta', 'reve'));

ALTER TABLE public.organization_ai_model_policies 
ADD CONSTRAINT organization_ai_model_policies_fallback_provider_check 
CHECK (fallback_provider IN ('gemini', 'openai', 'qwen', 'meta', 'reve'));
