import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
  signedThumbnailUrl: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));
vi.mock("@/lib/aws", () => ({
  getProjectSourceThumbnailUrl: mocks.signedThumbnailUrl,
}));

import { HttpError } from "@/lib/http";
import { GET } from "./route";

const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";
const sessionId = "87a24de3-00a8-4d82-b42a-cc360fb934df";
const jobId = "e037700d-c961-4424-b0df-730a6ad72d34";
const safeKey = `thumbnails/${sessionId}/${jobId}/source.jpg`;

function context(projectNumber = "42") {
  return { params: Promise.resolve({ projectNumber }) };
}

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    jobId,
    mvpSessionId: sessionId,
    sourceThumbnailS3Key: safeKey,
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function dbWithRows(rows: Record<string, unknown>[]) {
  return vi.fn().mockResolvedValue(rows);
}

async function responseFor(projectNumber = "42") {
  return GET(
    new Request(`http://localhost/api/projects/${projectNumber}/source-thumbnail`),
    context(projectNumber),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: sessionId, userId });
  mocks.signedThumbnailUrl.mockResolvedValue(
    "https://cdn.example.com/signed-source-thumbnail",
  );
});

describe("GET /api/projects/[projectNumber]/source-thumbnail", () => {
  it("redirects an authenticated owner to a signed ready upload thumbnail", async () => {
    const db = dbWithRows([readyRow()]);
    mocks.getDb.mockReturnValue(db);

    const response = await responseFor();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://cdn.example.com/signed-source-thumbnail",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.signedThumbnailUrl).toHaveBeenCalledWith({
      key: safeKey,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const sql = String(db.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(sql).toContain("upload.job_id=job.id");
    expect(sql).toContain("upload.user_id=job.user_id");
    expect(sql).toContain("upload.mvp_session_id=job.mvp_session_id");
    expect(sql).toContain("job.user_id=");
    expect(sql).toContain("job.source_type='upload'");
    expect(sql).toContain("job.user_deleted_at is null");
    expect(sql).toContain("upload.received_bytes=upload.expected_bytes");
    expect(sql).toContain("upload.probe_metadata is not null");
    expect(sql).toContain("upload.status in ('claimed','completed','failed')");
  });

  it("returns the same concealed 404 for another user's project", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));

    const response = await responseFor();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      detail: "찾을 수 없습니다.",
      code: "NOT_FOUND",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.signedThumbnailUrl).not.toHaveBeenCalled();
  });

  it("returns the concealed 404 while signed out without querying projects", async () => {
    mocks.session.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));

    const response = await responseFor();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.signedThumbnailUrl).not.toHaveBeenCalled();
  });

  it("conceals a non-upload project", async () => {
    const db = dbWithRows([]);
    mocks.getDb.mockReturnValue(db);

    const response = await responseFor();

    expect(response.status).toBe(404);
    expect(String(db.mock.calls[0][0])).toContain("job.source_type='upload'");
    expect(mocks.signedThumbnailUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["outside thumbnails", "outputs/private/source.jpg"],
    ["other session", `thumbnails/77a24de3-00a8-4d82-b42a-cc360fb934df/${jobId}/source.jpg`],
    ["other job", `thumbnails/${sessionId}/e037700d-c961-4424-b0df-730a6ad72d35/source.jpg`],
    ["path traversal", `thumbnails/${sessionId}/${jobId}/../source.jpg`],
  ])("conceals a %s source thumbnail key", async (_, key) => {
    const db = dbWithRows([readyRow({ sourceThumbnailS3Key: key })]);
    mocks.getDb.mockReturnValue(db);

    const response = await responseFor();

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("outputs/private");
    expect(body).not.toContain("thumbnails/");
    expect(mocks.signedThumbnailUrl).not.toHaveBeenCalled();
  });
});
