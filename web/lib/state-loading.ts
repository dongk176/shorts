const MAX_STATE_RETRY_DELAY_MS = 30_000;
// Allow the 8s authentication middleware + 10s server read deadline to finish
// and close their DB work before a browser retry can start.
export const STATE_REQUEST_TIMEOUT_MS = 20_000;

export function stateRetryDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  return Math.min(MAX_STATE_RETRY_DELAY_MS, 1_000 * (2 ** safeAttempt));
}
