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
const requestId = "276a287d-8531-4cb5-9918-5811b12148e4";

function sqlWithRows(...responses: unknown[][]) {
  const sql = vi.fn();
  for (const response of responses) sql.mockResolvedValueOnce(response);
  return sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId });
});

describe("project feedback deferral API", () => {
  it("permanently stops prompting after deferral at completion 12", async () => {
    const tx = sqlWithRows(
      [],
      [],
      [{
        completedProjectCount: 12,
        submitted: false,
        lastDeferredPromptCompletionCount: 9,
      }],
      [],
      [{
        completedProjectCount: 12,
        submitted: false,
        lastDeferredPromptCompletionCount: 12,
      }],
    );
    const db = sqlWithRows();
    Object.assign(db, {
      begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(new Request("http://localhost/api/project-feedback/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      eligible: false,
      permanentlyDismissed: true,
      promptCompletionCount: null,
    });
    expect(tx).toHaveBeenCalledTimes(5);
  });
});
