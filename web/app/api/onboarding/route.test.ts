import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { GET, POST } from "./route";

const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";
const requestId = "276a287d-8531-4cb5-9918-5811b12148e4";

function dbWithRows(...responses: unknown[][]) {
  const sql = vi.fn();
  for (const response of responses) sql.mockResolvedValueOnce(response);
  return sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId });
});

describe("user onboarding API", () => {
  it("requires onboarding when the account has no stored response", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ required: true, version: 1 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("does not require onboarding after a response was stored", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([{ "?column?": 1 }]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ required: false, version: 1 });
  });

  it("stores a valid response once per account", async () => {
    const db = dbWithRows([]);
    mocks.getDb.mockReturnValue(db);

    const response = await POST(new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        occupation: "creator",
        occupationOther: null,
        usagePurposes: ["youtube_shorts", "save_editing_time"],
        usagePurposeOther: null,
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ completed: true });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("rejects other without a direct answer", async () => {
    const response = await POST(new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        occupation: "other",
        occupationOther: null,
        usagePurposes: ["other"],
        usagePurposeOther: null,
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
