-- Documented seed: live fashion_knowledge_base bottoms rows were pose/framing
-- only (waistband/hem readability). They never taught farshi/farsi pajama cut
-- or metallic floral print transfer, and app-api did not read this table.
-- This row is global (organization_id null) so the Edge Function can inject it
-- as subordinate cut/print guidance. Product references still outrank it.
insert into public.fashion_knowledge_base (
  organization_id, category, topic, title, guidance, tags, priority, source, is_active
)
select
  null,
  'kurta_or_kurti_set',
  'bottom_wear',
  'Farshi / farsi pajama cut and print lock',
  $guidance$Farshi / farsi pajama is extremely voluminous floor-length trousers with TWO DISTINCT LEGS, heavy vertical pleating or gathers from the waist/hip, and architectural volume that may trail or pool at the floor. It is NOT palazzo, NOT plain wide-leg, NOT a lehenga/skirt, NOT dhoti, and NOT an ankle-cuffed salwar. Copy the exact bottom fabric color and large-scale metallic gold/silver floral/boota motifs from FRONT/BACK/MANNEQUIN/BOTTOM references at the same physical scale. Never render the bottoms as solid/undecorated color or as faint dots/speckles. FABRIC / PATTERN DETAIL of the kurta/upper embroidery is not bottom-print authority.$guidance$,
  array['bottom','farshi','farsi','pajama','print','silhouette']::text[],
  90,
  'seed',
  true
where not exists (
  select 1
  from public.fashion_knowledge_base
  where title = 'Farshi / farsi pajama cut and print lock'
    and topic = 'bottom_wear'
);
