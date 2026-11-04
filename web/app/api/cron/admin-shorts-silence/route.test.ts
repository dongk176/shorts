import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const process = vi.hoisted(() => vi.fn().mockResolvedValue({ status: "idle" }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/shorts-silence-processing", () => ({ processAdminShortSilence: process }));
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); process.mockClear(); });
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
