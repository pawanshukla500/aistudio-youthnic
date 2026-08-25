type ReferenceLike = { id: string; role: string; uploadedId?: unknown };

// Only the explicit generic front/back labels can move automatically. A fabric
// close-up, mannequin image, or extra product image can contain several regions;
// it remains available for a member to map deliberately in the Studio UI.
export function remapDetectedSareeReferences<K extends string, T extends ReferenceLike>(
  references: Partial<Record<K, T>>,
): Partial<Record<K, T>> {
  const next = { ...references };
  for (const [legacyRole, sareeRole] of [
    ["front", "saree_front_drape"],
    ["back", "saree_back_drape"],
  ] as const) {
    const source = next[legacyRole as K];
    if (!source || next[sareeRole as K]) continue;
    next[sareeRole as K] = { ...source, role: sareeRole, uploadedId: undefined } as T;
    delete next[legacyRole as K];
  }
  return next;
}

export function promoteLegacySareeReference<K extends string, T extends ReferenceLike>(
  references: Partial<Record<K, T>>,
  sourceRole: K,
  targetRole: K,
  id: string,
): Partial<Record<K, T>> {
  const source = references[sourceRole];
  if (!source || references[targetRole]) return references;
  const next = {
    ...references,
    [targetRole]: { ...source, id, role: targetRole, uploadedId: undefined } as T,
  };
  // A generic upload has no proven regional meaning. Once a member explicitly
  // identifies it as pallu or body evidence, reclassify it rather than retaining
  // a contradictory generic authority. Regional source photos may support more
  // than one visible region, so those are preserved as an explicit duplicate.
  if (!sourceRole.startsWith("saree_")) delete next[sourceRole];
  return next;
}
