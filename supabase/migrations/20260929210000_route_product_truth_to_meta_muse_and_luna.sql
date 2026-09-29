-- Update product_truth routing to use Meta Muse Spark as primary,
-- and OpenAI GPT 5.6 Luna (high thinking) as the first fallback, replacing legacy
-- high-cost GPT 5.6 Terra primary configurations. If an organization already opted
-- into Muse Spark Contributor, preserve contributor; otherwise use standard Muse Spark 1.3
-- so prompts are not exposed to Meta training without explicit selection.
UPDATE public.organization_ai_model_policies
SET
  primary_provider = 'meta',
  primary_model = CASE
    WHEN fallback_model = 'muse-spark-1.3-contributor' OR primary_model = 'muse-spark-1.3-contributor' THEN 'muse-spark-1.3-contributor'
    ELSE 'muse-spark-1.3'
  END,
  primary_reasoning = 'low',
  fallback_enabled = true,
  fallback_provider = 'openai',
  fallback_model = 'gpt-5.6-luna',
  fallback_reasoning = 'high',
  revision = revision + 1,
  updated_at = now()
WHERE purpose = 'product_truth'
  AND primary_provider = 'openai'
  AND primary_model = 'gpt-5.6-terra'
  AND fallback_provider = 'meta';
