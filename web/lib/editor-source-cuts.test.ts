import { expect, it } from "vitest";
import { hasEditorSourceCuts } from "./editor-source-cuts";

it("protects cut sequences from legacy rerenders while leaving unedited shorts alone", () => {
  expect(hasEditorSourceCuts({ video: { clips: [{ id: "a" }, { id: "b" }] } })).toBe(true);
  for (const value of [null, {}, { video: { clips: [] } }, { video: { clips: [{ id: "a" }] } }]) {
    expect(hasEditorSourceCuts(value)).toBe(false);
  }
});
