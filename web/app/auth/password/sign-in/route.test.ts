import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  claimMvpSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({ claimMvpSession: mocks.claimMvpSession }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  })),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://www.easycut.co.kr/auth/password/sign-in", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.easycut.co.kr",
      "X-Forwarded-For": "203.0.113.7",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.claimMvpSession.mockResolvedValue({});
});

describe("administrator-issued password login", () => {
  it("returns the same generic error for invalid credentials", async () => {
    const db = vi.fn()
      .mockResolvedValueOnce([{ identifierFailures: 0, networkFailures: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(db);
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid credentials"),
    });

    const response = await POST(request({
      loginId: "missing-user",
      password: "wrong-password",
      next: "/projects",
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "MANAGED_LOGIN_FAILED",
      detail: "아이디 또는 비밀번호를 확인해 주세요.",
    });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "managed-missing@accounts.easycut.co.kr",
      password: "wrong-password",
    });
    expect(mocks.claimMvpSession).not.toHaveBeenCalled();
  });

  it("rate limits repeated failures before contacting Supabase Auth", async () => {
    mocks.getDb.mockReturnValue(vi.fn().mockResolvedValue([{
      identifierFailures: 5,
      networkFailures: 5,
    }]));

    const response = await POST(request({
      loginId: "creator01",
      password: "wrong-password",
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("claims the normal service session after a successful password login", async () => {
    const tx = vi.fn().mockResolvedValue([]);
    const db = vi.fn()
      .mockResolvedValueOnce([{ identifierFailures: 0, networkFailures: 0 }])
      .mockResolvedValueOnce([{
        id: "managed-account",
        authEmail: "managed-1@accounts.easycut.co.kr",
        isActive: true,
      }]);
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);
    const user = {
      id: "auth-user",
      app_metadata: { login_type: "managed", login_id: "creator01" },
    };
    mocks.signInWithPassword.mockResolvedValue({ data: { user }, error: null });

    const response = await POST(request({
      loginId: "Creator01",
      password: "correct-password",
      next: "/projects",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, next: "/projects" });
    expect(mocks.claimMvpSession).toHaveBeenCalledWith(user);
    expect(tx).toHaveBeenCalledTimes(2);
  });
});
