import { describe, expect, it, vi } from "vitest";
import { resolveOwnedEditorRenderSuccessor } from "./editor-render-successor";
import type { EditorReleaseAssignment } from "./editor-rendering-release";

const base: EditorReleaseAssignment = {
  channel: "stable", releaseId: "11111111-1111-4111-8111-111111111111",
  uiVersion: 3, documentVersion: 3, subtitleEditingCapable: true,
  subtitleEditingPublicEnabled: true, renderSpecVersion: 4,
  captionRenderSpecVersion: 4, fontManifestSha256: "a".repeat(64), renderV4Authorized: true,
};
const environment = { EDITOR_RENDER_SUCCESSOR_ENABLED: "true", EDITOR_RENDER_SUCCESSOR_SOURCE_SHA: "b".repeat(40) };
const user = "22222222-2222-4222-8222-222222222222";
const short = "33333333-3333-4333-8333-333333333333";
const row = { ...base, releaseId: "44444444-4444-4444-8444-444444444444", releaseChannel: "canary" };

describe("editing-only successor", () => {
  it("requires explicit deployment opt-in and an authorized stable v4 assignment", async () => {
    const db = vi.fn();
    for (const env of [{}, { ...environment, EDITOR_RENDER_SUCCESSOR_SOURCE_SHA: "unknown" }]) {
      expect(await resolveOwnedEditorRenderSuccessor(db as never, user, short, base, env)).toBe(base);
    }
    for (const changed of [{ channel: "legacy" }, { renderV4Authorized: false }, { languageTest: true },
      { silenceTest: true }, { silenceInline: true }, { channel: "canary" }]) {
      const assignment = { ...base, ...changed } as EditorReleaseAssignment;
      expect(await resolveOwnedEditorRenderSuccessor(db as never, user, short, assignment, environment)).toBe(assignment);
    }
    expect(db).not.toHaveBeenCalled();
  });
  it("uses the owner-bound database assignment without granting extra subtitle capabilities", async () => {
    const db = vi.fn().mockResolvedValue([row]);
    expect(await resolveOwnedEditorRenderSuccessor(db as never, user, short, base, environment))
      .toEqual({ ...base, releaseId: row.releaseId, channel: "canary" });
    expect(db.mock.calls[0].slice(1)).toEqual([user, short, base.releaseId, environment.EDITOR_RENDER_SUCCESSOR_SOURCE_SHA]);
  });
  it.each([[], [row, row], [{ ...row, fontManifestSha256: "c".repeat(64) }],
    [{ ...row, uiVersion: 2 }], [{ ...row, documentVersion: 2 }],
    [{ ...row, renderSpecVersion: 3 }], [{ ...row, releaseChannel: "legacy" }]].map(rows => ({ rows })))
  ("preserves the original assignment when evidence is absent or incompatible", async ({ rows }) => {
    const db = vi.fn().mockResolvedValue(rows);
    expect(await resolveOwnedEditorRenderSuccessor(db as never, user, short, base, environment)).toBe(base);
  });
});
