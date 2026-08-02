const SUPABASE_AUTH_TIMEOUT_MS = 8_000;

/**
 * Authentication must never hold an entire page request open indefinitely.
 * Keep the caller's cancellation signal while adding a hard transport limit.
 */
export function fetchSupabaseAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const timeoutSignal = AbortSignal.timeout(SUPABASE_AUTH_TIMEOUT_MS);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
}
