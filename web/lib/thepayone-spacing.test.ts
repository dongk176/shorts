import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThePayOneSpacingError, withThePayOneSpacing } from "./thepayone-spacing";

const state = vi.hoisted(() => ({
  query: vi.fn(), end: vi.fn(), commitError: false, connectError: false,
}));
vi.mock("postgres", () => ({
  default: () => ({
    begin: async (run: (tx: typeof state.query) => Promise<unknown>) => {
      if (state.connectError) throw new Error("connection failed");
      const result = await run(state.query);
      if (state.commitError) throw new Error("commit failed");
      return result;
    },
    end: state.end,
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("DATABASE_URL", "postgres://fixture@127.0.0.1/fixture");
  state.commitError = false;
  state.connectError = false;
  state.end.mockReset().mockResolvedValue(undefined);
  state.query.mockReset().mockImplementation(async (strings: TemplateStringsArray, seconds?: number) => {
    if (strings.join("").includes("pg_sleep")) {
      await new Promise((resolve) => setTimeout(resolve, seconds! * 1000));
    }
    return [];
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("ThePayOne distributed request spacing", () => {
  it("dispatches only after acquiring the lock and waiting three seconds", async () => {
    const operation = vi.fn().mockResolvedValue("confirmed");
    const request = withThePayOneSpacing(operation);
    await vi.advanceTimersByTimeAsync(2999);
    expect(operation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await request).toBe("confirmed");
    const queries = state.query.mock.calls.map(([strings]) => strings.join(""));
    expect(queries.findIndex((q) => q.includes("pg_advisory_xact_lock")))
      .toBeLessThan(queries.findIndex((q) => q.includes("pg_sleep")));
    expect(state.end).toHaveBeenCalledOnce();
  });

  it("does not dispatch when the DB is missing or unreachable", async () => {
    const operation = vi.fn();
    vi.stubEnv("DATABASE_URL", "");
    await expect(withThePayOneSpacing(operation)).rejects.toMatchObject({ dispatched: false });
    vi.stubEnv("DATABASE_URL", "postgres://fixture@127.0.0.1/fixture");
    state.connectError = true;
    await expect(withThePayOneSpacing(operation)).rejects.toMatchObject({ dispatched: false });
    expect(operation).not.toHaveBeenCalled();
  });

  it("never dispatches a queued callback after admission timed out", async () => {
    let unlock!: () => void;
    state.query.mockImplementation(async (strings: TemplateStringsArray) => {
      if (strings.join("").includes("pg_advisory_xact_lock")) {
        await new Promise<void>((resolve) => { unlock = resolve; });
      }
      return [];
    });
    const operation = vi.fn();
    const result = withThePayOneSpacing(operation).catch((e) => e);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await result).toBeInstanceOf(ThePayOneSpacingError);
    unlock();
    await vi.runAllTimersAsync();
    expect(operation).not.toHaveBeenCalled();
    expect(state.end).toHaveBeenCalledOnce();
  });

  it("preserves a confirmed payment when lock transaction commit fails", async () => {
    state.commitError = true;
    const request = withThePayOneSpacing(async () => "approved");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await request).toBe("approved");
  });

  it("preserves an uncertain provider failure without automatically retrying", async () => {
    const providerError = new Error("provider outcome unknown");
    const operation = vi.fn().mockRejectedValue(providerError);
    const request = withThePayOneSpacing(operation).catch((e) => e);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await request).toBe(providerError);
    expect(operation).toHaveBeenCalledOnce();
    expect(state.end).toHaveBeenCalledOnce();
  });
});
