import { describe, expect, it, vi } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { languageFeatureAllowed, languageTestCommentProfile, languageTestEditorRelease, languageTestStatus, languageTestTarget, lockLanguageTestAdmission, resolveOwnedProjectEditorRelease } from "./language-test";

const id = "f083a5ef-400e-43f5-af27-ac9d417ca6a2";
const sha = "a".repeat(40), digest = `sha256:${"b".repeat(64)}`, font = "c".repeat(64);
const registry = { version: 1, environment: "production", lanes: Object.fromEntries([
  "legacy_project", "source_range", "elevenlabs_transcription", "subtitle_templates", "unified_template_subtitles",
].map((key) => [key, { previous: null, schedulingMode: "fifo", current: {
  releaseId: `language-${key}`, workerSourceGitSha: sha,
  imageUri: `181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-worker@${digest}`,
  jobDefinitionArn: `arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-${key.replaceAll("_", "-")}:1`,
  jobQueueArn: "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-production",
  renderSpecVersion: 4, captionRenderSpecVersion: 4, fontManifestSha256: font,
} }])) };
const ready = { enabled: true, publicRolloutPercent: 0, verifiedAt: new Date(), stagingVerifiedAt: new Date(), registryJson: JSON.stringify(registry), releaseId: id,
  gitSha: sha, workerImageDigest: digest, fontManifestSha256: font, status: "canary_ready",
  uiVersion: 3, documentVersion: 3, renderSpecVersion: 4, captionRenderSpecVersion: 4 };
function database(run: (sql: string) => unknown[]) {
  return vi.fn((strings: TemplateStringsArray) => Promise.resolve(run(strings.join("?")))) as unknown as Sql;
}

describe("independent administrator language release", () => {
  it("accepts only exact registered source, image and font identities", async () => {
    for (const change of [{}, { gitSha: "d".repeat(40) }, { workerImageDigest: `sha256:${"e".repeat(64)}` },
      { fontManifestSha256: "f".repeat(64) }, { stagingVerifiedAt: null }, { status: "draft" },
      { registryJson: JSON.stringify({ ...registry, environment: "lab" }) }, { registryJson: "invalid" }]) {
      const state = await languageTestStatus(database(() => [{ ...ready, ...change }]));
      expect(state.ready).toBe(Object.keys(change).length === 0);
      if (state.registry) expect(languageTestTarget({ registry: state.registry }, "legacy_project").workerImageDigest).toBe(digest);
    }
  });
  it("rejects missing accounts before reading settings or reserving usage", async () => {
    const db = database((sql) => { expect(sql).toContain("app_users"); return []; });
    await expect(lockLanguageTestAdmission(db as unknown as TransactionSql, "user"))
      .rejects.toMatchObject({ status: 401 });
    expect(db).toHaveBeenCalledTimes(1);
  });
  it.each(["off", "unavailable"])("stops %s admission before usage writes", async (mode) => {
    const db = database((sql) => {
      expect(sql).not.toMatch(/insert|usage_reservations/);
      if (sql.includes("app_users")) return [{ id: "admin", isAdmin: true }];
      if (sql.includes("left join")) {
        if (mode === "unavailable") throw new Error("unavailable");
        return [{ ...ready, enabled: mode !== "off" }];
      }
      if (sql.includes("video_jobs")) return [{ id: "busy" }];
      return [];
    });
    await expect(lockLanguageTestAdmission(db as unknown as TransactionSql, "admin"))
      .rejects.toMatchObject({ status: 503 });
  });
  it.each([
    [true, 0, true], [true, 100, true], [false, 0, false], [false, 100, true], [false, 50, false],
  ])("uses one permission policy for admin=%s public=%s", async (isAdmin, percent, allowed) => {
    const db = database((sql) => {
      expect(sql).not.toContain("video_jobs");
      if (sql.includes("app_users")) return [{ id: "user", isAdmin }];
      if (sql.includes("left join")) return [{ ...ready, publicRolloutPercent: percent }];
      return [];
    });
    const state = await languageTestStatus(db);
    expect(languageFeatureAllowed(state, isAdmin)).toBe(allowed);
    const submit = lockLanguageTestAdmission(db as unknown as TransactionSql, "user");
    if (allowed) await expect(submit).resolves.toMatchObject({ releaseId: id });
    else await expect(submit).rejects.toMatchObject({ status: 403, code: "LANGUAGE_PUBLIC_DISABLED" });
  });
  it("never reads experiment settings or releases for an ordinary owned short", async () => {
    const db = database((sql) => { expect(sql).not.toContain("language_test_settings"); expect(sql).not.toContain("join shorts_mvp.language_test_releases"); return [{ languageTestReleaseId: null }]; });
    expect(await languageTestEditorRelease(db, "user", "short")).toBeNull();
    expect(db).toHaveBeenCalledTimes(1);
  });
  it("keeps a project's verified release after admission is OFF and rejects another release", async () => {
    const db = database((sql) => {
      expect(sql).not.toContain("language_test_settings");
      return sql.includes("select to_jsonb") ? [{ languageTestReleaseId: id }]
        : [{ id, uiVersion: 3, documentVersion: 3, fontManifestSha256: font }];
    });
    const request = { releaseId: id, channel: "canary" as const, uiVersion: 3, documentVersion: 3 };
    expect(await resolveOwnedProjectEditorRelease(db, "owner", request, "short"))
      .toMatchObject({ releaseId: id, languageTest: true, renderV4Authorized: true });
    await expect(resolveOwnedProjectEditorRelease(db, "owner", { ...request, releaseId: "other" }, "short"))
      .rejects.toMatchObject({ status: 409 });
  });
  it("does not fall back to the public worker if a saved test release is unavailable", async () => {
    const db = database((sql) => sql.includes("select to_jsonb") ? [{ languageTestReleaseId: id }] : []);
    await expect(languageTestEditorRelease(db, "owner", "short")).rejects.toMatchObject({ status: 503 });
  });
});


describe("immutable comment profile", () => {
  const cultureRegistry = structuredClone(registry);
  for (const [key, lane] of Object.entries(cultureRegistry.lanes)) {
    lane.current.releaseId = `language-culture-flash-v1-${key.replaceAll("_", "-")}-${sha.slice(0, 12)}`;
  }
  it("reads no test data for normal projects or Korean comments", async () => {
    const db = database(() => { throw new Error("unexpected test lookup"); });
    expect(await languageTestCommentProfile(db, null, "ja")).toBeUndefined();
    expect(await languageTestCommentProfile(db, id, "ko")).toBeUndefined();
    expect(db).not.toHaveBeenCalled();
  });
  it("preserves old projects and uses the saved new release after admission OFF", async () => {
    for (const [saved, expected] of [[registry, undefined], [cultureRegistry, "culture-flash-v1"]] as const) {
      const db = database((sql) => {
        expect(sql).not.toContain("language_test_settings");
        expect(sql).toContain("r.verified_at is not null");
        return [{ registryJson: JSON.stringify(saved) }];
      });
      expect(await languageTestCommentProfile(db, id, "ja")).toBe(expected);
      expect(db).toHaveBeenCalledWith(expect.anything(), id);
    }
  });
  it("rejects unavailable, unknown or partially registered test releases", async () => {
    const partial = structuredClone(cultureRegistry);
    partial.lanes.source_range.current.releaseId = "old-release";
    for (const row of [undefined, { registryJson: "broken" }, { registryJson: JSON.stringify(partial) }]) {
      await expect(languageTestCommentProfile(database(() => row ? [row] : []), id, "en"))
        .rejects.toMatchObject({ status: 503 });
    }
  });
});
