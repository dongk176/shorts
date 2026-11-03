import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Sql } from "postgres";
import { midformRelease, midformUploadRelease } from "./midform-release";

const id = "c569fca5-e8f9-4925-81fe-f9bdf8677454";
const source = "6d58195dedd6a095707eaf2593d13dc0608ea633";
const digest = "sha256:7a2c3922f3449fe9c7ee119fb6e9d2fdf1118b9745e94fe27e127002c31b1843";
const font = "b9f530954066e89e95fcd2cfb77db558e68530329d3d1d9db17e4e73c859d486";
function release() {
  const lanes = Object.fromEntries([
    "legacy_project", "source_range", "elevenlabs_transcription", "subtitle_templates", "unified_template_subtitles",
  ].map(key => [key, { current: {
    releaseId: `midform-upload-${key.replaceAll("_", "-")}-${source.slice(0, 12)}`,
    workerSourceGitSha: source,
    imageUri: `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@${digest}`,
    jobDefinitionArn: `arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-midform-upload-${key.replaceAll("_", "-")}-${source.slice(0, 12)}:1`,
    jobQueueArn: "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-production",
    renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: font,
  }, previous: null, schedulingMode: "fifo" }]));
  return { id, registryJson: JSON.stringify({ version: 1, environment: "production", lanes }),
    verifiedAt: new Date(), stagingVerifiedAt: new Date(), status: "canary_ready",
    uiVersion: 4, documentVersion: 3, renderSpecVersion: 4, captionRenderSpecVersion: 4,
    gitSha: source, workerImageDigest: digest, fontManifestSha256: font };
}
const db = vi.fn();
const sql = db as unknown as Sql;
beforeEach(() => {
  db.mockReset();
  vi.stubEnv("MIDFORM_ENABLED", "true");
  vi.stubEnv("EASYCUT_ENVIRONMENT", "production");
  vi.stubEnv("MIDFORM_RELEASE_ID", id);
  vi.stubEnv("MIDFORM_UPLOAD_RELEASE_ID", id);
});
function respond(row = release()) {
  db.mockResolvedValueOnce([{ id: "admin", isAdmin: true }]).mockResolvedValueOnce([row]);
}
describe("midform admission against the attested UI4/document3 worker", () => {
  it("admits the actual verified runtime for both link and upload", async () => {
    respond();
    await expect(midformRelease(sql, "admin")).resolves.toMatchObject({ releaseId: id });
    respond();
    await expect(midformUploadRelease(sql, "admin")).resolves.toMatchObject({ releaseId: id });
  });
  it.each([3, 5])("rejects incompatible UI version %s", async uiVersion => {
    respond({ ...release(), uiVersion });
    await expect(midformRelease(sql, "admin")).rejects.toMatchObject({ status: 503 });
  });
  it("rejects ordinary users before looking up a release", async () => {
    db.mockResolvedValueOnce([{ id: "member", isAdmin: false }]);
    await expect(midformRelease(sql, "member")).rejects.toMatchObject({ status: 404 });
    expect(db).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: "registered" }, { documentVersion: 4 },
    { workerImageDigest: `sha256:${"0".repeat(64)}` }, { fontManifestSha256: "0".repeat(64) },
  ])("retains attestation and exact identity checks: %j", async change => {
    respond({ ...release(), ...change });
    await expect(midformRelease(sql, "admin")).rejects.toMatchObject({ status: 503 });
  });
});
