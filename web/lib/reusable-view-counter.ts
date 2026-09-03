export const REUSABLE_VIEW_COUNTER_MIN_INTERVAL_MS = 3_000;
export const REUSABLE_VIEW_COUNTER_MAX_INTERVAL_MS = 60_000;

export type ReusableViewCounterSchedule = {
  startValue: number;
  targetValue: number;
  startedAt: string;
  endsAt: string;
};

export type ReusableViewCounterState = ReusableViewCounterSchedule & {
  serverNow: string;
};

export type ReusableViewCounterProjection = {
  value: number;
  nextChangeAtMs: number | null;
};

function finiteNonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function scheduleSeed(schedule: ReusableViewCounterSchedule) {
  const startedAt = Date.parse(schedule.startedAt);
  const target = finiteNonNegativeInteger(schedule.targetValue);
  let seed = (Number.isFinite(startedAt) ? startedAt : 0) >>> 0;
  seed ^= target >>> 0;
  seed ^= Math.floor(target / 0x1_0000_0000) >>> 0;
  seed ^= 0x9e37_79b9;
  return seed >>> 0 || 0x6d2b_79f5;
}

function nextSeed(value: number) {
  let next = value >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

export function reusableViewCounterChangeTimes(
  schedule: ReusableViewCounterSchedule,
) {
  const startedAtMs = Date.parse(schedule.startedAt);
  const endsAtMs = Date.parse(schedule.endsAt);
  if (
    !Number.isFinite(startedAtMs)
    || !Number.isFinite(endsAtMs)
    || endsAtMs <= startedAtMs
  ) return [];

  const result: number[] = [];
  let cursor = startedAtMs;
  let seed = scheduleSeed(schedule);
  while (cursor < endsAtMs) {
    const remaining = endsAtMs - cursor;
    if (remaining <= REUSABLE_VIEW_COUNTER_MAX_INTERVAL_MS) {
      result.push(endsAtMs);
      break;
    }
    seed = nextSeed(seed);
    const maximumGap = Math.min(
      REUSABLE_VIEW_COUNTER_MAX_INTERVAL_MS,
      remaining - REUSABLE_VIEW_COUNTER_MIN_INTERVAL_MS,
    );
    const gapRange = maximumGap - REUSABLE_VIEW_COUNTER_MIN_INTERVAL_MS + 1;
    const gap = REUSABLE_VIEW_COUNTER_MIN_INTERVAL_MS + (seed % gapRange);
    cursor += gap;
    result.push(cursor);
  }
  return result;
}

function completedChangeCount(changeTimes: number[], atMs: number) {
  let low = 0;
  let high = changeTimes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (changeTimes[middle] <= atMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function projectReusableViewCounter(
  schedule: ReusableViewCounterSchedule,
  atMs: number,
  changeTimes = reusableViewCounterChangeTimes(schedule),
): ReusableViewCounterProjection {
  const startValue = finiteNonNegativeInteger(schedule.startValue);
  const targetValue = Math.max(
    startValue,
    finiteNonNegativeInteger(schedule.targetValue),
  );
  if (!changeTimes.length) return { value: targetValue, nextChangeAtMs: null };

  const completed = completedChangeCount(changeTimes, atMs);
  if (completed >= changeTimes.length) {
    return { value: targetValue, nextChangeAtMs: null };
  }
  const difference = targetValue - startValue;
  const revealed = Number(
    (BigInt(difference) * BigInt(completed)) / BigInt(changeTimes.length),
  );
  const value = startValue + revealed;
  return {
    value,
    nextChangeAtMs: changeTimes[completed],
  };
}

export function nextDailyReusableCollectionAt(startedAt: Date) {
  const result = new Date(startedAt);
  result.setUTCHours(8, 0, 0, 0);
  if (
    result.getTime() <= startedAt.getTime() + REUSABLE_VIEW_COUNTER_MIN_INTERVAL_MS
  ) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}
