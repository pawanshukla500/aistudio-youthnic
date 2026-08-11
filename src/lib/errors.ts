export function getErrorMessage(reason: unknown, fallback: string) {
  if (!(reason instanceof Error)) return fallback;
  const uncaught = reason.message.match(/Uncaught Error:\s*([^\n]+)/);
  if (uncaught?.[1]) return uncaught[1].trim();
  const cleaned = reason.message.replace(/^\[Request ID:[^\]]+\]\s*(Server Error\s*)?/i, "").trim();
  return cleaned || fallback;
}
