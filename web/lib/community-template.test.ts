import { describe, expect, it, vi } from "vitest";
import type { TransactionSql } from "postgres";
import { lockSnsTemplateAdmission } from "./sns-template-release";
import { communityVideoFrames } from "./community-template-contract";
import { snsEditedSnapshotSchema } from "./sns-editor-contract";

describe("community admin isolation", () => {
  it("rejects public users before querying any worker release", async () => {
    const db = vi.fn(async () => [{ id: "user", isAdmin: false }]);
    await expect(lockSnsTemplateAdmission(db as unknown as TransactionSql, "user", true))
      .rejects.toMatchObject({ status: 403, code: "COMMUNITY_TEMPLATE_ADMIN_ONLY" });
    expect(db).toHaveBeenCalledTimes(1);
  });
  it("keeps a single copy profile and fixed video top at all five ratios", () => {
    const snapshot = { presetVersion: 4, snsTemplateVersion: 1, communityTemplateVersion: 1,
      snsLanguage: "ko", brandColor: "#303e78", snsContent: { boardName: "퇴근러 모임", title: "퇴근 1분 전",
        body: ["퇴근 얘기에 살아남"], hashtags: [], source: "edited" } };
    for (const [ratio, [, y, w, h]] of Object.entries(communityVideoFrames)) {
      const [n, d] = ratio.split(":").map(Number);
      expect(w * d).toBe(h * n); expect(y).toBe(690);
      const r = ratio as keyof typeof communityVideoFrames;
      expect(snsEditedSnapshotSchema(r, "ko", true).safeParse(snapshot).success).toBe(true);
      expect(snsEditedSnapshotSchema(r, "ko").safeParse(snapshot).success).toBe(false);
      for (const boardName of ["너무너무긴게시판이름", "집사들🐱", "  "]) {
        expect(snsEditedSnapshotSchema(r, "ko", true).safeParse({ ...snapshot,
          snsContent: { ...snapshot.snsContent, boardName } }).success).toBe(false);
      }
      expect(snsEditedSnapshotSchema(r, "ko", true).safeParse({ ...snapshot,
        snsContent: { ...snapshot.snsContent, boardName: undefined } }).success).toBe(true);
      expect(snsEditedSnapshotSchema(r, "ko", true).safeParse({ ...snapshot, communityTemplateVersion: undefined }).success).toBe(false);
    }
  });
});
