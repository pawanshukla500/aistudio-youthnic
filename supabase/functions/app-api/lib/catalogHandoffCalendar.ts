export function isoWeekday(iso: string) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function shiftIsoDate(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function previousBusinessDate(todayIso: string, weekdays: number[], holidays: string[]) {
  const allowed = new Set(weekdays.length ? weekdays : [1, 2, 3, 4, 5]);
  const blocked = new Set(holidays);
  for (let offset = 1; offset <= 370; offset++) {
    const candidate = shiftIsoDate(todayIso, -offset);
    if (allowed.has(isoWeekday(candidate)) && !blocked.has(candidate)) return candidate;
  }
  throw new Error("The configured business calendar has no eligible handoff day.");
}
