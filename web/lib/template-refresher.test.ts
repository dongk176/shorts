import { describe, expect, it, vi } from "vitest";
import { createTemplateRefresher } from "./template-refresher";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("account-scoped template refresh", () => {
  it("shares focus, pageshow and source selection reads and expires after 30 seconds", async () => {
    let clock = 0;
    const first = deferred<string[]>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(["new"]);
    const apply = vi.fn();
    const cache = createTemplateRefresher({ load, apply, now: () => clock });
    const pending = cache.refresh();
    expect(cache.refresh()).toBe(pending);
    expect(cache.refresh()).toBe(pending);
    first.resolve(["initial"]);
    await pending;
    clock = 29_999;
    await cache.refresh();
    expect(load).toHaveBeenCalledOnce();
    clock = 30_000;
    await cache.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(["new"]);
  });

  it("refetches after a save during a pending read without applying the stale result", async () => {
    const first = deferred<string[]>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(["saved"]);
    const apply = vi.fn();
    const cache = createTemplateRefresher({ load, apply });
    const pending = cache.refresh();
    expect(cache.refresh(true)).toBe(pending);
    cache.refresh(true);
    first.resolve(["old"]);
    await pending;
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledExactlyOnceWith(["saved"]);
    await cache.refresh(true);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not throttle failures, and retries a failed read invalidated by a save", async () => {
    const first = deferred<string[]>();
    const load = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(first.promise).mockResolvedValue(["saved"]);
    const apply = vi.fn();
    const cache = createTemplateRefresher({ load, apply });
    await expect(cache.refresh()).rejects.toThrow("offline");
    const pending = cache.refresh();
    cache.refresh(true);
    first.reject(new Error("old read failed"));
    await pending;
    expect(apply).toHaveBeenCalledExactlyOnceWith(["saved"]);
  });

  it("aborts disposed account reads and rejects late results even if transport ignores abort", async () => {
    const first = deferred<string[]>();
    const load = vi.fn().mockReturnValue(first.promise);
    const apply = vi.fn();
    const oldAccount = createTemplateRefresher({ load, apply });
    const pending = oldAccount.refresh();
    oldAccount.dispose();
    expect(load.mock.calls[0][0].aborted).toBe(true);
    first.resolve(["private old account template"]);
    await pending;
    await oldAccount.refresh(true);
    expect(apply).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledOnce();
  });
});
