import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  remaining: 60, queries: [] as string[], status: "consumed", owned: true,
  reservationError: "", generate: vi.fn<() => Promise<string[]>>(),
}));
vi.mock("@/lib/db", () => ({ getDb: () => Object.assign(async (parts: TemplateStringsArray) => {
  const query = parts.join("?");
  mock.queries.push(query);
  if (query.includes("from shorts_mvp.generated_shorts")) return mock.owned ? [{
    id: "f7d86fab-7ebc-4cda-b780-8b3d7d20d701", status: "ready", hookTitle: "Title",
    subtitleSegments: [], subtitleTemplateId: null, languageTestReleaseId: null,
    outputLanguage: "ko", highlightReason: "",
  }] : [];
  if (query.includes("reserve_ai_comment_regeneration_usage")) {
    if (mock.reservationError) throw new Error(mock.reservationError);
    return [{ reservationId: "saved" }];
  }
  if (query.includes("select status,generated_comments")) return [{
    status: mock.status, generatedComments: ["already generated"],
  }];
  if (query.includes("returning id")) return [{ id: "saved" }];
  return [];
}, { json: (value: unknown) => value }) }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: async () => ({ userId: "owner", id: "session" }) }));
vi.mock("@/lib/billing", () => ({ getBillingSummary: async () => ({}) }));
vi.mock("@/lib/enterprise-access", () => ({ assertEnterpriseSessionServiceAccess: async () => {} }));
vi.mock("@/lib/editor-overlay-preview-flag", () => ({ editorOverlayPreviewEnabled: () => true }));
vi.mock("@/lib/editor-rendering-release", () => ({ editorRenderingV2Enabled: async () => true }));
vi.mock("@/lib/project-action-entitlements", () => ({ assertPaidProjectActionAccess: () => {} }));
vi.mock("@/lib/usage", () => ({ getUsageSnapshot: async () => ({ remainingSeconds: mock.remaining }) }));
vi.mock("@/lib/language-test", () => ({ languageTestCommentProfile: async () => undefined }));
vi.mock("@/lib/subtitle-template-release", () => ({ getEffectiveSubtitleTemplateAccess: async () => ({ enabled: true }) }));
vi.mock("@/lib/template-execution-snapshot", () => ({
  assertUnifiedTemplateSubtitleCanaryAccess: () => {},
  isUnifiedTemplateSubtitleSnapshot: () => false,
}));
vi.mock("@/lib/comment-regeneration-server", () => ({
  paidGeminiCommentGenerationEnabled: () => true,
  generateCommentsWithGemini: mock.generate,
}));

import { POST } from "../app/api/shorts/[shortId]/regenerate-comments/route";

function requestComments() {
  return POST(new Request("https://example.test/api/comments", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "894be099-32da-45e8-a873-53ddbcba9b72", commentCount: 1 }),
  }), { params: Promise.resolve({ shortId: "f7d86fab-7ebc-4cda-b780-8b3d7d20d701" }) });
}

describe("comment regeneration request retries", () => {
  beforeEach(() => {
    mock.remaining = 60;
    mock.queries = [];
    mock.status = "consumed";
    mock.owned = true;
    mock.reservationError = "";
    mock.generate.mockReset().mockResolvedValue(["new comment"]);
  });

  it.each([60, 0])("returns completed comments with %i seconds left without another AI call or charge", async (remaining) => {
    mock.remaining = remaining;
    const response = await requestComments();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      comments: ["already generated"], usage: { remainingSeconds: remaining },
    });
    expect(mock.generate).not.toHaveBeenCalled();
    expect(mock.queries.some((query) => query.includes("status='consumed'"))).toBe(false);
  });

  it("keeps the database balance check for a new request", async () => {
    mock.remaining = 0;
    mock.reservationError = "댓글 재생성에 사용할 수 있는 시간이 부족합니다.";
    const response = await requestComments();
    expect(response.status).toBe(402);
    expect((await response.json()).code).toBe("COMMENT_REGENERATION_USAGE_REQUIRED");
    expect(mock.generate).not.toHaveBeenCalled();
    const cleanup = mock.queries.findIndex((query) => query.includes("failure_code='stale_request'"));
    const reservation = mock.queries.findIndex((query) => query.includes("reserve_ai_comment_regeneration_usage"));
    expect(cleanup).toBeGreaterThan(-1);
    expect(cleanup).toBeLessThan(reservation);
  });

  it("generates and finalizes a newly reserved request once", async () => {
    mock.status = "reserved";
    const response = await requestComments();
    expect(response.status).toBe(200);
    expect((await response.json()).comments).toEqual(["new comment"]);
    expect(mock.generate).toHaveBeenCalledTimes(1);
    expect(mock.queries.filter((query) => query.includes("status='consumed'"))).toHaveLength(1);
  });

  it("releases a failed generation", async () => {
    mock.status = "reserved";
    mock.generate.mockRejectedValue(new Error("provider unavailable"));
    const response = await requestComments();
    expect(response.status).toBe(503);
    expect(mock.queries.some((query) => query.includes("failure_code='gemini_generation_failed'"))).toBe(true);
  });

  it("keeps ownership checks before returning saved comments", async () => {
    mock.owned = false;
    const response = await requestComments();
    expect(response.status).toBe(404);
    expect(mock.queries.some((query) => query.includes("select status,generated_comments"))).toBe(false);
    expect(mock.generate).not.toHaveBeenCalled();
  });
});
