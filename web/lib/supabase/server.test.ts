import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  getConfig: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/supabase/config", () => ({
  getSupabaseAuthConfig: mocks.getConfig,
}));

import { getAuthenticatedUser } from "./server";

describe("getAuthenticatedUser", () => {
  const cookieStore = {
    getAll: vi.fn(() => [{ name: "sb-test-auth-token", value: "session" }]),
    set: vi.fn(),
  };

  beforeEach(() => {
    mocks.cookies.mockReset();
    mocks.createServerClient.mockReset();
    mocks.getConfig.mockReset();
    mocks.getUser.mockReset();
    cookieStore.getAll.mockClear();
    cookieStore.set.mockClear();
    mocks.cookies.mockResolvedValue(cookieStore);
  });

  it("enters request-cookie context even when auth config is only available at runtime", async () => {
    mocks.getConfig.mockReturnValue(null);

    await expect(getAuthenticatedUser()).resolves.toBeNull();

    expect(mocks.cookies).toHaveBeenCalledOnce();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("reads the authenticated user from the same request cookie store", async () => {
    const user = { id: "auth-user" };
    mocks.getConfig.mockReturnValue({ url: "https://project.supabase.co", key: "publishable" });
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      expect(options.cookies.getAll()).toEqual([{ name: "sb-test-auth-token", value: "session" }]);
      return { auth: { getUser: mocks.getUser } };
    });

    await expect(getAuthenticatedUser()).resolves.toBe(user);

    expect(mocks.cookies).toHaveBeenCalledOnce();
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "publishable",
      expect.any(Object),
    );
  });

  it("treats an invalid or expired Supabase session as signed out", async () => {
    mocks.getConfig.mockReturnValue({ url: "https://project.supabase.co", key: "publishable" });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });

    await expect(getAuthenticatedUser()).resolves.toBeNull();
  });

  it("ignores read-only cookie writes requested while rendering a Server Component", async () => {
    mocks.getConfig.mockReturnValue({ url: "https://project.supabase.co", key: "publishable" });
    cookieStore.set.mockImplementation(() => {
      throw {
        message: "Cookies can only be modified in a Server Action or Route Handler.",
      };
    });
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll([{
            name: "sb-project-auth-token",
            value: "",
            options: { maxAge: 0 },
          }]);
          return { data: { user: null }, error: new Error("expired") };
        },
      },
    }));

    await expect(getAuthenticatedUser()).resolves.toBeNull();
  });

  it("treats an auth transport failure as signed out", async () => {
    mocks.getConfig.mockReturnValue({ url: "https://project.supabase.co", key: "publishable" });
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: vi.fn().mockRejectedValue(new Error("network unavailable")) },
    });

    await expect(getAuthenticatedUser()).resolves.toBeNull();
  });
});
