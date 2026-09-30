import { describe, expect, it, vi } from "vitest";
import type { TransactionSql } from "postgres";
import { lockSnsTemplateAdmission, snsTemplateRelease, SNS_TEMPLATE_RELEASE_ID } from "./sns-template-release";
import { COMMUNITY_TEMPLATE_RELEASE_ID } from "./community-template-contract";
import { languageTestEditorRelease } from "./language-test";

const sha = "a".repeat(40), digest = `sha256:${"b".repeat(64)}`, font = "c".repeat(64);
const lanes = Object.fromEntries(["legacy_project", "source_range", "elevenlabs_transcription", "subtitle_templates", "unified_template_subtitles"].map(key => [key, {
  current: { releaseId: `sns-template-${key.replaceAll("_", "-")}-${sha.slice(0, 12)}`,
    workerSourceGitSha: sha, imageUri: `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/worker@${digest}`,
    jobDefinitionArn: `arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-sns-${key.replaceAll("_", "-")}:1`,
    jobQueueArn: "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-production",
    renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: font },
  previous: null, schedulingMode: "fifo",
}]));
const ready = { id: SNS_TEMPLATE_RELEASE_ID, registryJson: JSON.stringify({ version: 1, environment: "production", lanes }),
  verifiedAt: new Date(), stagingVerifiedAt: new Date(), gitSha: sha, workerImageDigest: digest,
  fontManifestSha256: font, status: "canary_ready", uiVersion: 3, documentVersion: 3, renderSpecVersion: 4, captionRenderSpecVersion: 4 };

describe("SNS public beta release isolation", () => {
  it("rejects an unknown account before looking up the release", async () => {
    const db = vi.fn(async () => []);
    await expect(lockSnsTemplateAdmission(db as unknown as TransactionSql, null))
      .rejects.toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
    expect(db).toHaveBeenCalledTimes(1);
  });
  it("pins an ordinary account to a verified SNS release without reading or writing the public gate", async () => {
    const db = vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      expect(sql).not.toContain("language_test_settings");
      expect(sql).not.toMatch(/update |insert /i);
      return sql.includes("app_users") ? [{ id: "user" }] : [ready];
    });
    expect(await lockSnsTemplateAdmission(db as unknown as TransactionSql, "admin"))
      .toMatchObject({ releaseId: SNS_TEMPLATE_RELEASE_ID });
    expect(db).toHaveBeenCalledTimes(2);
  });
  it("pins ordinary community creation to its own verified release", async () => {
    const communityReady = { ...ready, id: COMMUNITY_TEMPLATE_RELEASE_ID,
      registryJson: ready.registryJson.replaceAll('"sns-template-', '"sns-template-community-') };
    const db = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join("?");
      expect(sql).not.toContain("language_test_settings");
      if (sql.includes("app_users")) return [{ id: "ordinary", isAdmin: false }];
      expect(values[0]).toBe(COMMUNITY_TEMPLATE_RELEASE_ID);
      return [communityReady];
    });
    expect(await lockSnsTemplateAdmission(db as unknown as TransactionSql, "ordinary", true))
      .toMatchObject({ releaseId: COMMUNITY_TEMPLATE_RELEASE_ID });
  });
  it.each([{ verifiedAt: null }, { stagingVerifiedAt: null }, { workerImageDigest: `sha256:${"d".repeat(64)}` },
    { gitSha: "e".repeat(40) }, { fontManifestSha256: "f".repeat(64) }, { status: "built" },
    { registryJson: "{}" }])("fails closed for mismatched release %j", async change => {
    const db = vi.fn(async () => [{ ...ready, ...change }]);
    await expect(snsTemplateRelease(db as unknown as TransactionSql))
      .rejects.toMatchObject({ status: 503, code: "SNS_TEMPLATE_UNAVAILABLE" });
  });
  it("fails closed before the SNS editor compatibility proof is registered", async () => {
    const db = vi.fn(async () => [{ languageTestReleaseId: SNS_TEMPLATE_RELEASE_ID, snsTemplateVersion: "1" }]);
    await expect(languageTestEditorRelease(db as unknown as TransactionSql, "owner", "short"))
      .rejects.toMatchObject({ status: 409, code: "SNS_EDITOR_UNAVAILABLE" });
    expect(db).toHaveBeenCalledTimes(2);
  });
});
