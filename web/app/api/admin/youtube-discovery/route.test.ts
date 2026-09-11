import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), update: vi.fn(), db: {} }));
vi.mock("@/lib/admin", () => ({ requireAdminUser: mocks.admin }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/youtube-japan-settings", () => ({ getJapanSettings: vi.fn(), updateJapanSettings: mocks.update }));
import { HttpError } from "@/lib/http";
import { POST } from "./route";
const request = (body: unknown, origin = "https://www.easycut.co.kr") => new Request("https://www.easycut.co.kr/api/admin/youtube-discovery", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ id: "admin-id" }); mocks.update.mockResolvedValue(undefined); });
describe("Japanese discovery administrator settings", () => {
  it("requires administrator authentication", async () => {
    mocks.admin.mockRejectedValue(new HttpError(403, "Forbidden"));
    expect((await POST(request({ collection: false, reads: false }))).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects foreign-origin mutations before a DB write", async () => {
    expect((await POST(request({ collection: true, reads: true }, "https://example.com"))).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects malformed settings and unrecognized fields", async () => {
    expect((await POST(request({ collection: "false", reads: false }))).status).toBe(400);
    expect((await POST(request({ collection: false, reads: false, project: "other" }))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("writes only the authenticated actor and the two validated flags", async () => {
    const response = await POST(request({ collection: false, reads: false }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(mocks.db, "admin-id", { collection: false, reads: false });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
