import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { snsCopyLimits, snsEditedSnapshotSchema, SNS_EDITOR_RELEASE_ID, SNS_GENERATION_RELEASE_IDS } from "./sns-editor-contract";
import { snsEditorRelease } from "./sns-editor-release";

describe("SNS edit contract", () => {
  it.each(["16:9", "5:4", "1:1", "4:5", "9:16"] as const)("keeps %s copy constraints across three languages", ratio => {
    for (const language of ["ko", "en", "ja"] as const) {
      const limits = snsCopyLimits(ratio, language);
      const snapshot = { presetVersion: 4, snsTemplateVersion: 1, snsLanguage: language, brandColor: "#2563EB",
        snsContent: { title: "수정", body: Array(limits.lines).fill("본문"), hashtags: ["#A", "#B", "#C"].slice(0, limits.tags), source: "edited" } };
      const schema = snsEditedSnapshotSchema(ratio, language);
      expect(schema.safeParse(snapshot).success).toBe(true);
      expect(schema.safeParse({ ...snapshot, snsLanguage: "xx" }).success).toBe(false);
      expect(schema.safeParse({ ...snapshot, snsContent: { ...snapshot.snsContent, title: "x".repeat(100) } }).success).toBe(false);
      expect(schema.safeParse({ ...snapshot, snsContent: { ...snapshot.snsContent, body: ["a\nb"] } }).success).toBe(false);
    }
  });
  it("uses a separately verified editor without changing generation or public pointers", async () => {
    const db = vi.fn(async (parts: TemplateStringsArray) => {
      expect(parts.join("?")).not.toMatch(/editor_release_state|language_test_settings|update |insert /i);
      expect(parts.join("?")).toContain("u.is_admin");
      return [{ id: SNS_EDITOR_RELEASE_ID, fontManifestSha256: "a".repeat(64),
        languageTestReleaseId: SNS_GENERATION_RELEASE_IDS[0], details: { generationReleaseIds: SNS_GENERATION_RELEASE_IDS } }];
    });
    expect(await snsEditorRelease(db as unknown as Sql, "admin", "short")).toMatchObject({ releaseId: SNS_EDITOR_RELEASE_ID, channel: "canary" });
  });
  it.each([[], [{ languageTestReleaseId: "ordinary", details: {} }], [{ languageTestReleaseId: SNS_GENERATION_RELEASE_IDS[0], details: {} }]].map(rows => ({ rows })))("requires matching proof and ownership", async ({ rows }) => {
    await expect(snsEditorRelease(vi.fn(async () => rows) as unknown as Sql, "user", "short"))
      .rejects.toMatchObject({ code: "SNS_EDITOR_UNAVAILABLE" });
  });
});
