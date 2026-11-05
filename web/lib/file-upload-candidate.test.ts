import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { uploadCandidateConfig, uploadCandidateForUser, uploadSilenceRequestMarker } from "./file-upload-candidate";
import { fileUploadLanguageEnabled } from "./file-upload-language";
const release = "d201e5fe-5b29-4ad8-8817-9d584ac902dd";
const owner = "e86821c9-2eb2-4c04-b748-fd269fc46f20";
function configure() {
  const env = { FILE_UPLOAD_CANDIDATE_RELEASE_ID: release, FILE_UPLOAD_CANDIDATE_ADMIN_ID: owner,
    FILE_UPLOAD_CANDIDATE_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
    FILE_UPLOAD_RECEIVER_URL: `https://receiver.example/admin-upload/${release}`,
    FILE_UPLOAD_CAPACITY_FUNCTION_ARN: "arn:aws:lambda:ap-northeast-2:181651591905:function:shorts-upload-candidate-test" };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return env;
}
afterEach(() => vi.unstubAllEnvs());
it("keeps candidate silence requests out of the public cron and rejects a mismatched processor", () => {
  const request = { version: 1, preset: "aggressive" } as const;
  vi.stubEnv("FILE_UPLOAD_CANDIDATE_RELEASE_ID", "");
  vi.stubEnv("FILE_UPLOAD_CANDIDATE_ADMIN_ID", "");
  vi.stubEnv("FILE_UPLOAD_CANDIDATE_EXPIRES_AT", "");
  expect(uploadSilenceRequestMarker(owner, request)).toEqual({ shortsSilenceRemoval: request });
  configure();
  expect(() => uploadSilenceRequestMarker(owner, request)).toThrow();
  vi.stubEnv("ADMIN_SILENCE_TEST_RELEASE_ID", release);
  const marker = uploadSilenceRequestMarker(owner, request);
  expect(marker).not.toHaveProperty("shortsSilenceRemoval");
  expect(marker).toEqual({ shortsSilenceRemovalCandidate: request, shortsSilenceCandidateId: release });
  expect(() => uploadSilenceRequestMarker("other", request)).toThrow();
});
it("fails closed for public receiver routing or incomplete candidate configuration", () => {
  const env = configure();
  expect(uploadCandidateConfig(env)?.releaseId).toBe(release);
  for (const key of Object.keys(env).filter(k => k !== "FILE_UPLOAD_CANDIDATE_RELEASE_ID")) {
    expect(() => uploadCandidateConfig({ ...env, [key]: "" })).toThrow();
  }
  expect(() => uploadCandidateConfig({ ...env, FILE_UPLOAD_RECEIVER_URL: "https://receiver.example" })).toThrow();
});
it("allows only the exact active administrator and exact admitted candidate release", async () => {
  configure();
  const db = vi.fn().mockResolvedValue([{ isAdmin: true }]);
  expect(await fileUploadLanguageEnabled(db as never, release, owner)).toBe(true);
  expect(await fileUploadLanguageEnabled(db as never, "other", owner)).toBe(false);
  expect(await fileUploadLanguageEnabled(db as never, release, "other")).toBe(false);
  db.mockResolvedValue([{ isAdmin: false }]);
  expect(await fileUploadLanguageEnabled(db as never, release, owner)).toBe(false);
  vi.stubEnv("FILE_UPLOAD_CANDIDATE_EXPIRES_AT", "2000-01-01T00:00:00Z");
  expect(uploadCandidateForUser(owner)).toBeNull();
  expect(await fileUploadLanguageEnabled(db as never, release, owner)).toBe(false);
});
