import postgres from "postgres";

export const THEPAYONE_REQUEST_GAP_SECONDS = 3;
const ADMISSION_TIMEOUT_MS = 25_000;

export class ThePayOneSpacingError extends Error {
  constructor(readonly dispatched = false) {
    super("ThePayOne request spacing unavailable");
    this.name = "ThePayOneSpacingError";
  }
}

/**
 * One transaction lock for every endpoint/credential scope and server instance.
 * Wait AFTER acquiring it, before dispatch, and hold it through the response.
 * Even a rolled-back/failed request is followed by a full three-second gap.
 * Transaction locks work with the existing Supabase transaction pooler; no
 * session locks, schema writes, credentials in lock keys, or local-only bypass.
 */
export async function withThePayOneSpacing<T>(operation: () => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new ThePayOneSpacingError();

  // Separate from the application pool: callers may already hold transactions.
  // A short-lived connection avoids nested-pool deadlocks and is always closed.
  const db = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 5,
    connection: { application_name: "shorts-thepayone-spacing" },
  });
  let expired = false;
  let dispatched = false;
  let outcome: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const admissionTimeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new ThePayOneSpacingError());
    }, ADMISSION_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      db.begin(async (tx) => {
        if (expired) throw new ThePayOneSpacingError();
        await tx`set local statement_timeout = '23s'`;
        await tx`set local lock_timeout = '20s'`;
        // The provider request/body has a 15-second abort deadline.
        await tx`set local idle_in_transaction_session_timeout = '25s'`;
        await tx`select pg_advisory_xact_lock(1936224116, 1953525615)`;
        await tx`select pg_sleep(${THEPAYONE_REQUEST_GAP_SECONDS})`;
        if (expired) throw new ThePayOneSpacingError();
        dispatched = true;
        clearTimeout(timer);
        try {
          outcome = { ok: true, value: await operation() };
        } catch (error) {
          // Preserve the provider outcome even if transaction cleanup fails.
          outcome = { ok: false, error };
        }
      }),
      admissionTimeout,
    ]);
  } catch {
    if (!outcome) throw new ThePayOneSpacingError(dispatched);
  } finally {
    expired = true;
    clearTimeout(timer);
    await db.end({ timeout: 1 }).catch(() => undefined);
  }
  // This transaction contains no business writes. A commit failure must not
  // turn a confirmed payment success into a retryable payment failure.
  if (!outcome) throw new ThePayOneSpacingError(dispatched);
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
