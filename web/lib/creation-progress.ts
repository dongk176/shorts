const MIN_CREATION_MINUTES = 5;
const MAX_CREATION_MINUTES = 15;
export const SIMULATED_PROGRESS_START = 1;
const MAX_IN_PROGRESS = 99;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function estimatedCreationMinutes(durationSeconds: number) {
  const safeDurationSeconds = Number.isFinite(durationSeconds)
    ? clamp(durationSeconds, 0, 60 * 60)
    : 0;
  const durationMinutes = safeDurationSeconds / 60;

  // Linear allocation through the requested anchors: 20 min -> 8 min,
  // 60 min -> 15 min. Short videos keep a practical five-minute floor.
  return Math.round(clamp(
    4.5 + durationMinutes * 0.175,
    MIN_CREATION_MINUTES,
    MAX_CREATION_MINUTES,
  ));
}

export function estimatedRerenderMinutes(durationSeconds: number) {
  const safeDurationSeconds = Number.isFinite(durationSeconds)
    ? Math.max(0, durationSeconds)
    : 0;
  return clamp(Math.ceil(safeDurationSeconds / 30), 1, 2);
}

export function estimatedProgress(
  startedAtMs: number,
  nowMs: number,
  estimatedMinutes: number,
) {
  const durationMs = Math.max(1, estimatedMinutes * 60_000);
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const ratio = clamp(elapsedMs / durationMs, 0, 1);
  return SIMULATED_PROGRESS_START + (MAX_IN_PROGRESS - SIMULATED_PROGRESS_START) * ratio;
}

export function estimatedRemainingMinutes(
  startedAtMs: number,
  nowMs: number,
  estimatedMinutes: number,
) {
  const remainingMs = estimatedMinutes * 60_000 - Math.max(0, nowMs - startedAtMs);
  return Math.max(0, Math.ceil(remainingMs / 60_000));
}

export function estimatedRemainingLabel(remainingMinutes: number) {
  return remainingMinutes > 0
    ? `약 ${remainingMinutes}분 남음`
    : "마무리 중";
}
