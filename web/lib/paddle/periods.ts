// Anchor every month to the original day, so Jan 31 → Feb 28 → Mar 31.
function addMonths(start: Date, months: number) {
  const date = new Date(start);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return date;
}

export function paddleMonthlyPeriods(start: Date, end: Date, months: number) {
  if (![1, 3, 6, 12].includes(months) || !Number.isFinite(+start) || !Number.isFinite(+end) || end <= start)
    throw new Error("Invalid paid period");
  // Paddle owns the billing boundary. Permit only a small calendar adjustment
  // (for a month-end renewal), never a short/prorated or extended package.
  if (Math.abs(+addMonths(start, months) - +end) > 3 * 86400000)
    throw new Error("Invalid paid period");
  return Array.from({ length: months }, (_, i) => {
    const from = addMonths(start, i);
    const until = i === months - 1 ? end : addMonths(start, i + 1);
    if (until <= from || until > end) throw new Error("Invalid paid period");
    return { start: from, end: until };
  });
}
