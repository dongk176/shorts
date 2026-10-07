import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), getDb: vi.fn(), billing: vi.fn(), enterprise: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/billing", () => ({ getBillingSummary: mocks.billing }));
vi.mock("@/lib/enterprise-access", () => ({ assertEnterpriseSessionServiceAccess: mocks.enterprise }));
vi.mock("@/lib/project-download-archive", () => ({ projectDownloadArchive: mocks.archive }));
import { HttpError } from "@/lib/http";
import { GET, HEAD } from "./route";

const context = (projectNumber = "123") => ({ params: Promise.resolve({ projectNumber }) });
const request = () => new Request("http://localhost/api/projects/123/download");
const rows = ["first", "middle", "last"].map((id) => ({ outputS3Key: `outputs/${id}.mp4`, hookTitle: id, expiresAt: null }));

describe("project download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.session.mockResolvedValue({ id: "session-a", userId: "user-a" });
    mocks.getDb.mockReturnValue(mocks.db);
    mocks.db.mockResolvedValue(rows);
    mocks.billing.mockResolvedValue({ activeProducts: [{ planCode: "plus" }] });
    mocks.enterprise.mockResolvedValue(undefined);
    mocks.archive.mockImplementation(async () => new Response("zip-test").body);
  });
  afterEach(() => vi.restoreAllMocks());

  it("passes all eligible outputs to one archive, with ownership and retention filters", async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain("easycut-project-123.zip");
    expect(response.headers.get("X-Shorts-Count")).toBe("3");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).toBe("zip-test");
    expect(mocks.archive).toHaveBeenCalledWith(rows, expect.any(AbortSignal));
    const sql = mocks.db.mock.calls[0][0].join("?");
    for (const clause of ["j.project_number=", "j.user_deleted_at is null", "j.is_example=false", "s.user_id=", "s.mvp_session_id=", "s.status='ready'", "s.deleted_at is null", "s.expires_at > now()", "order by s.clip_index,s.id"]) {
      expect(sql).toContain(clause);
    }
    expect(mocks.db.mock.calls[0].slice(1)).toEqual([123, "user-a", "user-a", "user-a", "session-a"]);
  });

  it("checks permissions and availability on HEAD without reading video bytes", async () => {
    const response = await HEAD(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Shorts-Count")).toBe("3");
    expect(await response.text()).toBe("");
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it.each([GET, HEAD])("allows free members to download owned projects", async (handler) => {
    mocks.billing.mockResolvedValue({ activeProducts: [] });
    expect((await handler(request(), context())).status).toBe(200);
  });

  it.each([GET, HEAD])("rejects inaccessible projects for free members", async (handler) => {
    mocks.billing.mockResolvedValue({ activeProducts: [] });
    mocks.db.mockResolvedValue([]);
    expect((await handler(request(), context())).status).toBe(404);
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("rechecks authorization on GET even if HEAD succeeded", async () => {
    expect((await HEAD(request(), context())).status).toBe(200);
    mocks.session.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));
    expect((await GET(request(), context())).status).toBe(401);
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("honors enterprise access blocks", async () => {
    mocks.enterprise.mockRejectedValue(new HttpError(403, "서비스 이용 기간을 확인해 주세요."));
    expect((await GET(request(), context())).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("returns a private error when upstream preparation fails", async () => {
    mocks.archive.mockRejectedValue(new HttpError(503, "다시 시도해 주세요."));
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Disposition")).toBeNull();
  });

  it.each(["0", "-1", "1e2", "9007199254740992", "123oops"])("rejects invalid project number %s", async (number) => {
    expect((await GET(request(), context(number))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });
});
