import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  authenticatedSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.authenticatedSession,
}));

import { HttpError } from "@/lib/http";
import { DELETE as deleteProject } from "./[projectNumber]/route";

type QueryRow = Record<string, unknown>;

function compactSql(strings: TemplateStringsArray, values: unknown[]) {
  return strings.reduce(
    (text, part, index) => `${text}${part}${index < values.length ? `$${index + 1}` : ""}`,
    "",
  ).replace(/\s+/g, " ").trim();
}

function transactionWithRows(...responses: QueryRow[][]) {
  const queries: string[] = [];
  const tx = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(compactSql(strings, values));
    return Promise.resolve(responses.shift() || []);
  });
  return Object.assign(tx, { queries });
}

function databaseWithTransaction(tx: ReturnType<typeof transactionWithRows>) {
  return {
    begin: vi.fn(
      (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
}

function context(projectNumber = "12") {
  return { params: Promise.resolve({ projectNumber }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticatedSession.mockResolvedValue({
    id: "session-a",
    selectedPlanCode: "plus",
    userId: "user-a",
    user: null,
  });
});

describe("DELETE /api/projects/[projectNumber]", () => {
  it("soft-deletes an owned terminal project without mutating its history", async () => {
    const tx = transactionWithRows(
      [{
        id: "job-a",
        status: "completed",
        userDeletedAt: null,
        hasActiveOutputs: false,
      }],
      [],
    );
    mocks.getDb.mockReturnValue(databaseWithTransaction(tx));

    const response = await deleteProject(
      new Request("http://localhost/api/projects/12", { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      alreadyDeleted: false,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.authenticatedSession).toHaveBeenCalledWith({
      allowPaymentMethodRemediation: true,
      createIfMissing: false,
    });

    const mutationQueries = tx.queries.filter((query) => /^(update|insert|delete|truncate)\b/i.test(query));
    expect(mutationQueries).toHaveLength(1);
    expect(mutationQueries[0]).toMatch(
      /^update shorts_mvp\.video_jobs set user_deleted_at=coalesce\(user_deleted_at, now\(\)\)/i,
    );
    expect(mutationQueries[0]).not.toMatch(
      /generated_shorts|\bstatus\b|\bstage\b|site_metrics|usage_events|s3|artifact/i,
    );
  });

  it.each([
    ["an active job", { status: "transcribing", hasActiveOutputs: false }],
    ["an active output", { status: "completed", hasActiveOutputs: true }],
  ])("rejects %s", async (_, projectState) => {
    const tx = transactionWithRows([{
      id: "job-a",
      userDeletedAt: null,
      ...projectState,
    }]);
    mocks.getDb.mockReturnValue(databaseWithTransaction(tx));

    const response = await deleteProject(
      new Request("http://localhost/api/projects/12", { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROJECT_DELETE_IN_PROGRESS",
    });
    expect(tx).toHaveBeenCalledOnce();
  });

  it("does not expose or delete another user's project or an example", async () => {
    const tx = transactionWithRows([]);
    mocks.getDb.mockReturnValue(databaseWithTransaction(tx));

    const response = await deleteProject(
      new Request("http://localhost/api/projects/12", { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(404);
    expect(tx.queries[0]).toContain("and j.user_id=$2");
    expect(tx.queries[0]).toContain("and not j.is_example");
    expect(tx).toHaveBeenCalledOnce();
  });

  it("treats a repeated delete as an idempotent success", async () => {
    const tx = transactionWithRows([{
      id: "job-a",
      status: "completed",
      userDeletedAt: new Date("2026-08-23T12:00:00.000Z"),
      hasActiveOutputs: false,
    }]);
    mocks.getDb.mockReturnValue(databaseWithTransaction(tx));

    const response = await deleteProject(
      new Request("http://localhost/api/projects/12", { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      alreadyDeleted: true,
    });
    expect(tx).toHaveBeenCalledOnce();
  });

  it("requires authentication before opening a transaction", async () => {
    mocks.authenticatedSession.mockRejectedValue(
      new HttpError(401, "로그인이 필요합니다."),
    );

    const response = await deleteProject(
      new Request("http://localhost/api/projects/12", { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects an invalid project number before authentication", async () => {
    const response = await deleteProject(
      new Request("http://localhost/api/projects/0", { method: "DELETE" }),
      context("0"),
    );

    expect(response.status).toBe(400);
    expect(mocks.authenticatedSession).not.toHaveBeenCalled();
  });
});
