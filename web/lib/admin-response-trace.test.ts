import { notFound, redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminResponseTrace } from "./admin-response-trace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("temporary administrator response diagnostics", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the identical result and emits only allowlisted metadata", async () => {
    const result = { email: "private@example.invalid", token: "private-token", id: "private-id" };
    const work = vi.fn(() => result);
    const trace = createAdminResponseTrace("admin-page");

    expect(await trace.run("cached-overview", work)).toBe(result);
    expect(work).toHaveBeenCalledOnce();
    const calls = vi.mocked(console.info).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [event, metadata] of calls) {
      expect(event).toBe("admin_response_trace");
      expect(Object.keys(metadata).sort()).toEqual([
        "elapsedMs", "phase", "scope", "status", "traceId",
      ]);
      expect(metadata.traceId).toMatch(/^[0-9a-f-]{36}$/);
      expect(metadata.scope).toBe("admin-page");
      expect(metadata.phase).toBe("cached-overview");
      expect(metadata.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    expect(calls.map(([, metadata]) => metadata.status)).toEqual(["start", "done"]);
    expect(calls[0][1].traceId).toBe(calls[1][1].traceId);
    expect(JSON.stringify(calls)).not.toMatch(/private|email|token/);
  });

  it("invokes work immediately once and does not replay a returned thenable", async () => {
    const consumed = vi.fn();
    const thenable: PromiseLike<string> = {
      then(onfulfilled, onrejected) {
        consumed();
        return Promise.resolve("value").then(onfulfilled, onrejected);
      },
    };
    const work = vi.fn(() => thenable);
    const result = createAdminResponseTrace("add-tester").run("transaction", work);
    expect(work).toHaveBeenCalledOnce();
    expect(await result).toBe("value");
    expect(consumed).toHaveBeenCalledOnce();
  });

  it("does not inspect or serialize error properties and rethrows the exact object", async () => {
    const forbiddenRead = vi.fn(() => { throw new Error("private-error-data"); });
    const error = Object.defineProperties({}, Object.fromEntries(
      ["name", "message", "stack", "digest", "toJSON"].map((key) => [key, { get: forbiddenRead }]),
    ));
    let thrown: unknown;
    try {
      await createAdminResponseTrace("admin-page").run("health", () => { throw error; });
    } catch (original) {
      thrown = original;
    }
    expect(thrown === error).toBe(true);
    expect(forbiddenRead).not.toHaveBeenCalled();
    expect(vi.mocked(console.info).mock.calls.map(([, metadata]) => metadata.status))
      .toEqual(["start", "error"]);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("private-error-data");
  });

  it.each([
    ["redirect", () => redirect("/private-destination")],
    ["notFound", () => notFound()],
  ])("preserves the exact Next %s exception", async (_name, navigation) => {
    let original: unknown;
    try { navigation(); } catch (error) { original = error; }
    expect(original).toBeDefined();
    await expect(createAdminResponseTrace("admin-page").run("auth", () => {
      throw original;
    })).rejects.toBe(original);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/NEXT_|private-destination/);
  });

  it("warns once after 15 seconds without settling, cancelling, or replaying work", async () => {
    vi.useFakeTimers();
    const gate = deferred<object>();
    const work = vi.fn(() => gate.promise);
    let finished = false;
    const pending = createAdminResponseTrace("admin-page").run("cached-overview", work)
      .then((result) => { finished = true; return result; });

    await vi.advanceTimersByTimeAsync(45_000);
    expect(finished).toBe(false);
    expect(work).toHaveBeenCalledOnce();
    expect(vi.mocked(console.info).mock.calls.map(([, metadata]) => metadata.status))
      .toEqual(["start", "waiting"]);
    const result = {};
    gate.resolve(result);
    expect(await pending).toBe(result);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(console.info).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])("clears the timer on early completion, rejected=%s", async (rejected) => {
    vi.useFakeTimers();
    const error = new Error("private-message");
    const pending = createAdminResponseTrace("root-layout").run("usage", () => {
      if (rejected) throw error;
      return 3;
    });
    if (rejected) await expect(pending).rejects.toBe(error);
    else expect(await pending).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(console.info).toHaveBeenCalledTimes(2);
  });

  it("leaves independent concurrent operations parallel with separate trace IDs", async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    const second = deferred<string>();
    const a = createAdminResponseTrace("admin-page").run("editor-queries", () => first.promise);
    const b = createAdminResponseTrace("root-layout").run("usage", () => second.promise);
    const starts = vi.mocked(console.info).mock.calls.map(([, metadata]) => metadata);
    expect(starts.map(({ status }) => status)).toEqual(["start", "start"]);
    expect(starts[0].traceId).not.toBe(starts[1].traceId);
    second.resolve("second");
    expect(await b).toBe("second");
    expect(vi.getTimerCount()).toBe(1);
    first.resolve("first");
    expect(await a).toBe("first");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cannot replace success or failure when console logging throws", async () => {
    vi.mocked(console.info).mockImplementation(() => { throw new Error("logger failed"); });
    const trace = createAdminResponseTrace("admin-page");
    trace.mark("entry", "start");
    expect(await trace.run("health", () => 5)).toBe(5);
    const original = new Error("original");
    await expect(trace.run("auth", () => Promise.reject(original))).rejects.toBe(original);
  });

  it("keeps serving when random trace generation or the warning timer is unavailable", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => { throw new Error("unavailable"); });
    vi.spyOn(globalThis, "setTimeout").mockImplementation(() => { throw new Error("unavailable"); });
    const work = vi.fn(() => 7);
    expect(await createAdminResponseTrace("middleware").run("auth", work)).toBe(7);
    expect(work).toHaveBeenCalledOnce();
    expect(console.info).not.toHaveBeenCalled();
  });

  it("never logs a non-allowlisted scope, phase, or status, even through unsafe casts", async () => {
    const secret = "private-query-token";
    const scope = secret as Parameters<typeof createAdminResponseTrace>[0];
    expect(await createAdminResponseTrace(scope).run("auth", () => 1)).toBe(1);
    const trace = createAdminResponseTrace("admin-page");
    trace.mark(secret as Parameters<typeof trace.mark>[0], "start");
    trace.mark("auth", secret as Parameters<typeof trace.mark>[1]);
    expect(await trace.run(secret as Parameters<typeof trace.run>[0], () => 2)).toBe(2);
    expect(console.info).not.toHaveBeenCalled();
  });
});
