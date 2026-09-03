export const REUSABLE_VIEW_COUNTER_INTERVAL_MS = 5_000;
export const REUSABLE_VIEW_COUNTER_MIN_INTERVAL_MS = REUSABLE_VIEW_COUNTER_INTERVAL_MS;
export const REUSABLE_VIEW_COUNTER_MAX_INTERVAL_MS = REUSABLE_VIEW_COUNTER_INTERVAL_MS;

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

export function interpolateReusableViewCounterValue(
  startValue: number,
  targetValue: number,
  progress: number,
) {
  const start = finiteNonNegativeInteger(startValue);
  const target = Math.max(start, finiteNonNegativeInteger(targetValue));
  const normalizedProgress = Math.min(1, Math.max(0, progress));
  const easedProgress = 1 - Math.pow(1 - normalizedProgress, 4);
  return Math.min(
    target,
    Math.max(start, Math.round(start + (target - start) * easedProgress)),
  );
}

function finiteNonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
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
  while (cursor < endsAtMs) {
    if (cursor + REUSABLE_VIEW_COUNTER_INTERVAL_MS >= endsAtMs) {
      result.push(endsAtMs);
      break;
    }
    cursor += REUSABLE_VIEW_COUNTER_INTERVAL_MS;
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
