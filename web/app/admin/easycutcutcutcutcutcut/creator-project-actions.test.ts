import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  getDb: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

function text(strings: TemplateStringsArray) {
  return Array.from(strings).join("?").replace(/\s+/g, " ").trim();
}

describe("creator project admin actions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.requireAdminUser.mockResolvedValue({ id: "admin-1" });
  });

  it("issues a seven-day link only after validating the owned completed project", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const tx = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = text(strings);
      statements.push({ sql, values });
      if (sql.includes("from shorts_mvp.video_jobs job")) {
        return Promise.resolve([{
          id: "job-1",
          projectNumber: 123,
          videoTitle: "영상",
          status: "completed",
          isExample: false,
          readyCount: 1,
          rerenderingCount: 0,
          mediaExpiresAt: new Date(Date.now() + 20 * 86_400_000),
        }]);
      }
      if (sql.includes("select id from shorts_mvp.creator_project_shares")) {
        return Promise.resolve([]);
      }
      if (sql.includes("insert into shorts_mvp.creator_project_shares")) {
        return Promise.resolve([{ id: "share-1" }]);
      }
      return Promise.resolve([]);
    });
    Object.assign(tx, { json: (value: unknown) => value });
    mocks.getDb.mockReturnValue({
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });

    const { issueCreatorProjectShare } = await import("./creator-project-actions");
    const result = await issueCreatorProjectShare({
      projectNumber: 123,
      recipientName: "테스트 크리에이터",
      rightsConfirmed: true,
    });

    expect(result.path).toMatch(/^\/creator-project\/[A-Za-z0-9_-]{43}$/);
    const insert = statements.find((entry) => entry.sql.includes("insert into shorts_mvp.creator_project_shares"));
    const tokenHash = insert?.values.find((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
    expect(tokenHash).toBeTruthy();
    expect(statements.some((entry) => entry.sql.includes("admin_audit_logs"))).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("rejects a project whose media cannot remain available for seven days", async () => {
    const tx = vi.fn((strings: TemplateStringsArray) => {
      const sql = text(strings);
      return Promise.resolve(sql.includes("from shorts_mvp.video_jobs job") ? [{
        id: "job-1",
        status: "completed",
        isExample: false,
        readyCount: 1,
        rerenderingCount: 0,
        mediaExpiresAt: new Date(Date.now() + 2 * 86_400_000),
      }] : []);
    });
    mocks.getDb.mockReturnValue({
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    const { issueCreatorProjectShare } = await import("./creator-project-actions");

    await expect(issueCreatorProjectShare({
      projectNumber: 123,
      recipientName: "테스트 크리에이터",
      rightsConfirmed: true,
    })).rejects.toThrow("영상 보관 기간이 7일보다 적게 남았습니다");
    expect(tx.mock.calls.some(([strings]) => text(strings).includes("admin_audit_logs"))).toBe(false);
  });

  it("reissues by atomically replacing the token hash and records a token-free audit", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const tx = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = text(strings);
      statements.push({ sql, values });
      if (sql.includes("from shorts_mvp.video_jobs job")) {
        return Promise.resolve([{
          id: "job-1",
          projectNumber: 123,
          videoTitle: "영상",
          status: "completed",
          isExample: false,
          readyCount: 1,
          rerenderingCount: 0,
          mediaExpiresAt: new Date(Date.now() + 20 * 86_400_000),
        }]);
      }
      if (sql.includes("select id from shorts_mvp.creator_project_shares")) {
        return Promise.resolve([{ id: "share-1" }]);
      }
      if (sql.includes("insert into shorts_mvp.creator_project_shares")) {
        return Promise.resolve([{ id: "share-1" }]);
      }
      return Promise.resolve([]);
    });
    Object.assign(tx, { json: (value: unknown) => value });
    mocks.getDb.mockReturnValue({
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });

    const { issueCreatorProjectShare } = await import("./creator-project-actions");
    const result = await issueCreatorProjectShare({
      projectNumber: 123,
      recipientName: "재발급 크리에이터",
      rightsConfirmed: true,
    });

    const upsert = statements.find((entry) => entry.sql.includes("on conflict (job_id) do update"));
    const audit = statements.find((entry) => entry.sql.includes("admin_audit_logs"));
    expect(upsert?.sql).toContain("token_hash=excluded.token_hash");
    expect(audit?.values).toContain("creator_project_share.reissued");
    expect(JSON.stringify(audit?.values)).not.toContain(result.path.slice("/creator-project/".length));
  });

  it("immediately revokes an owned share and writes the revocation audit", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const tx = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = text(strings);
      statements.push({ sql, values });
      return Promise.resolve(sql.includes("update shorts_mvp.creator_project_shares share")
        ? [{ id: "share-1", projectNumber: 123 }]
        : []);
    });
    Object.assign(tx, { json: (value: unknown) => value });
    mocks.getDb.mockReturnValue({
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });

    const { revokeCreatorProjectShare } = await import("./creator-project-actions");
    await expect(revokeCreatorProjectShare("11111111-1111-4111-8111-111111111111"))
      .resolves.toEqual({ revoked: true });

    expect(statements[0].sql).toContain("share.created_by_user_id=?");
    expect(statements[0].sql).toContain("set revoked_at=clock_timestamp()");
    expect(statements.some((entry) => (
      entry.sql.includes("admin_audit_logs")
      && entry.sql.includes("creator_project_share.revoked")
    ))).toBe(true);
  });

  it("rejects a missing or unowned project before issuing a link", async () => {
    const tx = vi.fn().mockResolvedValue([]);
    mocks.getDb.mockReturnValue({
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    const { issueCreatorProjectShare } = await import("./creator-project-actions");

    await expect(issueCreatorProjectShare({
      projectNumber: 999,
      recipientName: "테스트 크리에이터",
      rightsConfirmed: true,
    })).rejects.toThrow("내가 만든 프로젝트를 찾을 수 없습니다");
    expect(tx).toHaveBeenCalledOnce();
  });
});
