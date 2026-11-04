import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const process = vi.hoisted(() => vi.fn().mockResolvedValue({ status: "idle" }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/shorts-silence-processing", () => ({ processAdminShortSilence: process }));
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); process.mockReset().mockResolvedValue({ status: "idle" }); vi.restoreAllMocks(); });
describe("silence background authentication", () => {
  it.each([undefined,"Bearer wrong","Bearer ééé"])("rejects invalid scheduler authorization %s", async authorization => {
    vi.stubEnv("CRON_SECRET", "abc");
    const response = await GET(new Request("https://www.easycut.co.kr/api/cron/admin-shorts-silence", { headers: authorization ? { authorization } : {} }));
    expect(response.status).toBe(401); expect(process).not.toHaveBeenCalled();
  });
  it("accepts the existing scheduler secret", async () => {
    vi.stubEnv("CRON_SECRET", "abc");
    expect((await GET(new Request("https://www.easycut.co.kr/api/cron/admin-shorts-silence", { headers: { authorization: "Bearer abc" } }))).status).toBe(200);
    expect(process).toHaveBeenCalledTimes(1);
  });
});

describe("bounded sequential silence draining", () => {
  const request = () => new Request("https://www.easycut.co.kr/api/cron/admin-shorts-silence", { headers: { authorization: "Bearer abc" } });
  it("drains up to four tasks without concurrent analyses", async () => {
    vi.stubEnv("CRON_SECRET", "abc");
    let active = false;
    process.mockImplementation(async () => {
      expect(active).toBe(false); active = true; await Promise.resolve(); active = false;
      return { status: "rendering" };
    });
    expect((await GET(request())).status).toBe(200);
    expect(process).toHaveBeenCalledTimes(4);
  });
  it("starts no further analysis after forty seconds", async () => {
    vi.stubEnv("CRON_SECRET", "abc");
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(40_000);
    process.mockResolvedValue({ status: "completed" });
    expect((await GET(request())).status).toBe(200);
    expect(process).toHaveBeenCalledTimes(1);
  });
  it("stops immediately when the feature is disabled", async () => {
    vi.stubEnv("CRON_SECRET", "abc"); process.mockResolvedValue({ status: "disabled" });
    expect((await GET(request())).status).toBe(200); expect(process).toHaveBeenCalledTimes(1);
  });
});
