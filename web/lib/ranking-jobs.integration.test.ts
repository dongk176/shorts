import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ db: null as unknown as Sql }));
vi.mock("./db", () => ({ getDb: () => state.db }));
vi.mock("./ranking-runtime", () => ({
  wakeRankingRuntime: async () => true,
  rankingReceiverAccess: () => ({
    url: "https://receiver.example/upload",
    token: "test",
  }),
}));
import {
  createRankingProject,
  queueRankingSource,
  queueRankingOperation,
  rankingOperation,
} from "./ranking-jobs";
import { processRankingEmails } from "./ranking-completion-email";
const url = process.env.RANKING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("ranking isolated database workflow", () => {
  const owner = randomUUID(),
    other = randomUUID();
  let project: string;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
      parsed.pathname !== "/ranking_test"
    )
      throw new Error("Local disposable ranking test database only");
    state.db = postgres(url!, { max: 3, transform: postgres.camel });
    await state.db`insert into shorts_mvp.app_users(id,is_admin,email) values(${owner},true,'admin@example.test'),(${other},true,'other@example.test')`;
    project = (await createRankingProject(owner)).id;
  });
  afterAll(async () => {
    await state.db`delete from shorts_mvp.ranking_completion_emails where operation_id in(select id from shorts_mvp.ranking_operations where project_id in(select id from shorts_mvp.ranking_projects where user_id in (${owner},${other})))`;
    await state.db`delete from shorts_mvp.ranking_projects where user_id in (${owner},${other})`;
    await state.db`delete from shorts_mvp.app_users where id in (${owner},${other})`;
    await state.db.end();
  });
  it("rejects another administrator's project without creating a source", async () => {
    await expect(
      queueRankingSource(project, other, { requestId: randomUUID(), size: 4 }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("deduplicates source admission and blocks a second in-flight operation", async () => {
    const input = { requestId: randomUUID(), size: 4 };
    const [a, b] = await Promise.all([
      queueRankingSource(project, owner, input),
      queueRankingSource(project, owner, input),
    ]);
    if (!("operationId" in a) || !("operationId" in b))
      throw new Error("runtime not ready");
    expect(a.operationId).toEqual(b.operationId);
    await expect(
      queueRankingSource(project, owner, { requestId: randomUUID(), size: 4 }),
    ).rejects.toMatchObject({ status: 409 });
    await state.db`update shorts_mvp.ranking_operations set status='failed' where id=${a.operationId!}`;
  });
  it("validates source ranges and persists exact render order", async () => {
    const source = randomUUID();
    await state.db`insert into shorts_mvp.ranking_sources(id,project_id,status,metadata) values(${source},${project},'ready',${state.db.json({ id: source, duration: 10, durationKnown: true })})`;
    const spec = {
      title: "test",
      subtitle: "ranking",
      descending: true,
      rankCount: 3,
      playbackOrder: [2, 1],
      clips: [
        { rank: 1, sourceId: source, label: "one", start: 1, end: 3 },
        { rank: 2, sourceId: source, label: "two", start: 4, end: 7 },
      ],
    };
    await expect(
      queueRankingOperation(project, owner, "render", {
        requestId: randomUUID(),
        spec: { ...spec, clips: [{ ...spec.clips[0], end: 11 }] },
      }),
    ).rejects.toMatchObject({ status: 400 });
    const op = await queueRankingOperation(project, owner, "render", {
      requestId: randomUUID(),
      spec,
    });
    await expect(
      rankingOperation(project, op.operationId, other),
    ).rejects.toMatchObject({ status: 404 });
    const rows =
      await state.db`select payload from shorts_mvp.ranking_operations where id=${op.operationId}`;
    expect(rows[0].payload.playbackOrder).toEqual([2, 1]);
    await state.db`update shorts_mvp.ranking_operations set status='succeeded',result=${state.db.json({ duration: 5, outputKey: `outputs/ranking/${project}/${op.operationId}.mp4` })} where id=${op.operationId}`;
    await state.db`insert into shorts_mvp.ranking_completion_emails(operation_id) values(${op.operationId})`;
  });
  it("atomically accepts concurrent identical remote renders and rolls back invalid sources", async () => {
    const pending = randomUUID();
    const input = { requestId: randomUUID(), links: [{ sourceId: pending, url: "https://www.youtube.com/shorts/vtQV5zRU71o" }],
      spec: { title: "remote queue", descending: true, rankCount: 2, playbackOrder: [2],
        clips: [{ rank: 2, sourceId: pending, label: "remote", start: 1, end: 4 }] } };
    const [before] = await state.db`select count(*)::int as count from shorts_mvp.ranking_sources where project_id=${project}`;
    await expect(queueRankingOperation(project, owner, "render", { ...input, spec: { ...input.spec,
      clips: [...input.spec.clips, { rank: 1, sourceId: randomUUID(), label: "missing", start: 0, end: 1 }], playbackOrder: [2, 1] } }))
      .rejects.toMatchObject({ status: 400 });
    const [after] = await state.db`select count(*)::int as count from shorts_mvp.ranking_sources where project_id=${project}`;
    expect(after.count).toBe(before.count);
    const [a, b] = await Promise.all([
      queueRankingOperation(project, owner, "render", input), queueRankingOperation(project, owner, "render", input),
    ]);
    expect(a.operationId).toBe(b.operationId);
    const [op] = await state.db`select payload,status from shorts_mvp.ranking_operations where id=${a.operationId}`;
    expect(op.status).toBe("queued");
    expect(op.payload.playbackOrder).toEqual([2]);
    const [source] = await state.db`select status,metadata,remote_url from shorts_mvp.ranking_sources where id=${op.payload.clips[0].sourceId}`;
    expect(source.status).toBe("ready");
    expect(source.metadata.durationKnown).toBe(false);
    expect(source.remoteUrl).toBe("https://www.youtube.com/watch?v=vtQV5zRU71o");
    const [final] = await state.db`select count(*)::int as count from shorts_mvp.ranking_sources where project_id=${project}`;
    expect(final.count).toBe(before.count + 1);
    await state.db`update shorts_mvp.ranking_operations set status='failed' where id=${a.operationId}`;
  });
  it("sends a completion only once across concurrent cron workers", async () => {
    const send = vi.fn().mockResolvedValue("email-test");
    await Promise.all([processRankingEmails(send), processRankingEmails(send)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].email).toBe("admin@example.test");
    await processRankingEmails(send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("terminates an exhausted email claim after a crashed sender", async () => {
    const op = randomUUID();
    await state.db`insert into shorts_mvp.ranking_operations(id,project_id,action,status,request_id) values(${op},${project},'render','succeeded',${randomUUID()})`;
    await state.db`insert into shorts_mvp.ranking_completion_emails(operation_id,status,attempt_count,claimed_at) values(${op},'processing',5,now()-interval '6 minutes')`;
    const send = vi.fn();
    await processRankingEmails(send);
    expect(send).not.toHaveBeenCalled();
    const rows =
      await state.db`select status from shorts_mvp.ranking_completion_emails where operation_id=${op}`;
    expect(rows[0].status).toBe("failed");
  });
  it("skips a completion after administrator access is revoked", async () => {
    const op = randomUUID();
    await state.db`insert into shorts_mvp.ranking_operations(id,project_id,action,status,request_id) values(${op},${project},'render','succeeded',${randomUUID()})`;
    await state.db`insert into shorts_mvp.ranking_completion_emails(operation_id) values(${op})`;
    await state.db`update shorts_mvp.app_users set is_admin=false where id=${owner}`;
    const send = vi.fn();
    await processRankingEmails(send);
    expect(send).not.toHaveBeenCalled();
    const rows =
      await state.db`select status from shorts_mvp.ranking_completion_emails where operation_id=${op}`;
    expect(rows[0].status).toBe("skipped");
  });
});
