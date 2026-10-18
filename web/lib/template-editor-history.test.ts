import { describe, expect, it } from "vitest";
import { createTemplateEditorHistory, templateEditorHistory as reduce, templateEditorDirty, type TemplateEditorDraft } from "./template-editor-history";
const original: TemplateEditorDraft = { boardName: "게시판", title: "제목", body: ["본문"], tags: [], brandColor: "#000000", channel: "채널", avatar: null, assetKey: null, start: 0, end: 12 };
describe("template editing history", () => {
  it("undoes a typing group as one edit and preserves all template fields", () => {
    let state = createTemplateEditorHistory(original);
    state = reduce(state, { type: "edit", patch: { title: "제목1" }, group: "title" });
    state = reduce(state, { type: "edit", patch: { title: "제목12" }, group: "title" });
    expect(state.past).toHaveLength(1);
    state = reduce(state, { type: "undo" });
    expect(state.present).toEqual(original);
    expect(templateEditorDirty(state)).toBe(false);
    state = reduce(state, { type: "redo" });
    expect(state.present.title).toBe("제목12");
  });
  it("starts a new undo step after blur, drops redo on another edit, and tracks the saved baseline", () => {
    let state = createTemplateEditorHistory(original);
    state = reduce(state, { type: "edit", patch: { start: 1 }, group: "range" });
    state = reduce(state, { type: "checkpoint" });
    state = reduce(state, { type: "edit", patch: { start: 2 }, group: "range" });
    state = reduce(state, { type: "saved" });
    expect(templateEditorDirty(state)).toBe(false);
    state = reduce(state, { type: "undo" });
    expect(state.present.start).toBe(1);
    expect(templateEditorDirty(state)).toBe(true);
    state = reduce(state, { type: "edit", patch: { avatar: "data:image/webp;base64,new", assetKey: null } });
    expect(state.future).toHaveLength(0);
    expect(reduce(state, { type: "undo" }).present.avatar).toBeNull();
  });
  it("ignores no-op edits and bounds undo memory", () => {
    let state = createTemplateEditorHistory(original);
    expect(reduce(state, { type: "edit", patch: { title: original.title } })).toBe(state);
    for (let i = 0; i < 130; i++) state = reduce(state, { type: "edit", patch: { title: String(i) } });
    expect(state.past).toHaveLength(100);
  });
});
