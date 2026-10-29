const QUEUE_POSE_IDS = ["full_front", "angled", "back", "creative", "closeup", "showcase"] as const;

type PosePlanEntry = {
  id?: unknown;
  prompt?: unknown;
  enabled?: unknown;
};

// Legacy five-pose plans use the current plan's first five ordered slots.
export function isQueueCompatiblePosePlan(value: unknown): boolean {
  if (!Array.isArray(value) || (value.length !== 5 && value.length !== 6)) return false;
  return value.every((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const pose = entry as PosePlanEntry;
    return pose.id === QUEUE_POSE_IDS[index]
      && pose.enabled !== false
      && typeof pose.prompt === "string"
      && Boolean(pose.prompt.trim());
  });
}
