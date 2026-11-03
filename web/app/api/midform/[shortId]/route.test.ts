import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ access: vi.fn(), source: vi.fn(), playback: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/midform-access", () => ({ midformAccess: mocks.access }));
vi.mock("@/lib/aws", () => ({ getMidformEditSourceUrl: mocks.source, getShortPlaybackAccess: mocks.playback }));
vi.mock("@/lib/midform-release", () => ({ midformRelease: mocks.release }));
import { GET, PATCH, POST } from "./route";
import { midformRanges } from "@/lib/midform-local";
const shortId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const rows = [{ id: "0", start: 0, end: 10, speaker: "speaker_0", text: "안녕하세요", keep: true }];
const draft = { rows, framing: { speaker_0: "left" }, names: { speaker_0: "진행자" }, removeSilence: true };
const context = () => ({ params: Promise.resolve({ shortId }) });
function setup(options: { missing?: boolean; revision?: number; busy?: boolean; previousHash?: string } = {}) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join("?").replace(/\s+/g, " "); calls.push({ sql, values });
    if (sql.includes("from shorts_mvp.generated_shorts")) return options.missing ? [] : [{
      midformReleaseId: requestId, status: options.busy ? "rerendering" : "ready", renderVersion: 1, cleanClipS3Key: "edit-sources/reel.mp4",
      outputS3Key: "outputs/v1.mp4", expiresAt: new Date(Date.now() + 86400000),
      midformDocumentJson: sql.includes("s.midform_document::text as midform_document_json")
        ? JSON.stringify({ ...draft, revision: options.revision ?? 0, draft, renderedDraft: draft, duration: 10, sourceDuration: 60, silences: [[2, 4]], outputSrt: "captions" })
        : undefined,
    }];
    if (sql.includes("select snapshot_hash")) return options.previousHash ? [{ snapshotHash: options.previousHash }] : [];
    return [];
  }), { json: (value: unknown) => value, begin: async <T,>(fn: (tx: unknown) => Promise<T>) => fn(db) });
  mocks.access.mockResolvedValue({ db, session: { userId } });
  return calls;
}
function request(method: string, changes = {}) {
  return new Request(`https://www.easycut.co.kr/api/midform/${shortId}`, { method,
    headers: { "Content-Type": "application/json", Origin: "https://www.easycut.co.kr" },
    body: JSON.stringify({ draft, revision: 0, renderVersion: 1, ...changes }) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.source.mockResolvedValue("https://media.example/reel"); mocks.playback.mockResolvedValue({ url: "https://media.example/output" }); });
describe("authenticated midform project routes", () => {
  it("scopes reads to the owner and does not sign media for missing/foreign projects", async () => {
    const calls = setup({ missing: true });
    expect((await GET(new Request("https://www.easycut.co.kr/"), context())).status).toBe(404);
    expect(calls[0].sql).toContain("s.user_id=?"); expect(calls[0].values).toContain(userId);
    expect(calls[0].sql).toContain("s.expires_at > now()");
    expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.playback).not.toHaveBeenCalled();
  });
  it("preserves exact speaker IDs in names, framing, and rendered drafts when reopening", async () => {
    setup();
    const response = await GET(new Request("https://www.easycut.co.kr/"), context());
    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document.names).toEqual({ speaker_0: "진행자" });
    expect(document.framing).toEqual({ speaker_0: "left" });
    expect(document.exportDraft.framing).toEqual(document.framing);
    expect(document.rows[0].speaker).toBe("speaker_0");
  });
  it("reopens with the measured aggressive silences used by the editor's preview and duration", async () => {
    setup();
    const response = await GET(new Request("https://www.easycut.co.kr/"), context());
    const document = await response.json();
    const ranges = midformRanges(document.rows, document.silenceProfiles[document.silencePreset], document.removeSilence);
    expect(ranges.map(({ start, end }) => [start, end])).toEqual([[0, 2], [4, 10]]);
    expect(ranges.reduce((seconds, range) => seconds + range.end - range.start, 0)).toBe(8);
    expect(document.sourceDuration).toBe(60);
    expect(document.duration).toBe(10);
  });
  it("saves captions under a row lock without enqueuing a render", async () => {
    const calls = setup();
    const response = await PATCH(request("PATCH"), context());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "saved", revision: 1 });
    expect(calls[0].sql).toContain("for update of s"); expect(calls[0].values).toContain(userId);
    expect(calls.some(c => c.sql.includes("update shorts_mvp.generated_shorts"))).toBe(true);
    expect(calls.some(c => c.sql.includes("editor_render_outbox"))).toBe(false);
  });
  it.each([{ revision: 1 }, { busy: true }])("rejects stale or in-flight edits before mutation: %j", async options => {
    const calls = setup(options);
    expect((await PATCH(request("PATCH"), context())).status).toBe(409);
    expect(calls.some(c => c.sql.includes("update shorts_mvp."))).toBe(false);
  });
  it("rejects media-clock tampering before mutation", async () => {
    const calls = setup();
    expect((await PATCH(request("PATCH", { draft: { ...draft, rows: [{ ...rows[0], end: 20 }] } }), context())).status).toBe(400);
    expect(calls.some(c => c.sql.includes("update shorts_mvp."))).toBe(false);
  });
  it("rejects request-id reuse with different content without adding an outbox item", async () => {
    const calls = setup({ previousHash: "different" });
    expect((await POST(request("POST", { requestId }), context())).status).toBe(409);
    expect(calls.some(c => c.sql.includes("insert into"))).toBe(false);
  });
  it("queues AI generation on the registered worker and rejects generation in save-only requests", async () => {
    process.env.MIDFORM_RELEASE_ID = requestId;
    mocks.release.mockResolvedValue({ channel: "canary", releaseId: requestId });
    const calls = setup();
    expect((await POST(request("POST", { requestId, generateCaptions: true }), context())).status).toBe(202);
    const update = calls.find(c => c.sql.includes("pending_edit_snapshot="));
    expect(update?.values).toContainEqual(expect.objectContaining({ generateCaptions: true, draft }));
    expect(calls.some(c => c.sql.includes("insert into shorts_mvp.editor_render_outbox"))).toBe(true);
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), userId, requestId);
    const saveCalls = setup();
    expect((await PATCH(request("PATCH", { generateCaptions: true }), context())).status).toBe(400);
    expect(saveCalls).toHaveLength(0);
    delete process.env.MIDFORM_RELEASE_ID;
  });
  it("returns only the rendered SRT as a private attachment", async () => {
    setup(); const response = await GET(new Request("https://www.easycut.co.kr/?format=srt"), context());
    expect(await response.text()).toBe("captions"); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment"); expect(mocks.source).not.toHaveBeenCalled();
  });
});
