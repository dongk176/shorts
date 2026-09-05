import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ ensureReadDbReady: vi.fn().mockResolvedValue(undefined) }));

const mocks = vi.hoisted(() => ({ requireAdminUser: vi.fn(), loadAdminTrend: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock("@/lib/admin-overview", () => ({ loadAdminTrend: mocks.loadAdminTrend }));

import { HttpError } from "@/lib/http";
import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin" });
});

describe("administrator trend API", () => {
  it.each([401, 403])("checks authorization before reading cached data (%i)", async (status) => {
    mocks.requireAdminUser.mockRejectedValue(new HttpError(status, "관리자 로그인이 필요합니다."));
    const response = await GET(new Request("http://localhost/api/admin/trends?metric=sales&period=all"));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.loadAdminTrend).not.toHaveBeenCalled();
  });

  it.each(["metric=sales&period=14d", "metric=users&period=all", "metric=sales", "period=7d"])(
    "rejects unsupported parameters: %s", async (query) => {
      const response = await GET(new Request(`http://localhost/api/admin/trends?${query}`));
      expect(response.status).toBe(400);
      expect(mocks.loadAdminTrend).not.toHaveBeenCalled();
    },
  );

  it.each(["7d", "30d", "6m", "all"])("returns actual daily data for %s without HTTP caching", async (period) => {
    const data = { metric: "members", period, from: "2026-09-05", to: "2026-09-05", points: [{ date: "2026-09-05", value: 12 }] };
    mocks.loadAdminTrend.mockResolvedValue(data);
    const response = await GET(new Request(`http://localhost/api/admin/trends?metric=members&period=${period}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.loadAdminTrend).toHaveBeenCalledWith("members", period);
    await expect(response.json()).resolves.toEqual(data);
  });

  it("returns a retryable error when the data query times out", async () => {
    mocks.loadAdminTrend.mockRejectedValue(new HttpError(503, "잠시 후 다시 시도해 주세요."));
    const response = await GET(new Request("http://localhost/api/admin/trends?metric=sales&period=all"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
  });
});
