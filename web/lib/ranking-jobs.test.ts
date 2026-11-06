import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ owner: vi.fn(), wake: vi.fn(), query: vi.fn(), begin: vi.fn() }));
vi.mock("./db", () => ({ getDb: () => ({ begin: state.begin }) }));
vi.mock("./ranking-access", () => ({ requireRankingProject: state.owner, rankingUuid: (id: string) => id }));
vi.mock("./ranking-runtime", () => ({ wakeRankingRuntime: state.wake, rankingReceiverAccess: vi.fn() }));
import { queueRankingOperation, queueRankingSource } from "./ranking-jobs";
import { HttpError } from "./http";
const project = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const url = "https://www.youtube.com/shorts/vtQV5zRU71o";
const input = () => ({ requestId, links: [{ sourceId, url }], spec: {
  title: "비동기 제작", descending: true, rankCount: 5, playbackOrder: [2],
  clips: [{ rank: 2, sourceId, label: "선택한 장면", start: 1, end: 4 }],
} });
const statements = () => state.query.mock.calls.map(([strings, ...args]) => ({ sql: strings.join("?"), args }));
beforeEach(() => {
  vi.resetAllMocks();
  state.owner.mockResolvedValue({ id: project });
  state.wake.mockResolvedValue(false); // Cold ECS still accepts durable queue work.
  state.begin.mockImplementation((fn) => fn(Object.assign(state.query, { json: (value: unknown) => value })));
  state.query.mockImplementation((strings: TemplateStringsArray) => Promise.resolve(
    strings.join("?").includes("for update") ? [{ id: project }] : [],
  ));
});
describe("durable ranking render submission", () => {
  it("registers pending links and saves one complete render job without browser preparation", async () => {
    const response = await queueRankingOperation(project, "owner", "render", input());
    const queries = statements();
    const source = queries.find((query) => query.sql.includes("insert into shorts_mvp.ranking_sources"))!;
    const operation = queries.find((query) => query.sql.includes("insert into shorts_mvp.ranking_operations"))!;
    const metadata = source.args[3] as { durationKnown: boolean; previewReady: boolean };
    expect(metadata).toMatchObject({ durationKnown: false, previewReady: false });
    expect(source.args[0]).not.toBe(sourceId);
    expect(source.args[2]).toBe("https://www.youtube.com/watch?v=vtQV5zRU71o");
    expect(operation.args[3]).toBe("render");
    expect(operation.args[4]).toMatchObject({ playbackOrder: [2], clips: [{ sourceId: source.args[0], rank: 2, start: 1, end: 4, label: "선택한 장면" }] });
    expect(operation.args[0]).toBe(response.operationId);
    expect(state.begin).toHaveBeenCalledTimes(1);
    expect(queries.some((query) => query.sql.includes("set draft="))).toBe(true);
  });
  it("returns an already accepted request before inserting sources again", async () => {
    state.query.mockResolvedValueOnce([{ id: project }]).mockResolvedValueOnce([{ id: "existing-render" }]);
    expect(await queueRankingOperation(project, "owner", "render", input())).toMatchObject({ operationId: "existing-render" });
    expect(statements().some((q) => q.sql.includes("insert into"))).toBe(false);
  });
  it("does not wake or write for another owner's project", async () => {
    state.owner.mockRejectedValue(new HttpError(404, "not found"));
    await expect(queueRankingOperation(project, "other", "render", input())).rejects.toMatchObject({ status: 404 });
    expect(state.wake).not.toHaveBeenCalled();
    expect(state.begin).not.toHaveBeenCalled();
  });
  it.each(["https://127.0.0.1/video", "https://www.youtube.com.evil.test/shorts/vtQV5zRU71o", "https://name:password@www.youtube.com/shorts/vtQV5zRU71o"])("rejects unsupported remote targets: %s", async (badUrl) => {
    const value = input(); value.links[0].url = badUrl;
    await expect(queueRankingOperation(project, "owner", "render", value)).rejects.toMatchObject({ status: 400 });
    expect(state.wake).not.toHaveBeenCalled();
  });
  it("rejects unreferenced links and duplicate source references", async () => {
    const value = input(); value.links.push({ sourceId, url });
    await expect(queueRankingOperation(project, "owner", "render", value)).rejects.toMatchObject({ status: 400 });
    value.links = [{ sourceId: requestId, url }];
    await expect(queueRankingOperation(project, "owner", "render", value)).rejects.toMatchObject({ status: 400 });
  });
  it("rechecks deletion and ownership under the project lock", async () => {
    state.query.mockResolvedValueOnce([]);
    await expect(queueRankingOperation(project, "owner", "render", input())).rejects.toMatchObject({ status: 404 });
    expect(statements()[0].sql).toContain("user_id=? and deleted_at is null and expires_at>now() for update");
  });
  it("rejects concurrent work before source insertion", async () => {
    state.query.mockResolvedValueOnce([{ id: project }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "active" }]);
    await expect(queueRankingOperation(project, "owner", "render", input())).rejects.toMatchObject({ status: 409 });
    expect(statements().some((q) => q.sql.includes("insert into"))).toBe(false);
  });
  it("accepts already registered remote links with unknown duration for worker validation", async () => {
    state.query.mockResolvedValueOnce([{ id: project }]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: sourceId, status: "ready", metadata: { duration: 1200, durationKnown: false }, remoteUrl: url }]);
    const value = input(); value.links = [];
    await expect(queueRankingOperation(project, "owner", "render", value)).resolves.toHaveProperty("operationId");
  });
  it.each([{ sources: [] }, { sources: [{ id: sourceId, status: "ready", metadata: { duration: 2 }, remoteUrl: null }] }, { sources: [{ id: sourceId, status: "ready", metadata: { durationKnown: false }, remoteUrl: null }] }])("rejects missing sources and invalid local ranges", async ({ sources }) => {
    state.query.mockResolvedValueOnce([{ id: project }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(sources);
    const value = input(); value.links = [];
    await expect(queueRankingOperation(project, "owner", "render", value)).rejects.toMatchObject({ status: 400 });
    expect(statements().some((q) => q.sql.includes("insert into shorts_mvp.ranking_operations"))).toBe(false);
  });
});


it("retries a failed saved remote without duplicating sources or changing the selection", async () => {
  state.query.mockResolvedValueOnce([{id:project}]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    .mockResolvedValueOnce([{id:sourceId,status:"failed",remoteUrl:url,metadata:{duration:1200,durationKnown:false}}]);
  const value=input();value.links=[];
  await expect(queueRankingOperation(project,"owner","render",value)).resolves.toHaveProperty("operationId");
  const queries=statements();
  expect(queries.some(q=>q.sql.includes("insert into shorts_mvp.ranking_sources"))).toBe(false);
  expect(queries.find(q=>q.sql.includes("insert into shorts_mvp.ranking_operations"))?.args[4]).toMatchObject({
    playbackOrder:[2],clips:[{rank:2,sourceId,start:1,end:4,label:"선택한 장면"}],
  });
});
it.each([null,"https://127.0.0.1/video","https://www.youtube.com.evil.test/watch?v=vtQV5zRU71o"])("never retries a failed upload or an unsupported saved target: %s",async(remoteUrl)=>{
  state.query.mockResolvedValueOnce([{id:project}]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    .mockResolvedValueOnce([{id:sourceId,status:"failed",remoteUrl,metadata:{duration:1200,durationKnown:false}}]);
  const value=input();value.links=[];
  await expect(queueRankingOperation(project,"owner","render",value)).rejects.toMatchObject({status:400});
  expect(statements().some(q=>q.sql.includes("insert into shorts_mvp.ranking_operations"))).toBe(false);
});
describe("Instagram preparation", () => {
  it("queues one validated preview instead of a redundant metadata job", async () => {
    state.query.mockImplementation((strings: TemplateStringsArray) => Promise.resolve(strings.join("?").includes("count(*)") ? [{count: 0}] : strings.join("?").includes("for update") ? [{id:project}] : []));
    const result = await queueRankingSource(project, "owner", {requestId, url: "https://www.instagram.com/reel/DZJ9ag9SNRI/?igsh=test"});
    const queries = statements();
    expect(queries.find(q => q.sql.includes("insert into shorts_mvp.ranking_operations"))?.args).toContain("preview");
    expect(queries.find(q => q.sql.includes("insert into shorts_mvp.ranking_sources"))?.args.at(-1)).toEqual({remote: {platform: "instagram",videoId: "DZJ9ag9SNRI",url: "https://www.instagram.com/reel/DZJ9ag9SNRI/"}});
    expect(result).toHaveProperty("operationId");
  });
  it("does not admit an Instagram source belonging to another administrator", async () => {
    state.owner.mockRejectedValue(new HttpError(404,"not found"));
    await expect(queueRankingSource(project,"other",{requestId,url:"https://www.instagram.com/reel/DZJ9ag9SNRI/"})).rejects.toMatchObject({status:404});
    expect(state.wake).not.toHaveBeenCalled();
    expect(state.begin).not.toHaveBeenCalled();
  });
});
