-- Studio accepts mannequin and flat-lay product shots as their own reference
-- role. They carry worn shape, proportion, length and drape, which a front/back
-- flat photograph alone does not resolve, and the analysis has to know the
-- garment was photographed on apparatus so it never renders the dress form.

alter table public.planning_assets
  drop constraint if exists planning_assets_asset_role_check;
alter table public.planning_assets
  add constraint planning_assets_asset_role_check check (
    asset_role = any (array[
      'front'::text,
      'back'::text,
      'fabric_pattern'::text,
      'mannequin'::text,
      'additional_product'::text,
      'style_reference'::text,
      'model_identity'::text,
      'catalog_reference'::text,
      'reference'::text,
      'generated'::text
    ])
  );
