-- Allow 'zai' (Z.ai GLM 5.3 Flash / FlashX) as a primary and fallback vision provider in organization_ai_model_policies

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

ALTER TABLE public.organization_ai_model_policies
ADD CONSTRAINT organization_ai_model_policies_primary_provider_check
CHECK (primary_provider IN ('gemini', 'openai', 'zai', 'qwen', 'meta', 'reve'));

ALTER TABLE public.organization_ai_model_policies
ADD CONSTRAINT organization_ai_model_policies_fallback_provider_check
CHECK (fallback_provider IN ('gemini', 'openai', 'zai', 'qwen', 'meta', 'reve'));
