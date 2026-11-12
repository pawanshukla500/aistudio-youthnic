-- Default all remaining OpenAI image_generation policies to flagship gpt-image-2.6-sunburst
-- and update / seed cut-isolated Farshi, Gen-Z Saree, Multi-Piece Dupatta, and Top-Only Kurti knowledge.

UPDATE public.organization_ai_model_policies
SET
  primary_model = 'gpt-image-2.6-sunburst',
  primary_reasoning = 'none',
  revision = revision + 1,
  updated_at = now()
WHERE purpose = 'image_generation'
  AND primary_provider = 'openai'
  AND primary_model IN (
    'gpt-image-2',
    'gpt-image-2.5-flare-2026-09-08',
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst'
  );

UPDATE public.fashion_knowledge_base
SET
  guidance = $farshi$Farshi ONLY: 2 trouser legs, narrow hem from waist side, 6-inch joined hem panel tapering 4 inches inward from upper hem seam, waist & side-joint pleats. Copy bottom color & print verbatim; never palazzo, lehenga, or poncha. Never apply to non-Farshi cuts.$farshi$,
  updated_at = now()
WHERE organization_id IS NULL
  AND title = 'Farshi / farsi pajama cut and print lock'
  AND topic = 'bottom_wear';

INSERT INTO public.fashion_knowledge_base (
  organization_id, category, topic, title, guidance, tags, priority, source, is_active
)
SELECT
  NULL,
  'saree',
  'saree_drape',
  'Gen-Z saree drape and editorial pose discipline',
  $saree$Gen-Z saree poise: fluid Nivi/uploaded drape, crisp stacked waist pleats, exact pallu boundary & equal borders. Vary poses cleanly (hero front, 3/4 turn, seated editorial, true rear blouse/pallu, macro craft, motion showcase). Unstitched drape only — zero trousers or duplicate pallus.$saree$,
  ARRAY['saree', 'genz', 'drape', 'pallu', 'pleats']::text[],
  85,
  'seed',
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.fashion_knowledge_base
  WHERE organization_id IS NULL
    AND title = 'Gen-Z saree drape and editorial pose discipline'
    AND topic = 'saree_drape'
);

INSERT INTO public.fashion_knowledge_base (
  organization_id, category, topic, title, guidance, tags, priority, source, is_active
)
SELECT
  NULL,
  'kurta_or_kurti_set',
  'dupatta_drape',
  'Multi-piece kurti set dupatta detection and rear clearance',
  $dupatta$Scan mannequin/flat-lay, additional_product, front & back for dupatta/stole. Render exact fabric, ombré colors, motifs & gota trim across all frames; drape forward over both arms on Pose 3 back view so rear neckline stays 100% clear. Keep Pose 5 on primary kurti craft.$dupatta$,
  ARRAY['dupatta', 'kurti_set', 'mannequin', 'back_pose', 'styling']::text[],
  82,
  'seed',
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.fashion_knowledge_base
  WHERE organization_id IS NULL
    AND title = 'Multi-piece kurti set dupatta detection and rear clearance'
    AND topic = 'dupatta_drape'
);

INSERT INTO public.fashion_knowledge_base (
  organization_id, category, topic, title, guidance, tags, priority, source, is_active
)
SELECT
  NULL,
  'kurta_or_kurti_set',
  'top_only',
  'Standalone top-only kurti proportion and non-set rule',
  $toponly$Standalone top-only kurti: pair ONLY with plain solid neutral styling trousers; never copy top print, embroidery, or color onto bottoms, and apply non-Farshi straight/relaxed styling only. Vary poses to highlight neckline, sleeves, length & primary craft.$toponly$,
  ARRAY['top_only', 'kurti', 'standalone', 'proportion']::text[],
  80,
  'seed',
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.fashion_knowledge_base
  WHERE organization_id IS NULL
    AND title = 'Standalone top-only kurti proportion and non-set rule'
    AND topic = 'top_only'
);

UPDATE public.learning_outcomes
SET
  trigger_condition = COALESCE(trigger_condition, '{}'::jsonb) || jsonb_build_object('garment_family', 'kurta_or_kurti_set', 'bottom_cut', 'farshi'),
  updated_at = now()
WHERE COALESCE(trigger_condition->>'bottom_cut', '') = ''
  AND (
    rule_text ~* '\y(farshi|farsi|fasi)\y'
    OR positive_guidance ~* '\y(farshi|farsi|fasi)\y|4-?inch.*taper|6-?inch joined hem'
  );

