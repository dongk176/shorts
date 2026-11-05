import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { uploadLanguageEditorRelease } from "./upload-language-editor";

it("uses only the owned upload's verified release identity", async () => {
  const row = { id: "upload-release", fontManifestSha256: "font", proof: { releaseId: "upload-release", fontManifestSha256: "font" } };
  const db = vi.fn().mockResolvedValue([row]);
  expect(await uploadLanguageEditorRelease(db as never, "owner", "short")).toMatchObject({ releaseId: "upload-release", channel: "canary", renderSpecVersion: 4 });
  const [strings, ...values] = db.mock.calls[0];
  expect(strings.join("?")).toContain("j.initial_editor_release_id");
  expect(values).toEqual(["short", "owner", "owner"]);
  for (const rows of [[], [{ ...row, proof: null }], [{ ...row, proof: { ...row.proof, releaseId: "other" } }], [{ ...row, fontManifestSha256: "other" }]]) {
    db.mockResolvedValue(rows);
    await expect(uploadLanguageEditorRelease(db as never, "owner", "short")).rejects.toMatchObject({ code: "UPLOAD_LANGUAGE_EDITOR_UNAVAILABLE" });
  }
});
