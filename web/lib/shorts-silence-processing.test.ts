import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ analyze: vi.fn(), release: vi.fn(), ownedRelease: vi.fn(), pinnedRelease: vi.fn(), plan: vi.fn() }));
vi.mock("./shorts-silence-analysis", () => ({ analyzeShortSilences: mocks.analyze }));
vi.mock("./editor-rendering-release", () => ({ resolveEditorRelease: mocks.release,
  editorReleaseSupportsRenderSpecV4: () => true, subtitleEditingReleaseEnabled: () => true }));
vi.mock("./language-test", () => ({ resolveOwnedProjectEditorRelease: mocks.ownedRelease, languageTestEditorRelease: mocks.pinnedRelease }));
vi.mock("./editor-document-contract", () => ({ parseInitialEditorRenderSpec: () => ({ version: 4 }) }));
vi.mock("./shorts-silence-contract", async original => ({ ...await original<Record<string, unknown>>(), silenceEditDocument: mocks.plan }));
import { processAdminShortSilence } from "./shorts-silence-processing";
import type { Sql } from "postgres";

const user = "11111111-1111-4111-8111-111111111111", short = "22222222-2222-4222-8222-222222222222";
const release = { releaseId: "33333333-3333-4333-8333-333333333333", channel: "stable", uiVersion: 3, documentVersion: 3 };
const requestId = "44444444-4444-4444-8444-444444444444";
function database({ active = 0, stopDuringAnalysis = false, sourceChanged = false } = {}) {
  const queries: { text: string; values: unknown[] }[] = [];
  let claimed = false;
  const sql = Object.assign(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join("?"); queries.push({ text: q, values });
    if (q.includes("select enabled from shorts_mvp.runtime_feature_flags")) return [{ enabled: !(claimed && stopDuringAnalysis) }];
    if (q.includes("count(*)::int as count")) return [{ count: active }];
    if (q.includes("select s.*,j.channel_thumbnail_url")) {
      if (claimed) return [];
      claimed = true;
      return [{ id: short, jobId: short, userId: user, sourceKey: "edit-sources/owned.mp4", startSeconds: 0, endSeconds: 12,
        timelineStart: 0, timelineEnd: 12, renderVersion: 1, initialRenderSpec: {}, captionRenderSpec: null }];
    }
    if (q.includes("returning request_id")) return [{ requestId }];
    if (q.includes("select short_id from")) return [{ shortId: short }];
    if (q.includes("select s.id from")) return sourceChanged ? [] : [{ id: short }];
    return [];
  }, { json: (value: unknown) => value, begin: async (fn: (tx: unknown) => unknown) => fn(sql) });
  return { sql: sql as unknown as Sql, queries };
}
beforeEach(() => {
  vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED", "true"); vi.stubEnv("RANKING_VERCEL_SNAPSHOT_ID", "snapshot");
  mocks.pinnedRelease.mockReset().mockResolvedValue(null);
  mocks.analyze.mockReset().mockResolvedValue([[3,5]]);
  mocks.release.mockReset().mockResolvedValue(release); mocks.ownedRelease.mockReset().mockResolvedValue(release);
  mocks.plan.mockReset().mockReturnValue({ document: { version: 3, channel: {} }, cutCount: 1, removedSeconds: 1.8 });
});
afterEach(() => vi.unstubAllEnvs());
const writesOutput = (q: string) => /insert into shorts_mvp.editor_render_(requests|outbox)|update shorts_mvp.generated_shorts/.test(q);
describe("bounded administrator post-processing", () => {
  it("retains the owned language release instead of switching to the ordinary renderer", async () => {
    const pinned = { ...release, channel: "canary", releaseId: "55555555-5555-4555-8555-555555555555" };
    mocks.pinnedRelease.mockResolvedValue(pinned);
    mocks.ownedRelease.mockResolvedValue(pinned);
    const { sql } = database();
    expect(await processAdminShortSilence(sql, short, user)).toMatchObject({ status: "rendering" });
    expect(mocks.pinnedRelease).toHaveBeenCalledWith(sql, user, short);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.ownedRelease).toHaveBeenCalledWith(expect.anything(), user,
      { releaseId: pinned.releaseId, channel: "canary", uiVersion: 3, documentVersion: 3 }, short);
  });
  it("preserves the output when a pinned language release is unavailable", async () => {
    mocks.pinnedRelease.mockRejectedValue(new Error("unavailable"));
    const { sql, queries } = database();
    await expect(processAdminShortSilence(sql, short, user)).rejects.toMatchObject({ status: 503 });
    expect(mocks.release).not.toHaveBeenCalled();
    expect(queries.some(q => writesOutput(q.text))).toBe(false);
  });
  it("does not touch the database when the deployment gate is off", async () => {
    vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED", "false"); const { sql, queries } = database();
    expect(await processAdminShortSilence(sql)).toEqual({ status: "disabled" }); expect(queries).toEqual([]);
  });
  it("leaves the existing renderer alone while another analysis holds the global lease", async () => {
    const { sql, queries } = database({ active: 1 });
    expect(await processAdminShortSilence(sql)).toEqual({ status: "idle" });
    expect(mocks.analyze).not.toHaveBeenCalled(); expect(queries.some(q=>writesOutput(q.text))).toBe(false);
  });
  it("preserves the original output when audio analysis fails", async () => {
    mocks.analyze.mockRejectedValue(new Error("source unavailable")); const { sql, queries } = database();
    await expect(processAdminShortSilence(sql, short, user)).rejects.toMatchObject({ status: 503 });
    expect(queries.some(q=>writesOutput(q.text))).toBe(false);
    expect(queries.some(q=>q.text.includes("set state='failed'"))).toBe(true);
  });
  it.each([{ stopDuringAnalysis: true }, { sourceChanged: true }])("never queues a stale or stopped operation %j", async options => {
    const { sql, queries } = database(options);
    await expect(processAdminShortSilence(sql, short, user)).rejects.toMatchObject({ status: 503 });
    expect(queries.some(q=>writesOutput(q.text))).toBe(false);
  });
  it("queues exactly one existing-editor request and outbox record", async () => {
    const { sql, queries } = database();
    expect(await processAdminShortSilence(sql, short, user)).toMatchObject({ status: "rendering", requestId, shortId: short });
    expect(await processAdminShortSilence(sql, short, user)).toEqual({ status: "idle" });
    expect(queries.filter(q=>q.text.includes("insert into shorts_mvp.editor_render_requests"))).toHaveLength(1);
    expect(queries.filter(q=>q.text.includes("insert into shorts_mvp.editor_render_outbox"))).toHaveLength(1);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(queries.some(q=>q.text.includes("s.user_id=?") && q.values.includes(user))).toBe(true);
  });
});
