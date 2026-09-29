-- Update product_truth routing to use Meta Muse Spark 1.3 Contributor as primary,
-- and OpenAI GPT 5.6 Luna (high thinking) as the first fallback, replacing legacy
-- high-cost GPT 5.6 Terra primary configurations.
UPDATE public.organization_ai_model_policies
SET
  primary_provider = 'meta',
  primary_model = 'muse-spark-1.3-contributor',
  primary_reasoning = 'high',
  fallback_enabled = true,
  fallback_provider = 'openai',
  fallback_model = 'gpt-5.6-luna',
  fallback_reasoning = 'high',
  revision = revision + 1,
  updated_at = now()
WHERE purpose = 'product_truth'
  AND (
    (primary_provider = 'openai' AND primary_model IN ('gpt-5.6-terra', 'gpt-5.6-sol'))
    OR (primary_provider = 'openai' AND fallback_provider = 'meta')
  );
