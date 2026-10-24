import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin", () => ({ requireAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
import { requireAdminUser } from "@/lib/admin";
import { HttpError } from "@/lib/http";
import { GET } from "./route";
const request = () => new Request("https://www.easycut.co.kr/api/ranking-shorts/examples");
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("RANKING_SHORTS_ENABLED", "1"); });
afterEach(() => vi.unstubAllEnvs());
it.each([401, 403])("does not disclose the example catalog to a denied user (%i)", async (status) => {
  vi.mocked(requireAdminUser).mockRejectedValue(new HttpError(status, "denied"));
  const response = await GET(request());
  expect(response.status).toBe(status);
  expect(await response.json()).not.toHaveProperty("items");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("keeps examples unavailable when the ranking feature is disabled", async () => {
  vi.stubEnv("RANKING_SHORTS_ENABLED", "0");
  expect((await GET(request())).status).toBe(404);
  expect(requireAdminUser).not.toHaveBeenCalled();
});
it("returns the imported, unique allowlisted catalog only after admin authorization", async () => {
  vi.mocked(requireAdminUser).mockResolvedValue({id:"admin",authUserId:"auth",email:"admin@example.test",displayName:null});
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const data = await response.json();
  expect(data.checkedAt).toBe("2026-10-24~2026-10-25");
  expect(data.items).toHaveLength(186);
  expect(new Set(data.items.map((item: {id:string})=>item.id)).size).toBe(186);
  expect(data.items.filter((item: {language:string}) => item.language === "한국어")).toHaveLength(100);
  for (const item of data.items) {
    expect(item.id).toMatch(/^[\w-]{11}$/);
    expect(item.url).toBe(`https://www.youtube.com/shorts/${item.id}`);
    expect(item.duration).toBeGreaterThan(0);
    expect(item.views).toBeGreaterThan(0);
  }
});
