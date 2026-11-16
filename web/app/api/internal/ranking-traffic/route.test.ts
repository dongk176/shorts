import { beforeEach, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
const mocks = vi.hoisted(() => ({ db: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/media-traffic-store", () => ({ saveTrafficEvents: mocks.save }));
vi.mock("@/lib/ranking-access", () => ({
  rankingBody: (r: Request) => r.json(),
}));
import { POST } from "./route";
const project = crypto.randomUUID(),
  generation = crypto.randomUUID();
function request(patch: object = {}, signed = true) {
  const data = {
    project,
    generation,
    events: [
      {
        id: crypto.randomUUID(),
        resource: crypto.randomUUID(),
        purpose: "source_preview",
        bytes: 1234,
        interrupted: false,
      },
    ],
    environment: "production",
    ...patch,
  };
  const body = JSON.stringify(data);
  const secret = createHmac("sha256", "x".repeat(64))
    .update(`ranking-vercel-v1.${project}.${generation}`)
    .digest("hex");
  return new Request("https://www.easycut.co.kr/api/internal/ranking-traffic", {
    method: "POST",
    body,
    headers: {
      "x-ranking-traffic-signature": signed
        ? createHmac("sha256", secret).update(body).digest("hex")
        : "0".repeat(64),
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.RANKING_TOKEN_SECRET = "x".repeat(64);
  mocks.db.mockResolvedValue([{ userId: "verified-owner" }]);
  mocks.save.mockResolvedValue(undefined);
});
it("accepts authenticated reports with server-derived owner", async () => {
  expect((await POST(request())).status).toBe(204);
  expect(mocks.save).toHaveBeenCalledWith(
    expect.any(Array),
    expect.objectContaining({
      userId: "verified-owner",
      projectId: project,
      provider: "vercel_sandbox",
    }),
  );
});
it("rejects tampered signature before database access", async () => {
  expect((await POST(request({}, false))).status).toBe(403);
  expect(mocks.db).not.toHaveBeenCalled();
});
it("rejects replaced generation and oversized batches", async () => {
  mocks.db.mockResolvedValue([]);
  expect((await POST(request())).status).toBe(403);
  expect(mocks.save).not.toHaveBeenCalled();
  expect((await POST(request({ events: Array(51).fill({}) }))).status).toBe(
    400,
  );
});
