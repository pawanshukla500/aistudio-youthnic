-- Migration: Add saree-specific roles to product_reference_evidence role check constraint

alter table public.product_reference_evidence
  drop constraint if exists product_reference_evidence_role_check;

alter table public.product_reference_evidence
  add constraint product_reference_evidence_role_check check (role in (
    'front', 'back', 'bottom', 'fabric_pattern', 'mannequin',
    'additional_product', 'model_identity', 'style_reference', 'approved_pose',
    'saree_front_drape', 'saree_back_drape', 'saree_body_detail', 'saree_pallu_spread',
    'saree_border_tassels', 'saree_blouse_front', 'saree_blouse_back_piece'
  ));
