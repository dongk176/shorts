import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

const mocks = vi.hoisted(() => ({
  authenticatedSession: vi.fn(),
  getDb: vi.fn(),
  releaseAccess: vi.fn(),
  lockedReleaseAccess: vi.fn(),
  usageSnapshot: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.authenticatedSession,
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/file-upload-release", () => ({
  getFileUploadReleaseAccess: mocks.releaseAccess,
  lockFileUploadReleaseAccess: mocks.lockedReleaseAccess,
}));
vi.mock("@/lib/usage", () => ({
  getUsageSnapshot: mocks.usageSnapshot,
}));

import { DELETE } from "./route";

const USER_ID = "3d14e57e-d516-44b1-89ac-30d76a6e701f";
const MVP_SESSION_ID = "7bf704e2-f151-45a5-9939-69d2a62b22aa";
const UPLOAD_SESSION_ID = "5a46c5d2-1578-4238-b561-b09a11faacb1";
const JOB_ID = "db421da3-e87e-473a-b495-29309af5ae42";
const usage = {
  remainingSeconds: 9_700,
  reservedSeconds: 0,
  enforcementEnabled: true,
};

function context(sessionId = UPLOAD_SESSION_ID) {
  return { params: Promise.resolve({ sessionId }) };
}

function cancelRequest() {
  return new Request(
    `http://localhost/api/file-upload/sessions/${UPLOAD_SESSION_ID}`,
    { method: "DELETE" },
  );
}

function transactionDb(input: {
  status?: string;
  consumedAt?: string | null;
  row?: boolean;
  failFinalize?: boolean;
} = {}) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const tx = vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const sql = Array.from(strings).join("?").replace(/\s+/g, " ").trim();
    queries.push({ sql, values });
    if (sql.includes("from shorts_mvp.upload_sessions upload")) {
      if (input.row === false) return [];
      return [{
        uploadSessionId: UPLOAD_SESSION_ID,
        jobId: JOB_ID,
        projectNumber: 91,
        status: input.status || "awaiting_upload",
        consumedAt: input.consumedAt ?? null,
      }];
    }
    if (sql.includes("finalize_project_job") && input.failFinalize) {
      throw new Error("finalize failed");
    }
    return [];
  });
  const db = Object.assign(vi.fn(), {
    begin: vi.fn(async (callback: (transaction: typeof tx) => unknown) => (
      callback(tx)
    )),
  });
  return { db, tx, queries };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticatedSession.mockResolvedValue({
    id: MVP_SESSION_ID,
    userId: USER_ID,
  });
  mocks.releaseAccess.mockResolvedValue({ enabled: true, adminEnabled: true });
  mocks.lockedReleaseAccess.mockResolvedValue({ enabled: true, adminEnabled: true });
  mocks.usageSnapshot.mockResolvedValue(usage);
});

describe("file upload browser abort", () => {
  it("conceals invalid IDs and signed-out users", async () => {
    const invalid = await DELETE(cancelRequest(), context("not-a-uuid"));
    expect(invalid.status).toBe(404);
    expect(mocks.getDb).not.toHaveBeenCalled();

    mocks.authenticatedSession.mockRejectedValueOnce(
      new HttpError(401, "로그인이 필요합니다."),
    );
    expect((await DELETE(cancelRequest(), context())).status).toBe(404);

  });

  it("allows an owner to cancel an issued session after new uploads are paused", async () => {
    const { db, queries } = transactionDb();
    mocks.getDb.mockReturnValue(db);
    mocks.lockedReleaseAccess.mockResolvedValue({
      enabled: false,
      adminEnabled: false,
      publicEnabled: false,
    });

    const response = await DELETE(cancelRequest(), context());

    expect(response.status).toBe(200);
    expect(queries.some((entry) => entry.sql.includes("upload_sessions upload")))
      .toBe(true);
    expect(mocks.releaseAccess).not.toHaveBeenCalled();
    expect(mocks.lockedReleaseAccess).not.toHaveBeenCalled();
  });

  it("returns the same hidden 404 when the owner-scoped session is absent", async () => {
    const { db } = transactionDb({ row: false });
    mocks.getDb.mockReturnValue(db);

    const response = await DELETE(cancelRequest(), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  });

  it("atomically cancels an unclaimed session, finalizes attempts, and releases usage", async () => {
    const { db, queries } = transactionDb();
    mocks.getDb.mockReturnValue(db);

    const response = await DELETE(cancelRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      uploadSessionId: UPLOAD_SESSION_ID,
      jobId: JOB_ID,
      projectNumber: 91,
      alreadyCancelled: false,
      cancelled: true,
      status: "cancelled",
      usage,
    });
    const lockedRead = queries.find((entry) => (
      entry.sql.includes("from shorts_mvp.upload_sessions upload")
    ));
    expect(lockedRead?.sql).toContain("for update of upload,job");
    expect(lockedRead?.sql).toContain("upload.user_id=");
    expect(lockedRead?.sql).toContain("job.source_type='upload'");

    const cancelled = queries.find((entry) => (
      entry.sql.includes("update shorts_mvp.upload_sessions")
    ));
    expect(cancelled?.sql).toContain("status='cancelled'");
    expect(cancelled?.sql).toContain("source_deleted_at=coalesce");
    expect(cancelled?.sql).toContain("where id=? and status='awaiting_upload'");

    const finalized = queries.find((entry) => (
      entry.sql.includes("shorts_mvp.finalize_project_job")
    ));
    expect(finalized?.values).toContain(JOB_ID);
    expect(finalized?.sql).toContain("'upload_cancelled'");
  });

  it("is idempotent after cancellation without finalizing or releasing twice", async () => {
    const { db, queries } = transactionDb({ status: "cancelled" });
    mocks.getDb.mockReturnValue(db);

    const response = await DELETE(cancelRequest(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cancelled: true,
      alreadyCancelled: true,
    });
    expect(queries.some((entry) => entry.sql.includes("update shorts_mvp.upload_sessions")))
      .toBe(false);
    expect(queries.some((entry) => entry.sql.includes("finalize_project_job")))
      .toBe(false);
  });

  it.each([
    ["claimed", null, "FILE_UPLOAD_ALREADY_CLAIMED"],
    ["awaiting_upload", "2026-08-23T12:00:00Z", "FILE_UPLOAD_ALREADY_CLAIMED"],
    ["completed", null, "FILE_UPLOAD_NOT_CANCELLABLE"],
    ["failed", null, "FILE_UPLOAD_NOT_CANCELLABLE"],
    ["expired", null, "FILE_UPLOAD_NOT_CANCELLABLE"],
  ])("rejects receiver-owned or terminal state %s", async (
    status,
    consumedAt,
    code,
  ) => {
    const { db, queries } = transactionDb({ status, consumedAt });
    mocks.getDb.mockReturnValue(db);

    const response = await DELETE(cancelRequest(), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code });
    expect(queries.some((entry) => entry.sql.includes("update shorts_mvp.upload_sessions")))
      .toBe(false);
    expect(queries.some((entry) => entry.sql.includes("finalize_project_job")))
      .toBe(false);
  });

  it("rolls back cancellation if project finalization fails", async () => {
    const { db, queries } = transactionDb({ failFinalize: true });
    mocks.getDb.mockReturnValue(db);

    const response = await DELETE(cancelRequest(), context());

    expect(response.status).toBe(400);
    expect(queries.some((entry) => entry.sql.includes("update shorts_mvp.upload_sessions")))
      .toBe(true);
    expect(queries.some((entry) => entry.sql.includes("finalize_project_job")))
      .toBe(true);
    expect(mocks.usageSnapshot).not.toHaveBeenCalled();
  });
});
