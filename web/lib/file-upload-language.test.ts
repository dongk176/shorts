import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { verifiedUploadLanguageEvidence, fileUploadLanguageEnabled } from "./file-upload-language";
import { fileUploadIntentHash, type FileUploadIntentIdentity } from "./file-upload-control";
const source = "a".repeat(40), digest = `sha256:${"b".repeat(64)}`, font = "c".repeat(64);
const env = { FILE_UPLOAD_MULTILINGUAL_VERIFIED_RELEASE_ID: "upload-release",
  FILE_UPLOAD_WORKER_SOURCE_GIT_SHA: source, FILE_UPLOAD_WORKER_IMAGE_DIGEST: digest,
  FILE_UPLOAD_WORKER_FONT_MANIFEST_SHA256: font };
const evidence = () => ({ releaseId: "upload-release", sourceGitSha: source, workerImageDigest: digest,
  fontManifestSha256: font, multilingualUpload: { version: 1, phase: "verified", sourceGitSha: source,
    workerImageDigest: digest, cases: ["ko", "en", "ja"].map(language => ({ language, generated: true,
      silenceRemoved: true, restored: true, edited: true, rendered: true })) } });
describe("upload languages follow exact receiver verification", () => {
  it("requires all language roundtrips and the admitted release", () => {
    expect(verifiedUploadLanguageEvidence(evidence(), env, "upload-release")).toBe(true);
    expect(verifiedUploadLanguageEvidence(evidence(), env, "link-release")).toBe(false);
    for (const key of Object.keys(env)) expect(verifiedUploadLanguageEvidence(evidence(), { ...env, [key]: "different" })).toBe(false);
    for (const language of ["ko", "en", "ja"]) {
      const proof = evidence(); proof.multilingualUpload.cases = proof.multilingualUpload.cases.filter(c => c.language !== language);
      expect(verifiedUploadLanguageEvidence(proof, env)).toBe(false);
    }
    const proof = evidence(); proof.multilingualUpload.cases[2].restored = false;
    expect(verifiedUploadLanguageEvidence(proof, env)).toBe(false);
    proof.multilingualUpload.phase = "admin_test";
    expect(verifiedUploadLanguageEvidence(proof, env)).toBe(false);
  });
  it("does not query or expose languages on existing deployments", async () => {
    vi.stubEnv("FILE_UPLOAD_MULTILINGUAL_VERIFIED_RELEASE_ID", "");
    const db = vi.fn();
    try { expect(await fileUploadLanguageEnabled(db as never)).toBe(false); expect(db).not.toHaveBeenCalled(); }
    finally { vi.unstubAllEnvs(); }
  });
  it("preserves legacy intent hashes but distinguishes source language requests", () => {
    const base = { originalFilename: "test.mp4", outputLanguage: "en", rightsConfirmed: true } as FileUploadIntentIdentity;
    expect(fileUploadIntentHash(base)).toBe(fileUploadIntentHash({ ...base, sourceLanguage: undefined }));
    expect(fileUploadIntentHash({ ...base, sourceLanguage: "en" })).not.toBe(fileUploadIntentHash({ ...base, sourceLanguage: "ja" }));
  });
});
