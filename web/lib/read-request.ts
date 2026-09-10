import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { readDbContext } from "@/lib/db-read-context";
import { HttpError } from "@/lib/http";

export const READ_REQUEST_TIMEOUT_MS = 10_000;
const MAX_ACTIVE_READ_REQUESTS = 4;
let activeReadRequests = 0;

export type ReadStage = <T>(name: string, task: () => Promise<T>) => Promise<T>;

function unavailable(code: string) {
  return new HttpError(503, "응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.", code, 2);
}

/**
 * A short-lived connection to the external transaction pooler, isolated from
 * writes and other requests. Closing a timed-out request cannot interrupt a
 * payment or leave a poisoned connection for the next read. The local admission
 * cap bounds connection count without an unbounded pool acquisition queue.
 */
export async function withReadRequest<T>(
  operation: string,
  task: (stage: ReadStage) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw unavailable("READ_REQUEST_ABORTED");
  if (activeReadRequests >= MAX_ACTIVE_READ_REQUESTS) {
    console.warn("read_request_busy", { operation, activeReadRequests });
    throw unavailable("READ_REQUEST_BUSY");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  const db = postgres(connectionString, {
    max: 1,
    connect_timeout: 3,
    idle_timeout: 2,
    prepare: false,
    transform: postgres.camel,
  });
  activeReadRequests += 1;
  const requestId = randomUUID();
  const startedAt = Date.now();
  const pending = new Set<string>(["connect"]);
  const timings: Record<string, number> = {};
  let context: { db: Sql; active: boolean } | undefined;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stage: ReadStage = async (name, run) => {
    if (finished) throw unavailable("READ_REQUEST_ABORTED");
    const start = Date.now();
    pending.add(name);
    try {
      return await run();
    } finally {
      pending.delete(name);
      timings[name] = Date.now() - start;
    }
  };
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(unavailable("READ_REQUEST_TIMEOUT")), READ_REQUEST_TIMEOUT_MS);
      onAbort = () => reject(unavailable("READ_REQUEST_ABORTED"));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    // Existing release-attestation SELECT functions acquire FOR SHARE locks.
    // Keep those guards intact; callers opt out of session writes explicitly.
    // This transaction is used only by the audited state/template read paths.
    const work = db.begin("read write", async (tx) => {
      if (finished) throw unavailable("READ_REQUEST_ABORTED");
      timings.connect = Date.now() - startedAt;
      pending.delete("connect");
      // Startup/session settings are not retained by Supavisor transaction mode.
      // SET LOCAL is applied on the same reserved transaction as all these reads.
      await stage("limits", async () => {
        await tx`select set_config('statement_timeout', '4000', true),
          set_config('lock_timeout', '1000', true),
          set_config('idle_in_transaction_session_timeout', '10000', true)`;
      });
      context = { db: tx as unknown as Sql, active: true };
      return { value: await readDbContext.run(context, () => task(stage)) };
    });
    return (await Promise.race([work, deadline])).value;
  } catch (error) {
    console.warn("read_request_failed", {
      operation, requestId, elapsedMs: Date.now() - startedAt,
      pending: [...pending], timings,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: String((error as { code?: unknown })?.code ?? "").slice(0, 64),
    });
    const code = (error as { code?: unknown })?.code;
    if (code === "57014" || code === "55P03" || code === "25P03" || code === "53300"
      || (typeof code === "string" && /^(CONNECTION_|CONNECT_|08|57P0[123]$|ECONNRESET$|ECONNREFUSED$|ETIMEDOUT$|EPIPE$)/.test(code))) {
      throw unavailable("READ_REQUEST_UNAVAILABLE");
    }
    throw error;
  } finally {
    finished = true;
    if (context) context.active = false;
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    // Promise.race alone does not stop SQL: destroy this request's connection,
    // including any queued statements, before allowing another browser retry.
    await db.end({ timeout: 0 }).catch(() => undefined);
    activeReadRequests -= 1;
    if (Date.now() - startedAt >= 2_000) {
      console.info("read_request_slow", {
        operation, requestId, elapsedMs: Date.now() - startedAt, timings,
      });
    }
  }
}
