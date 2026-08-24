import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SUPABASE_AUTH_TIMEOUT_MS,
  SupabaseAuthTimeoutError,
  withSupabaseAuthTimeout,
} from "./auth-fetch";

afterEach(() => {
  vi.useRealTimers();
});

describe("Supabase authentication timeout", () => {
  it("returns an authentication operation that completes in time", async () => {
    await expect(withSupabaseAuthTimeout(Promise.resolve("ok")))
      .resolves.toBe("ok");
  });

  it("rejects an authentication operation that never settles", async () => {
    vi.useFakeTimers();
    const result = withSupabaseAuthTimeout(new Promise(() => undefined));
    const assertion = expect(result).rejects.toBeInstanceOf(
      SupabaseAuthTimeoutError,
    );

    await vi.advanceTimersByTimeAsync(SUPABASE_AUTH_TIMEOUT_MS);
    await assertion;
  });
});
