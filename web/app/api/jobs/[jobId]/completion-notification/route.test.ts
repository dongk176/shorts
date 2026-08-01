import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { POST } from "./route";

const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";
const jobId = "276a287d-8531-4cb5-9918-5811b12148e4";

function sqlWithRows(...responses: unknown[][]) {
  const sql = vi.fn();
  for (const response of responses) sql.mockResolvedValueOnce(response);
  return sql;
}

function request() {
  return new Request(`http://localhost/api/jobs/${jobId}/completion-notification`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
    },
    body: "{}",
  });
}

function context() {
  return { params: Promise.resolve({ jobId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    id: "session-id",
    userId,
    user: { email: "owner@example.com" },
  });
});

describe("job completion notification API", () => {
  it("stores a waiting notification while the job is still running", async () => {
    const tx = sqlWithRows(
      [{ id: jobId, status: "rendering", email: "owner@example.com" }],
      [],
      [{ status: "waiting" }],
    );
    mocks.getDb.mockReturnValue({
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requested: true,
      status: "waiting",
    });
    expect(tx.mock.calls[2].slice(1)).toContain("waiting");
  });

  it("queues immediately when the job completed before the button was pressed", async () => {
    const tx = sqlWithRows(
      [{ id: jobId, status: "completed", email: "owner@example.com" }],
      [],
      [{ status: "pending" }],
    );
    mocks.getDb.mockReturnValue({
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "pending" });
    expect(tx.mock.calls[2].slice(1)).toContain("pending");
  });

  it("does not allow requesting notifications for another user's job", async () => {
    const tx = sqlWithRows([]);
    mocks.getDb.mockReturnValue({
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    expect(tx).toHaveBeenCalledOnce();
  });
});
