import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { requireAdminUser } from "./admin";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("administrator authorization", () => {
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
