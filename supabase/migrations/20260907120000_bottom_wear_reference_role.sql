-- Optional dedicated bottom-wear / farshi product evidence. Kurta-set SKUs
-- often need a trousers crop whose print and volume are distinct from the
-- upper-garment FABRIC / PATTERN DETAIL close-up. Keep every legacy role.
alter table public.planning_assets
  drop constraint if exists planning_assets_asset_role_check;

alter table public.planning_assets
  add constraint planning_assets_asset_role_check check (
    asset_role = any (array[
      'front'::text,
      'back'::text,
      'fabric_pattern'::text,
      'bottom'::text,
      'mannequin'::text,
      'additional_product'::text,
      'saree_front_drape'::text,
      'saree_back_drape'::text,
      'saree_body_detail'::text,
      'saree_pallu_spread'::text,
      'saree_border_tassels'::text,
      'saree_blouse_front'::text,
      'saree_blouse_back_piece'::text,
      'style_reference'::text,
      'model_identity'::text,
      'catalog_reference'::text,
      'reference'::text,
      'generated'::text
    ])
  );
