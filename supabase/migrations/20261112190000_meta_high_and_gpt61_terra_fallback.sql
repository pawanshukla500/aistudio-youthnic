-- Upgrade product_truth analysis and pose-planning routing to Meta Muse Spark (high thinking)
-- with OpenAI GPT 6.1 Terra (high thinking) as the primary fallback when Meta is primary and OpenAI fallback is enabled.
UPDATE public.organization_ai_model_policies
SET
  primary_reasoning = CASE
    WHEN primary_provider = 'meta' THEN 'high'
    WHEN primary_provider = 'openai' AND primary_model = 'gpt-6.1-terra' THEN 'high'
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
    THEN 'high'
    ELSE fallback_reasoning
  END,
  revision = revision + 1,
  updated_at = now()
WHERE purpose = 'product_truth'
  AND (
    (primary_provider = 'meta' AND primary_reasoning IS DISTINCT FROM 'high')
    OR (primary_provider = 'openai' AND primary_model = 'gpt-6.1-terra' AND primary_reasoning IS DISTINCT FROM 'high')
    OR (
      fallback_enabled IS TRUE
      AND primary_provider = 'meta'
      AND fallback_provider = 'openai'
      AND (
        fallback_model IS DISTINCT FROM 'gpt-6.1-terra'
        OR fallback_reasoning IS DISTINCT FROM 'high'
      )
    )
  );
