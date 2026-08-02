export const SUPABASE_AUTH_TIMEOUT_MS = 8_000;

export class SupabaseAuthTimeoutError extends Error {
  constructor() {
    super("Supabase authentication timed out.");
    this.name = "SupabaseAuthTimeoutError";
  }
}

/**
 * Supabase auth can wait before or after its transport request (for example,
 * while refreshing or coordinating a session). Bound the whole operation,
 * not only the underlying fetch.
 */
export async function withSupabaseAuthTimeout<T>(
  operation: PromiseLike<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SupabaseAuthTimeoutError()),
          SUPABASE_AUTH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
