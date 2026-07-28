import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/supabase/server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

import { GET } from "./route";

function dbWithRows(...responses: unknown[][]) {
  const sql = vi.fn();
  for (const response of responses) sql.mockResolvedValueOnce(response);
  Object.assign(sql, {
    begin: vi.fn(async (callback: (tx: ReturnType<typeof vi.fn>) => unknown) => {
      const tx = vi.fn().mockResolvedValue([]);
      return callback(tx);
    }),
  });
  return sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  mocks.getAuthenticatedUser.mockResolvedValue(null);
});

describe("referral landing route", () => {
  it("creates a fixed one-year first-click cookie and redirects home", async () => {
    const db = dbWithRows(
      [{ id: "partner-1" }],
      [{ id: "visitor-1" }],
      [],
    );
    mocks.getDb.mockReturnValue(db);
    const response = await GET(
      new NextRequest("https://www.easycut.co.kr/creator-one?campaign=youtube"),
      { params: Promise.resolve({ referralSlug: "creator-one" }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://www.easycut.co.kr/");
    const cookie = response.headers.get("set-cookie") || "";
    expect(cookie).toContain("easycut_referral=");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(db).toHaveBeenCalledTimes(3);
  });

  it("does not replace an existing valid first-click cookie", async () => {
    const db = dbWithRows(
      [{ id: "partner-2" }],
      [{ id: "visitor-first" }],
    );
    mocks.getDb.mockReturnValue(db);
    const response = await GET(
      new NextRequest("https://www.easycut.co.kr/creator-two", {
        headers: { cookie: "easycut_referral=existing-token" },
      }),
      { params: Promise.resolve({ referralSlug: "creator-two" }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((db as typeof db & { begin: ReturnType<typeof vi.fn> }).begin).toHaveBeenCalledOnce();
  });

  it("records but never attributes an already authenticated member", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "auth-user" });
    const db = dbWithRows([{ id: "partner-1" }], []);
    mocks.getDb.mockReturnValue(db);
    const response = await GET(
      new NextRequest("https://www.easycut.co.kr/creator-one"),
      { params: Promise.resolve({ referralSlug: "creator-one" }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(db).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for reserved or inactive referral paths", async () => {
    const reserved = await GET(
      new NextRequest("https://www.easycut.co.kr/admin"),
      { params: Promise.resolve({ referralSlug: "admin" }) },
    );
    expect(reserved.status).toBe(404);
    expect(mocks.getDb).not.toHaveBeenCalled();

    const db = dbWithRows([]);
    mocks.getDb.mockReturnValue(db);
    const inactive = await GET(
      new NextRequest("https://www.easycut.co.kr/inactive-creator"),
      { params: Promise.resolve({ referralSlug: "inactive-creator" }) },
    );
    expect(inactive.status).toBe(404);
  });
});
