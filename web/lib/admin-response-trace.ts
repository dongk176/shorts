// TEMPORARY diagnostic candidate only; not a production promotion artifact.
// No request/user data, results, or error properties may enter these events.
const scopes = ["middleware", "admin-page", "root-layout", "add-tester"] as const;
const phases = [
  "entry", "health", "auth", "params", "base-queries", "cached-overview",
  "editor-queries", "editor-state", "editor-releases", "editor-checks",
  "editor-testers", "editor-renders", "messages", "app-user", "usage",
  "transaction", "transaction-finished", "revalidate", "return",
] as const;
const statuses = ["start", "done", "error", "waiting"] as const;
type Phase = typeof phases[number];
type Status = typeof statuses[number];

export function createAdminResponseTrace(scope: typeof scopes[number]) {
  let traceId: string | undefined;
  let startedAt = 0;
  try {
    traceId = globalThis.crypto.randomUUID();
    startedAt = performance.now();
  } catch {
    // Diagnostics must not become a prerequisite for serving a request.
    traceId = undefined;
  }

  function mark(phase: Phase, status: Status) {
    try {
      if (!traceId || !scopes.includes(scope)
        || !phases.includes(phase) || !statuses.includes(status)) return;
      console.info("admin_response_trace", {
        traceId, scope, phase, status,
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    } catch {
      // Logging failure cannot replace the original result or exception.
    }
  }

  async function run<T>(phase: Phase, work: () => T | PromiseLike<T>): Promise<T> {
    mark(phase, "start");
    let warning: ReturnType<typeof setTimeout> | undefined;
    try {
      try {
        // Observation only: no deadline, cancellation, retry, or new request.
        warning = setTimeout(() => mark(phase, "waiting"), 15_000);
        warning.unref?.();
      } catch {
        // A missing diagnostic timer must not prevent the original work.
      }
      const result = await work();
      mark(phase, "done");
      return result;
    } catch (error) {
      mark(phase, "error");
      throw error; // Preserve Next redirect/notFound and every other exception.
    } finally {
      try {
        if (warning !== undefined) clearTimeout(warning);
      } catch {
        // Cleanup of a diagnostic timer must not replace a request outcome.
      }
    }
  }

  return { mark, run };
}
