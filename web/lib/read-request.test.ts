import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ postgres: vi.fn() }));
vi.mock("postgres", () => ({ default: mocks.postgres }));

function client() {
  const tx = vi.fn().mockResolvedValue([]);
  return {
    tx,
    begin: vi.fn(async (_mode: string, run: (sql: unknown) => Promise<unknown>) => run(tx)),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe("bounded isolated read requests", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://read-test.invalid/test");
    vi.stubEnv("NODE_ENV", "production");
    mocks.postgres.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("uses effective transaction-local limits and leaves the ordinary write pool intact", async () => {
    const writes = client();
    const reads = client();
    mocks.postgres.mockReturnValueOnce(writes).mockReturnValueOnce(reads);
    const { getDb } = await import("./db");
    const { withReadRequest } = await import("./read-request");
    expect(getDb()).toBe(writes);
    await expect(withReadRequest("test", async () => {
      expect(getDb()).toBe(reads.tx);
      return "ok";
    })).resolves.toBe("ok");
    expect(reads.begin).toHaveBeenCalledWith("read write", expect.any(Function));
    expect(reads.tx.mock.calls[0][0].join("")).toContain("set_config('statement_timeout', '4000', true)");
    expect(reads.end).toHaveBeenCalledWith({ timeout: 0 });
    expect(getDb()).toBe(writes);
    expect(writes.end).not.toHaveBeenCalled();
  });

  it("closes a stalled connection before the deadline returns and gives the next request a fresh connection", async () => {
    vi.useFakeTimers();
    const stalled = client();
    stalled.begin.mockImplementation(() => new Promise(() => undefined));
    const healthy = client();
    mocks.postgres.mockReturnValueOnce(stalled).mockReturnValueOnce(healthy);
    const { withReadRequest, READ_REQUEST_TIMEOUT_MS } = await import("./read-request");
    const task = vi.fn().mockResolvedValue("fresh");
    const first = expect(withReadRequest("state", task)).rejects.toMatchObject({ status: 503, code: "READ_REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(READ_REQUEST_TIMEOUT_MS);
    await first;
    expect(stalled.end).toHaveBeenCalledWith({ timeout: 0 });
    expect(task).not.toHaveBeenCalled();
    await expect(withReadRequest("state", task)).resolves.toBe("fresh");
  });

  it("does not reuse or leak a timed-out request's context into a late continuation", async () => {
    vi.useFakeTimers();
    const reads = client();
    mocks.postgres.mockReturnValue(reads);
    const { getDb } = await import("./db");
    const { withReadRequest } = await import("./read-request");
    let resume!: () => void;
    let lateError: unknown;
    const result = expect(withReadRequest("state", async (stage) => stage("usage", async () => {
      await new Promise<void>((resolve) => { resume = resolve; });
      try { getDb(); } catch (error) { lateError = error; }
    }))).rejects.toMatchObject({ code: "READ_REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(lateError).toBeInstanceOf(Error);
    expect(console.warn).toHaveBeenCalledWith("read_request_failed", expect.objectContaining({ pending: ["usage"] }));
  });

  it("bounds concurrent connections without queuing more DB work", async () => {
    const clients = Array.from({ length: 4 }, client);
    clients.forEach((db) => {
      db.begin.mockImplementation(() => new Promise(() => undefined));
      mocks.postgres.mockReturnValueOnce(db);
    });
    const { withReadRequest } = await import("./read-request");
    const controller = new AbortController();
    const waiting = Array.from({ length: 4 }, () => withReadRequest("state", async () => null, controller.signal).catch((error) => error));
    await expect(withReadRequest("state", async () => null)).rejects.toMatchObject({ code: "READ_REQUEST_BUSY" });
    expect(mocks.postgres).toHaveBeenCalledTimes(4);
    controller.abort();
    await Promise.all(waiting);
    clients.forEach((db) => expect(db.end).toHaveBeenCalledOnce());
    mocks.postgres.mockReturnValueOnce(client());
    await expect(withReadRequest("state", async () => "recovered")).resolves.toBe("recovered");
  });

  it("keeps concurrent users' database scopes isolated", async () => {
    const a = client();
    const b = client();
    mocks.postgres.mockReturnValueOnce(a).mockReturnValueOnce(b);
    const { withReadRequest } = await import("./read-request");
    const { getDb } = await import("./db");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = withReadRequest("a", async () => {
      await gate;
      expect(getDb()).toBe(a.tx);
    });
    await withReadRequest("b", async () => {
      expect(getDb()).toBe(b.tx);
      release();
    });
    await first;
  });

  it("closes only the canceled request and preserves authentication failures", async () => {
    const db = client();
    mocks.postgres.mockReturnValue(db);
    const { withReadRequest } = await import("./read-request");
    const { HttpError } = await import("./http");
    await expect(withReadRequest("templates", async () => {
      throw new HttpError(401, "로그인이 필요합니다.");
    })).rejects.toMatchObject({ status: 401 });
    expect(db.end).toHaveBeenCalledOnce();
  });

  it("converts a SQL timeout into a retryable response without retrying the operation", async () => {
    const db = client();
    mocks.postgres.mockReturnValue(db);
    const { withReadRequest } = await import("./read-request");
    const task = vi.fn().mockRejectedValue(Object.assign(new Error("private query"), { code: "57014" }));
    await expect(withReadRequest("state", task)).rejects.toMatchObject({ status: 503, code: "READ_REQUEST_UNAVAILABLE" });
    expect(task).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private query");
  });
});
