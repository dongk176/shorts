import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { GET, PUT } from "./route";

const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";

function request(templateKeys: string[]) {
  return new Request("http://localhost/api/template-favorites", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateKeys }),
  });
}

function dbWithRows(...responses: unknown[][]) {
  const tag = vi.fn();
  for (const response of responses) tag.mockResolvedValueOnce(response);
  Object.assign(tag, { json: (value: unknown) => value });
  return tag;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId });
});

describe("template favorites API", () => {
  it("returns the existing three home templates for a new account", async () => {
    mocks.getDb.mockReturnValue(dbWithRows([]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      templateKeys: ["preset:comment-capture", "preset:dark-minimal", "preset:paper"],
    });
  });

  it("persists an ordered selection, including an empty selection", async () => {
    const db = dbWithRows();
    const tx = dbWithRows([], []);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await PUT(request([]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ templateKeys: [] });
    expect(tx).toHaveBeenCalledTimes(2);
  });

  it("rejects a fifth favorite", async () => {
    const response = await PUT(request([
      "preset:comment-capture",
      "preset:dark-minimal",
      "preset:paper",
      "preset:dark-red",
      "preset:white-yellow",
    ]));

    expect(response.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects a personal template not owned by the user", async () => {
    const db = dbWithRows();
    const tx = dbWithRows([], []);
    Object.assign(db, { begin: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) });
    mocks.getDb.mockReturnValue(db);

    const response = await PUT(request([`custom:${userId}`]));

    expect(response.status).toBe(404);
    expect(tx).toHaveBeenCalledTimes(2);
  });
});
