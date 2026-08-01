import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { HttpError } from "./http";
import { isAdminAuthenticationRequired, requireAdminUser } from "./admin";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("administrator authorization", () => {
  it("recognizes authentication failures across development module reloads", () => {
    expect(isAdminAuthenticationRequired(new HttpError(401, "로그인이 필요합니다."))).toBe(true);
    expect(isAdminAuthenticationRequired({ status: 401 })).toBe(true);
    expect(isAdminAuthenticationRequired(new HttpError(403, "관리자 권한이 필요합니다."))).toBe(false);
  });

  it("requires an authenticated Supabase user", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    await expect(requireAdminUser()).rejects.toMatchObject({ status: 401 });
  });

  it("does not grant access from the authentication email alone", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      id: "auth-user-1",
      email: "dmsthaalcls@gmail.com",
    });
    mocks.getDb.mockReturnValue(vi.fn().mockResolvedValue([]));
    await expect(requireAdminUser()).rejects.toMatchObject({ status: 403 });
  });

  it("returns a user only when the database administrator flag is present", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({
      id: "auth-user-1",
      email: "dmsthaalcls@gmail.com",
    });
    mocks.getDb.mockReturnValue(vi.fn().mockResolvedValue([{
      id: "app-user-1",
      authUserId: "auth-user-1",
      email: "dmsthaalcls@gmail.com",
      displayName: "관리자",
    }]));
    await expect(requireAdminUser()).resolves.toEqual({
      id: "app-user-1",
      authUserId: "auth-user-1",
      email: "dmsthaalcls@gmail.com",
      displayName: "관리자",
    });
  });
});
