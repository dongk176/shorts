import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  lease: vi.fn(),
  fetch: vi.fn(),
  mode: "terminal",
}));
vi.mock("./db", () => ({
  getDb: () =>
    Object.assign(state.query, {
      begin: async (fn: (tx: unknown) => unknown) => fn(state.query),
    }),
}));
vi.mock("./ranking-vercel-egress", () => ({
  releaseRankingVercelRoutes: state.release,
  leaseRankingVercelRoute: state.lease,
}));
vi.mock("./ranking-vercel-output", () => ({
  createRankingOutputUpload: vi.fn(),
}));
vi.mock("@vercel/sandbox", () => ({ Sandbox: {} }));
import { syncRankingVercelOperation } from "./ranking-vercel";
const project = "bb067942-b3ac-4a46-a9fc-3bf260a209cd",
  operation = "bb067942-b3ac-4a46-a9fc-3bf260a209ce",
  source = "bb067942-b3ac-4a46-a9fc-3bf260a209cf";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RANKING_TOKEN_SECRET", "a".repeat(64));
  vi.stubGlobal("fetch", state.fetch);
  state.mode = "terminal";
  state.lease.mockResolvedValue("https://proxy.invalid");
  state.release.mockResolvedValue(undefined);
  state.query.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("ranking_vercel_sessions"))
      return [
        {
          projectId: project,
          generation: "generation",
          sandboxName: "test",
          baseUrl: "https://sb-test.vercel.run",
          status: "ready",
          expiresAt: new Date(Date.now() + 600000),
        },
      ];
    if (sql.startsWith("select o.*"))
      return [
        {
          id: operation,
          sourceId: source,
          action: "preview",
          taskId: "vercel:generation",
          expiresAt: new Date(Date.now() + 600000),
          isAdmin: true,
          createdAt: new Date(),
          payload: {},
        },
      ];
    if (sql.includes("select count(*)")) return [{ count: 1 }];
    if (sql.startsWith("select id,remote_url"))
      return [
        {
          id: source,
          remoteUrl: "https://www.youtube.com/watch?v=abcdefghijk",
          metadata: {},
        },
      ];
    if (sql.includes("returning id")) return [{ id: operation }];
    return [];
  });
  state.fetch.mockImplementation(async (_url: string, options: RequestInit) =>
    options.method === "POST"
      ? new Response(null, { status: 202 })
      : Response.json({
          status: "failed",
          attempt: 0,
          failureCategory: state.mode === "terminal" ? "terminal" : "bot_check",
          error: "restricted",
        }),
  );
});
it("never retries restricted content", async () => {
  await syncRankingVercelOperation(project, operation);
  expect(state.lease).not.toHaveBeenCalled();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(
    state.query.mock.calls.some(([s]) =>
      s.join("").includes("finished_at=now()"),
    ),
  ).toBe(true);
});
it("does not release the newer lease when a stale poll returns the previous attempt", async () => {
  state.mode = "retry";
  await syncRankingVercelOperation(project, operation);
  expect(state.release).not.toHaveBeenCalled();
  const post = state.fetch.mock.calls.find(
    ([, options]) => options.method === "POST",
  );
  expect(JSON.parse(post![1].body)).toMatchObject({
    attempt: 1,
    action: "preview",
  });
  expect(
    state.query.mock.calls.some(([s]) =>
      s.join("").includes("finished_at=now()"),
    ),
  ).toBe(false);
});
it("returns sanitized live progress without marking an operation complete", async () => {
  state.fetch.mockResolvedValue(new Response(JSON.stringify({status:"running",progress:{stage:"downloading",percent:62.5,proxy:"not-exposed"}})));
  expect(await syncRankingVercelOperation(project, operation)).toEqual({stage:"downloading",percent:62.5});
  expect(state.release).not.toHaveBeenCalled();
  expect(state.query.mock.calls.some(([strings])=>strings.join("?").startsWith("update"))).toBe(false);
});
it("does not spend ten attempts on proxy authentication configuration errors", async () => {
  state.fetch.mockResolvedValue(Response.json({status:"failed",attempt:0,failureCategory:"network_error",failureReason:"proxy_auth",error:"private diagnostic"}));
  await syncRankingVercelOperation(project,operation);
  expect(state.lease).not.toHaveBeenCalled();
  expect(state.release).toHaveBeenCalledWith(operation,"vercel:generation","network_error");
  expect(state.query.mock.calls.some(([s])=>s.join("").includes("finished_at=now()"))).toBe(true);
  expect(state.query.mock.calls.flat().join(" ")).not.toContain("private diagnostic");
});
