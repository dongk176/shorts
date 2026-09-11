export const DAY_MS = 86_400_000;
export function kstDate(now: Date = new Date()) {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function validKstDate(value: string, now = new Date()) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0,4)) >= 1 &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value &&
    value <= kstDate(now)
  );
}
export function discoverySince(
  period: "today" | "week" | "all",
  now = new Date(),
) {
  if (period === "all") return null;
  const today = new Date(`${kstDate(now)}T00:00:00+09:00`);
  return new Date(today.getTime() - (period === "week" ? 6 * DAY_MS : 0));
}

// The list switches at 17:20 KST, but includes the search that starts at 17:10.
export function latestPublishableDiscoverySlot(now = new Date()) {
  const releaseAt = new Date(`${kstDate(now)}T17:20:00+09:00`);
  const slot = new Date(releaseAt.getTime() - 10 * 60_000);
  if (now < releaseAt) slot.setTime(slot.getTime() - DAY_MS);
  return slot;
}
export function discoverySlot(
  lane: "trending" | "views" | "reusable" | "free" | "refresh",
  now = new Date(),
) {
  const result = new Date(now);
  if (lane === "refresh") {
    result.setUTCMinutes(Math.floor(result.getUTCMinutes() / 15) * 15, 0, 0);
    return result;
  }
  if (lane === "trending") {
    result.setUTCHours(Math.floor(result.getUTCHours() / 2) * 2, 0, 0, 0);
    return result;
  }
  const minute = lane === "free" ? 40 : 10;
  const hours = lane === "free" ? [8] : [8, 20];
  const slots = [-1, 0].flatMap((day) =>
    hours.map((hour) => {
      const slot = new Date(now);
      slot.setUTCDate(slot.getUTCDate() + day);
      slot.setUTCHours(hour, minute, 0, 0);
      return slot;
    }),
  );
  return slots
    .filter((slot) => slot <= now)
    .sort((a, b) => b.getTime() - a.getTime())[0];
}
