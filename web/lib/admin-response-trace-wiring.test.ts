import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), admin: vi.fn(), db: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/supabase/middleware", () => ({ refreshSupabaseSession: mocks.refresh }));
vi.mock("@/lib/admin", () => ({ requireAdminUser: mocks.admin }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/custom-template-design", () => ({ assertCustomTemplateDesignRenderRelease: vi.fn() }));
vi.mock("@/lib/job-dispatch", () => ({ allProjectDispatchTargets: vi.fn() }));
import { middleware } from "../middleware";
import { addEditorReleaseTester } from "../app/admin/easycutcutcutcutcutcut/editor-release-actions";

const adminPath = "/admin/easycutcutcutcutcutcut";
const fakeEmail = "private@example.invalid";
const fakeId = "private-user-id";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function events() {
  return vi.mocked(console.info).mock.calls.map(([, metadata]) => metadata);
}

describe("temporary trace wiring preserves the real handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.admin.mockResolvedValue({ id: "private-admin-id" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("logs no non-admin requests and returns the identical authenticated admin response", async () => {
    const response = NextResponse.next();
    response.cookies.set("test-session", "private-cookie");
    mocks.refresh.mockResolvedValue(response);
    expect(await middleware(new NextRequest("https://example.invalid/pricing"))).toBe(response);
    expect(console.info).not.toHaveBeenCalled();

    const request = new NextRequest(`https://example.invalid${adminPath}?q=private-query`, {
      headers: { authorization: "Bearer private-token", cookie: "test-session=private-cookie" },
    });
    expect(await middleware(request)).toBe(response);
    expect(mocks.refresh).toHaveBeenLastCalledWith(request);
    expect(events().map(({ phase, status }) => [phase, status])).toEqual([
      ["entry", "start"], ["auth", "start"], ["auth", "done"], ["return", "done"],
    ]);
    expect(JSON.stringify(events())).not.toMatch(/private|authorization|cookie|Bearer|headers/);
    expect(response.cookies.get("test-session")?.value).toBe("private-cookie");
  });

  it("keeps the admin prefetch short circuit without authentication or new headers", async () => {
    const response = await middleware(new NextRequest(`https://example.invalid${adminPath}`, {
      headers: { "next-router-prefetch": "1" },
    }));
    expect(response.status).toBe(204);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(events().map(({ phase }) => phase)).toEqual(["entry", "return"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect([...response.headers.keys()]).not.toContain("x-trace-id");
  });

  it("rethrows an authentication error without retrying or logging its private data", async () => {
    const original = new Error("private-auth-message");
    mocks.refresh.mockRejectedValue(original);
    await expect(middleware(new NextRequest(`https://example.invalid${adminPath}`))).rejects.toBe(original);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(events().at(-1)).toMatchObject({ phase: "auth", status: "error" });
    expect(JSON.stringify(events())).not.toContain("private-auth-message");
  });

  it("marks transaction-finished only after outer commit acknowledgement without replay", async () => {
    vi.useFakeTimers();
    const commit = deferred<void>();
    const callbackDone = deferred<void>();
    const tx = Object.assign(vi.fn()
      .mockResolvedValueOnce([{ id: fakeId, email: fakeEmail }])
      .mockResolvedValue([]), { json: (value: unknown) => value });
    const begin = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => {
      const result = await work(tx);
      callbackDone.resolve();
      await commit.promise;
      return result;
    });
    mocks.db.mockReturnValue({ begin });

    const pending = addEditorReleaseTester(fakeEmail);
    await callbackDone.promise;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(tx).toHaveBeenCalledTimes(3); // Existing lookup, enrollment, audit only.
    expect(begin).toHaveBeenCalledOnce();
    expect(events().some(({ phase }) => phase === "transaction-finished")).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(events().at(-1)).toMatchObject({ phase: "transaction", status: "waiting" });

    commit.resolve();
    expect(await pending).toEqual({ id: fakeId, email: fakeEmail });
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith(`${adminPath}?tab=editor-releases`);
    expect(events().slice(-5).map(({ phase, status }) => [phase, status])).toEqual([
      ["transaction", "done"], ["transaction-finished", "done"],
      ["revalidate", "start"], ["revalidate", "done"], ["return", "done"],
    ]);
    expect(tx).toHaveBeenCalledTimes(3);
    expect(begin).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(events())).not.toMatch(/private|@|select|insert|shorts_mvp/);
  });

  it("preserves the administrator guard and performs no transaction when it rejects", async () => {
    const original = new Error("private-unauthorized");
    mocks.admin.mockRejectedValue(original);
    await expect(addEditorReleaseTester(fakeEmail)).rejects.toBe(original);
    expect(mocks.admin).toHaveBeenCalledOnce();
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(JSON.stringify(events())).not.toContain("private");
  });

  it("does not retry a committed action if revalidate throws", async () => {
    const tx = Object.assign(vi.fn()
      .mockResolvedValueOnce([{ id: fakeId, email: fakeEmail }])
      .mockResolvedValue([]), { json: (value: unknown) => value });
    const begin = vi.fn((work: (transaction: typeof tx) => Promise<unknown>) => work(tx));
    mocks.db.mockReturnValue({ begin });
    const original = new Error("private-revalidation-error");
    mocks.revalidate.mockImplementation(() => { throw original; });
    await expect(addEditorReleaseTester(fakeEmail)).rejects.toBe(original);
    expect(begin).toHaveBeenCalledOnce();
    expect(tx).toHaveBeenCalledTimes(3);
    expect(mocks.revalidate).toHaveBeenCalledOnce();
    expect(events().at(-1)).toMatchObject({ phase: "revalidate", status: "error" });
    expect(events().some(({ phase }) => phase === "return")).toBe(false);
    expect(JSON.stringify(events())).not.toContain("private-revalidation-error");
  });
});
