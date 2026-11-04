vi.mock("server-only", () => ({}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn(), billing: vi.fn(), usage: vi.fn(), wake: vi.fn() }));
vi.mock("@/lib/custom-template-design", () => ({ assertCustomTemplateDesignRenderRelease: async () => undefined }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/billing", () => ({ getBillingSummary: mocks.billing }));
vi.mock("@/lib/usage", () => ({ getUsageSnapshot: mocks.usage, billableSourceSeconds: (n: number) => n }));
vi.mock("@/lib/aws", () => ({ wakeOutboxDispatcher: mocks.wake }));
vi.mock("@/lib/enterprise-access", () => ({ assertEnterpriseSessionServiceAccess: async () => ({ accountType: "personal" }) }));
vi.mock("@/lib/job-backend", () => ({ getInitialJobBackend: () => "aws_batch" }));
vi.mock("@/lib/transcription-release", () => ({ lockElevenLabsTranscriptionAccess: async () => ({ enabled: false, policy: null }) }));
vi.mock("@/lib/shorts-thank-you-event", () => ({ issueShortsThankYouEventGrantIfEligible: async () => ({ granted: false }) }));
vi.mock("@/lib/template-execution-snapshot", () => ({ resolveTemplateExecutionSnapshot: async () => ({
  resolvedTemplateId: "dark-minimal", resolvedVideoAspectRatio: "1:1", templateSnapshot: null, subtitleTemplateSnapshot: null,
}) }));
vi.mock("@/lib/initial-render-release", () => ({ resolveInitialRenderRelease: async () => null }));
vi.mock("@/lib/job-dispatch", () => ({ projectDispatchTargetForFeatures: () => ({ targetKey: "legacy_project", releaseId: "ordinary", jobDefinitionArn: "ordinary", jobQueueArn: "ordinary" }) }));
import { POST } from "./route";

const user = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";
const other = "8f856acc-5b6a-4f62-9971-d7feb1f2a624";
const releaseId = "7f856acc-5b6a-4f62-9971-d7feb1f2a624";
const sha = "a".repeat(40), image = `sha256:${"b".repeat(64)}`, font = "c".repeat(64);
const registry = { version: 1, environment: "production", lanes: Object.fromEntries([
  "legacy_project", "source_range", "elevenlabs_transcription", "subtitle_templates", "unified_template_subtitles",
].map((key) => [key, { previous: null, schedulingMode: "fifo", current: {
  releaseId: `language-${key}`, workerSourceGitSha: sha,
  imageUri: `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-worker@${image}`,
  jobDefinitionArn: `arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-${key.replaceAll("_", "-")}:1`,
  jobQueueArn: "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-production",
  renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: font,
} }])) };
let publicPercent = 100;
let admin = false;
let publicSilence = false;
const jobs: { id: string; user: string; request: string; projectNumber: number; output: unknown; release: unknown; snapshot: unknown }[] = [];
const reservations: unknown[][] = [];
const locks = new Map<string, Promise<void>>();
const request = (change: Record<string, unknown> = {}) => new Request("https://www.easycut.co.kr/api/jobs", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.easycut.co.kr" }, body: JSON.stringify({
    analysisId: releaseId, requestId: crypto.randomUUID(), templateId: "dark-minimal", rightsConfirmed: true,
    outputLanguage: "ja", languageTest: true, sourceLanguage: "auto", ...change,
  }),
});

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks(); publicPercent = 100; admin = false; publicSilence = false; jobs.length = 0; reservations.length = 0; locks.clear();
  mocks.session.mockResolvedValue({ userId: user, id: user, isAdmin: false });
  mocks.billing.mockResolvedValue({ canCreateJobs: true, maxActiveJobs: 1, retentionDays: 30 });
  mocks.usage.mockResolvedValue({ enforcementEnabled: true, remainingSeconds: 3600 });
  const makeSql = (transaction = false) => {
    let owner = "";
    let release: (() => void) | undefined;
    const sql = Object.assign(vi.fn(async (strings: TemplateStringsArray, ...v: unknown[]) => {
      const q = strings.join("?");
      if (transaction && q.includes("pg_advisory_xact_lock(hashtextextended(") && v.length > 0) {
        owner = v[0] as string;
        const previous = locks.get(owner) ?? Promise.resolve();
        locks.set(owner, new Promise<void>((resolve) => { release = resolve; }));
        await previous; return [];
      }
      if (q.includes("where request_id=")) return jobs.filter((j) => j.request === v[0] && j.user === v[1]);
      if (q.includes("from shorts_mvp.youtube_analyses")) return [{
        youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk", youtubeVideoId: "abcdefghijk", videoTitle: "Fixture",
        channelName: "Fixture", durationSeconds: 240, creationAllowed: true, sourceRangeSelectionEnabled: false,
      }];
      if (q.includes("from shorts_mvp.app_users")) return [{ id: v[0], isAdmin: admin, enabled: true, publicEnabled: publicSilence }];
      if (q.includes("left join shorts_mvp.language_test_releases")) return [{
        enabled: true, publicRolloutPercent: publicPercent, releaseId, verifiedAt: new Date(), stagingVerifiedAt: new Date(),
        registryJson: JSON.stringify(registry), gitSha: sha, workerImageDigest: image, fontManifestSha256: font,
        status: "canary_ready", uiVersion: 3, documentVersion: 3, renderSpecVersion: 4, captionRenderSpecVersion: 4,
      }];
      if (q.includes("with scoped_jobs")) return [{ active: jobs.filter((j) => j.user === owner).length, restrictedContentCooldownMinutes: 0 }];
      if (q.includes("insert into shorts_mvp.video_jobs")) {
        const job = { id: v[0] as string, user: v[2] as string, request: v[3] as string, projectNumber: jobs.length + 1, output: v[19], release: v.at(-3), snapshot: v[15] };
        jobs.push(job); return [{ projectNumber: job.projectNumber }];
      }
      if (q.includes("insert into shorts_mvp.usage_reservations")) { reservations.push(v); return [{ id: releaseId }]; }
      return [];
    }), { json: (v: unknown) => v, finish: () => release?.() });
    return sql;
  };
  const db = Object.assign(makeSql(), { begin: async (fn: (tx: unknown) => unknown) => {
    const tx = makeSql(true);
    try { return await fn(tx); } finally { tx.finish(); }
  } });
  mocks.db.mockReturnValue(db);
});

describe("language job admission through the actual POST handler", () => {
  it("blocks ordinary-user silence requests when public admission is off", async () => {
    vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED", "true"); vi.stubEnv("RANKING_VERCEL_SNAPSHOT_ID", "snapshot");
    expect((await POST(request({ languageTest: false, sourceLanguage: undefined, outputLanguage: "ko",
      silenceRemoval: { version: 1, preset: "aggressive" } }))).status).toBe(404);
    expect(jobs).toHaveLength(0); expect(reservations).toHaveLength(0);
  });
  it.each(["administrator", "ordinary member"])("preserves normal admission and charges once for an opted-in %s", async role => {
    admin = role === "administrator"; publicSilence = role === "ordinary member"; vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED", "true"); vi.stubEnv("RANKING_VERCEL_SNAPSHOT_ID", "snapshot");
    const requestId = crypto.randomUUID();
    const body = { requestId, languageTest: false, sourceLanguage: undefined, outputLanguage: "ko", silenceRemoval: { version: 1, preset: "aggressive" } };
    expect((await POST(request(body))).status).toBe(202);
    expect((await POST(request(body))).status).toBe(200);
    expect(jobs).toHaveLength(1); expect(reservations).toHaveLength(1);
    expect(jobs[0].snapshot).toEqual({ shortsSilenceRemoval: { version: 1, preset: "aggressive" } });
  });
  it("accepts public ON and preserves the requested output and pinned worker", async () => {
    expect((await POST(request())).status).toBe(202);
    expect(jobs[0]).toMatchObject({ output: "ja", release: releaseId });
    expect(reservations).toHaveLength(1);
  });
  it.each([
    { languageTest: true },
    { languageTest: false, sourceLanguage: undefined },
    { languageTest: false, sourceLanguage: "auto", outputLanguage: "ko" },
  ])("rejects public OFF language intent, including omitted feature markers: %s", async (input) => {
    publicPercent = 0;
    const response = await POST(request(input));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "LANGUAGE_PUBLIC_DISABLED" });
    expect(jobs).toEqual([]); expect(reservations).toEqual([]);
  });
  it("keeps admins and old Korean request bodies working while public is OFF", async () => {
    publicPercent = 0; admin = true;
    expect((await POST(request())).status).toBe(202);
    jobs.length = 0; admin = false;
    expect((await POST(request({ languageTest: undefined, sourceLanguage: undefined, outputLanguage: undefined }))).status).toBe(202);
    expect(jobs[0]).toMatchObject({ output: "ko", release: null });
  });
  it("deduplicates concurrent requests and charges only once, including retry after OFF", async () => {
    const requestId = crypto.randomUUID();
    const responses = await Promise.all([POST(request({ requestId })), POST(request({ requestId }))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 202]);
    expect(jobs).toHaveLength(1); expect(reservations).toHaveLength(1);
    publicPercent = 0;
    expect((await POST(request({ requestId }))).status).toBe(200);
    expect(reservations).toHaveLength(1);
  });
  it("enforces per-account concurrency while allowing another account", async () => {
    const responses = await Promise.all([POST(request()), POST(request())]);
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
    mocks.session.mockResolvedValue({ userId: other, id: other });
    expect((await POST(request())).status).toBe(202);
    expect(jobs).toHaveLength(2); expect(reservations).toHaveLength(2);
  });
  it("keeps plan and usage restrictions", async () => {
    mocks.billing.mockResolvedValue({ canCreateJobs: false, maxActiveJobs: 1, retentionDays: 30 });
    expect((await POST(request())).status).toBe(402);
    mocks.billing.mockResolvedValue({ canCreateJobs: true, maxActiveJobs: 1, retentionDays: 30 });
    mocks.usage.mockResolvedValue({ enforcementEnabled: true, remainingSeconds: 100 });
    expect((await POST(request())).status).toBe(402);
    expect(reservations).toEqual([]);
  });
});
