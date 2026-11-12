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
  guidance = $farshi$Farshi / farsi salwar features TWO DISTINCT TROUSER LEGS with high/mid-rise elasticated or fitted waist, three waist pleats per side, and one large pleat at each side-seam joint. The hem is quite narrow from the waist side: a separate 6-inch joined hem panel is seamed onto each leg with a 4-inch inward taper from the upper hem seam to the lower ankle opening (4 inches narrower at bottom than upper hem seam). It is NOT an open wide-leg palazzo, NOT a circular lehenga/skirt, NOT dhoti, and NOT a gathered salwar poncha. Preserve exact bottom color and large-scale print motifs from FRONT/BACK/MANNEQUIN/BOTTOM references. NEVER apply this tapered Farshi construction to palazzo, sharara, gharara, straight trousers, or salwar cuts.$farshi$,
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
  $saree$Present sarees with contemporary Gen-Z editorial poise: clean fluid Nivi shoulder drape or exact uploaded drape family, crisp evenly stacked vertical waist pleats, exact pallu starting boundary and motif scale, and equal-width upper/lower borders. Vary stances gracefully across hero front, 3/4 turn, relaxed seated editorial, true rear blouse/pallu view, macro pallu/zari craft crop, and flowing motion showcase. Strictly continuous unstitched saree drape — zero trousers, palazzos, or duplicate pallus.$saree$,
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
  $dupatta$Always inspect mannequin/flat-lay, additional_product, front, and back uploads for a folded or draped dupatta/stole. When present, preserve exact fabric weight, ombré color transition, motifs, and edge gota/lace trim across every frame; drape it gracefully over one forearm/shoulder in front/angled poses leaving neckline craft and bottom-wear cut visible, and sweep it forward over both arms/elbows on pose 3 (true back) so the rear neckline and closures are 100% unobstructed. Never let a secondary dupatta hijack Pose 5 when primary garment craft exists.$dupatta$,
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
  $toponly$When product references prove a standalone kurti/top without bottom wear, keep bottom wear explicitly unbranded, plain solid neutral styling trousers (never copy kurti color, print, embroidery, or border onto bottoms and never apply Farshi rules). Vary poses organically to showcase neckline, fit, sleeve cut, hem length, and front/back craftsmanship.$toponly$,
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

