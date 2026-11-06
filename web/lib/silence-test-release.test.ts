import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { silenceTestEditorRelease } from "./silence-test-release";

const row = { id: "11111111-1111-4111-8111-111111111111", uiVersion: 3, documentVersion: 3,
  gitSha: "source", workerImageDigest: "digest", fontManifestSha256: "font", templateKind: "sns" };
const scope = { version: 1, sourceGitSha: "source", workerImageDigest: "digest", templateKinds: ["sns"] };
const db = (value: unknown) => vi.fn().mockResolvedValue(value ? [value] : []) as unknown as Sql;

describe("isolated silence editor capabilities", () => {
  it("derives a private capability from the exact stored source, image and template scope", async () => {
    const assignment = await silenceTestEditorRelease(db({ ...row, verificationJson: JSON.stringify({ authorizedTestScope: scope }) }), "owner", "short");
    expect(assignment).toMatchObject({ silenceTest: true, unifiedTemplateEditingCapable: true, channel: "canary", renderV4Authorized: true });
  });
  it.each([{ ...scope, workerImageDigest: "wrong" }, { ...scope, sourceGitSha: "wrong" }, { ...scope, templateKinds: ["custom"] }])("does not grant social editing from incompatible scope", async value => {
    const assignment = await silenceTestEditorRelease(db({ ...row, verificationJson: JSON.stringify({ authorizedTestScope: value }) }), "owner", "short");
    expect(assignment.unifiedTemplateEditingCapable).toBe(false);
  });
  it("rejects an absent owner-bound assignment", async () => {
    await expect(silenceTestEditorRelease(db(null), "other", "short")).rejects.toMatchObject({ code: "SILENCE_TEST_UNAVAILABLE" });
  });
});
