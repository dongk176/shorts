import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import postgres, {type Sql} from "postgres";
import {randomUUID} from "node:crypto";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({db: null as unknown as Sql, posts: [] as Record<string, unknown>[], workers: new Map<string, Record<string, unknown>>(), failures: new Map<string, number>(), held: new Set<string>()}));
vi.mock("./db", () => ({getDb: () => state.db}));
vi.mock("@vercel/sandbox", () => ({Sandbox: {}}));
vi.mock("./ranking-vercel-output", () => ({createRankingOutputUpload: async () => ({uploadUrl: "https://upload.invalid"})}));
vi.mock("./ranking-vercel-egress", () => ({
  leaseRankingVercelRoute: async (id: string) => {state.held.add(id); return "https://proxy.invalid";},
  releaseRankingVercelRoutes: async (id: string, _task: string, result: string) => {
    if (state.held.delete(id)) await state.db`insert into shorts_mvp.ranking_route_attempts(operation_id,route_id,result,created_at) values(${id},'test-route',${result},now()-interval '2 minutes')`;
  },
}));
import {dispatchRankingVercel, syncRankingVercelOperation} from "./ranking-vercel";
const url = process.env.RANKING_TEST_DATABASE_URL;
(url ? describe : describe.skip)("render source preparation with isolated PostgreSQL", () => {
  const owner = randomUUID();
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/ranking_test") throw Error("Disposable local DB only");
    state.db = postgres(url!, {max: 6, transform: postgres.camel});
    await state.db`insert into shorts_mvp.app_users(id,is_admin) values(${owner},true)`;
    vi.stubEnv("RANKING_TOKEN_SECRET", "a".repeat(64));
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const id = url.split("/").pop()!;
      if (options.method === "POST") {
        const input = JSON.parse(options.body as string);
        const previous = state.workers.get(id);
        if (previous?.attempt === input.attempt) return new Response(null, {status: 202});
        state.posts.push(input);
        const source = input.sourceId;
        const fail = source && input.attempt < (state.failures.get(source) || 0);
        state.workers.set(id, input.action === "render" ? {status: "running", attempt: 0} : fail
          ? {status: "failed", attempt: input.attempt, failureCategory: "bot_check", failureReason: "bot_challenge"}
          : {status: "succeeded", attempt: input.attempt, result: {source: {id: source, duration: 20, width: 720, height: 1280, hasAudio: true, previewReady: true, durationKnown: true}}});
        return new Response(null, {status: 202});
      }
      return state.workers.has(id) ? Response.json(state.workers.get(id)) : new Response(null, {status: 404});
    }));
  });
  afterAll(async () => {
    await state.db`delete from shorts_mvp.ranking_route_attempts where operation_id in(select o.id from shorts_mvp.ranking_operations o join shorts_mvp.ranking_projects p on p.id=o.project_id where p.user_id=${owner})`;
    await state.db`delete from shorts_mvp.ranking_projects where user_id=${owner}`;
    await state.db`delete from shorts_mvp.app_users where id=${owner}`;
    await state.db.end();
    vi.unstubAllGlobals();
  });
  async function fixture(failures: number) {
    const project = randomUUID(), operation = randomUUID(), generation = randomUUID();
    const sources = [randomUUID(), randomUUID()];
    state.failures.set(sources[1], failures);
    await state.db`insert into shorts_mvp.ranking_projects(id,user_id) values(${project},${owner})`;
    await state.db`insert into shorts_mvp.ranking_vercel_sessions(project_id,generation,status,base_url,expires_at) values(${project},${generation},'ready','https://sb-test.vercel.run',now()+interval '30 minutes')`;
    for (const id of sources) await state.db`insert into shorts_mvp.ranking_sources(id,project_id,status,remote_url,metadata) values(${id},${project},'ready','https://www.youtube.com/watch?v=abcdefghijk','{}')`;
    await state.db`insert into shorts_mvp.ranking_operations(id,project_id,action,status,executor,payload,request_id) values(${operation},${project},'render','running','vercel',${state.db.json({clips: sources.map((sourceId, index) => ({sourceId, rank: index+1, start: 0, end: 3}))})},${randomUUID()})`;
    return {project, operation, sources};
  }
  it("reuses a successful source while another succeeds on attempt ten, then renders once", async () => {
    const {project, operation, sources} = await fixture(9);
    await dispatchRankingVercel(project, operation);
    for (let i=0; i<13; i++) await syncRankingVercelOperation(project, operation);
    expect(state.posts.filter(p => p.sourceId === sources[0])).toHaveLength(1);
    expect(state.posts.filter(p => p.sourceId === sources[1])).toHaveLength(10);
    expect(state.posts.filter(p => p.sourceId === sources[1]).at(-1)).toMatchObject({attempt: 9, maxAttempts: 10});
    expect(state.posts.filter(p => p.action === "render")).toHaveLength(1);
    const rows = await state.db`select result,task_id from shorts_mvp.ranking_operations where id=${operation}`;
    expect(rows[0].taskId).toMatch(/^vercel:/);
    expect(rows[0].result).toBeNull();
    await state.db`update shorts_mvp.ranking_operations set status='failed' where id=${operation}`;
  });
  it("fails only after ten unsuccessful attempts without rendering or downloading successes again", async () => {
    const {project, operation, sources} = await fixture(100);
    const renders = state.posts.filter(p => p.action === "render").length;
    await dispatchRankingVercel(project, operation);
    for (let i=0; i<14; i++) await syncRankingVercelOperation(project, operation);
    expect(state.posts.filter(p => p.sourceId === sources[0])).toHaveLength(1);
    expect(state.posts.filter(p => p.sourceId === sources[1])).toHaveLength(10);
    expect(state.posts.filter(p => p.action === "render")).toHaveLength(renders);
    const rows = await state.db`select status,error from shorts_mvp.ranking_operations where id=${operation}`;
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("2위");
  });
});
