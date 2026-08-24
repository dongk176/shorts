import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

function sqlText(strings: TemplateStringsArray) {
  return Array.from(strings).join("?").replace(/\s+/g, " ").trim();
}

describe("creator project share tokens", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates an unguessable token and stores only its SHA-256 hash", async () => {
    const {
      createCreatorProjectShareToken,
      creatorProjectShareTokenHash,
      isCreatorProjectShareToken,
    } = await import("./creator-project-shares");
    const token = createCreatorProjectShareToken();
    const hash = creatorProjectShareTokenHash(token);

    expect(token).toHaveLength(43);
    expect(isCreatorProjectShareToken(token)).toBe(true);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(isCreatorProjectShareToken("short-token")).toBe(false);
  });

  it("deduplicates repeated visit request IDs per anonymous session", async () => {
    const statements: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const statement = sqlText(strings);
      statements.push(statement);
      return Promise.resolve(statement.includes("select share.id,share.job_id")
        ? [{ id: "share-1", jobId: "job-1" }]
        : []);
    });
    const { recordCreatorProjectShareVisit } = await import("./creator-project-shares");
    await expect(recordCreatorProjectShareVisit({
      db: db as never,
      token: "A".repeat(43),
      sessionId: "session-1",
      requestId: "11111111-1111-4111-8111-111111111111",
    })).resolves.toBe(true);

    const upsert = statements.find((statement) => statement.includes("insert into shorts_mvp.creator_project_share_visitors"));
    expect(upsert).toContain("on conflict (share_id,mvp_session_id) do update");
    expect(upsert).toContain("last_view_request_id <> excluded.last_view_request_id");
  });

  it("records CTA clicks idempotently and can create the missing visitor row", async () => {
    const statements: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const statement = sqlText(strings);
      statements.push(statement);
      return Promise.resolve(statement.includes("select share.id,share.job_id")
        ? [{ id: "share-1", jobId: "job-1" }]
        : []);
    });
    const { recordCreatorProjectShareCta } = await import("./creator-project-shares");
    await expect(recordCreatorProjectShareCta({
      db: db as never,
      token: "B".repeat(43),
      sessionId: "session-1",
      viewRequestId: "11111111-1111-4111-8111-111111111111",
      ctaRequestId: "22222222-2222-4222-8222-222222222222",
    })).resolves.toBe(true);

    const upsert = statements.find((statement) => statement.includes("first_cta_clicked_at"));
    expect(upsert).toContain("last_cta_request_id is distinct from excluded.last_cta_request_id");
    expect(upsert).toContain("cta_click_count+1");
  });

  it("maps zero-valued admin metrics and a revoked status safely", async () => {
    const db = vi.fn().mockResolvedValue([{
      id: "share-1",
      projectNumber: 123,
      videoTitle: "테스트 영상",
      recipientName: "크리에이터",
      issuedAt: new Date("2026-08-14T00:00:00.000Z"),
      expiresAt: new Date("2026-08-21T00:00:00.000Z"),
      revokedAt: new Date("2026-08-15T00:00:00.000Z"),
      jobStatus: "completed",
      isExample: false,
      totalViews: 0,
      uniqueVisitors: 0,
      totalCtaClicks: 0,
      uniqueCtaVisitors: 0,
      signupConversions: 0,
    }]);
    mocks.getDb.mockReturnValue(db);
    const { loadAdminCreatorProjectShares } = await import("./creator-project-shares");

    await expect(loadAdminCreatorProjectShares("admin-1")).resolves.toEqual([
      expect.objectContaining({
        status: "revoked",
        totalViews: 0,
        uniqueVisitors: 0,
        signupConversions: 0,
      }),
    ]);
  });

  it("returns expired and revoked links without exposing playable shorts", async () => {
    const expiredDb = vi.fn().mockResolvedValueOnce([{
      id: "share-expired",
      recipientName: "만료 크리에이터",
      issuedAt: new Date("2026-08-01T00:00:00.000Z"),
      expiresAt: new Date("2026-08-08T00:00:00.000Z"),
      revokedAt: null,
      jobId: "job-1",
      projectNumber: 123,
      videoTitle: "영상",
      channelName: "채널",
      channelThumbnailUrl: null,
      thumbnailUrl: "https://example.com/thumb.jpg",
      jobStatus: "completed",
      isExample: false,
    }]);
    mocks.getDb.mockReturnValue(expiredDb);
    const { loadCreatorProjectShare } = await import("./creator-project-shares");
    await expect(loadCreatorProjectShare("C".repeat(43))).resolves.toMatchObject({
      status: "expired",
      shorts: [],
    });
    expect(expiredDb).toHaveBeenCalledOnce();

    const revokedDb = vi.fn().mockResolvedValueOnce([{
      id: "share-revoked",
      recipientName: "취소 크리에이터",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: new Date(),
      jobId: "job-2",
      projectNumber: 124,
      videoTitle: "영상 2",
      channelName: "채널",
      channelThumbnailUrl: null,
      thumbnailUrl: "https://example.com/thumb.jpg",
      jobStatus: "completed",
      isExample: false,
    }]);
    mocks.getDb.mockReturnValue(revokedDb);
    await expect(loadCreatorProjectShare("D".repeat(43))).resolves.toMatchObject({
      status: "revoked",
      shorts: [],
    });
    expect(revokedDb).toHaveBeenCalledOnce();
  });

  it("rejects malformed tokens without querying the database", async () => {
    const db = vi.fn();
    mocks.getDb.mockReturnValue(db);
    const { loadCreatorProjectShare, findCreatorShareMedia } = await import("./creator-project-shares");

    await expect(loadCreatorProjectShare("not-a-token")).resolves.toBeNull();
    await expect(findCreatorShareMedia("not-a-token", "short-1")).resolves.toBeNull();
    expect(db).not.toHaveBeenCalled();
  });
});
