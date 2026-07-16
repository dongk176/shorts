const MAX_STATE_RETRY_DELAY_MS = 30_000;

export function stateRetryDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  return Math.min(MAX_STATE_RETRY_DELAY_MS, 1_000 * (2 ** safeAttempt));
}
