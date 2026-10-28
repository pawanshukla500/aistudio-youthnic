function poseIndex(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const index = Number(row.poseIndex ?? row.pose_index);
  return Number.isInteger(index) && index >= 1 && index <= 6 ? index : null;
}

/**
 * Legacy approved packages contain poses 1-5; current packages contain poses
 * 1-6. Duplicate, missing, or unexpected pose rows do not form a complete package.
 */
export function isCompleteCatalogHandoffPackage(poses: unknown): boolean {
  if (!Array.isArray(poses)) return false;
  const indexes = poses.map(poseIndex);
  if (indexes.some((index) => index === null)) return false;
  const unique = new Set(indexes as number[]);
  if (unique.size !== poses.length) return false;
  const required = unique.has(6) ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  return unique.size === required.length && required.every((index) => unique.has(index));
}
