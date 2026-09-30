-- Normalize product_truth fallback reasoning to 'low' for OpenAI Luna fallback
-- configurations. When running under the fallback deadline (~45s), high reasoning effort
-- exceeds the hop budget and triggers timeout cascades across all configured vision models.
UPDATE public.organization_ai_model_policies
SET
  fallback_reasoning = 'low',
  revision = revision + 1,
  updated_at = now()
WHERE purpose = 'product_truth'
  AND fallback_provider = 'openai'
  AND fallback_model = 'gpt-5.6-luna'
  AND fallback_reasoning = 'high';
