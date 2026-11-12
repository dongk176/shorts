import { describe, expect, it } from "vitest";
import { deleteMidformStory, midformCaptionCues, midformRenderableDraft, midformStories, resetMidformSelection, resizeMidformStory, splitMidformStory } from "./midform-story-edit";
import { validateMidformDraft } from "./midform-cloud";
import type { MidformDraft } from "./midform-local";

const draft: MidformDraft = { rows: Array.from({ length: 12 }, (_, n) => ({ id: String(n), start: n, end: n + 1, text: String(n), speaker: "speaker_0", keep: [2, 3, 4, 8, 9].includes(n) })), names: {}, framing: {}, removeSilence: true, silencePreset: "aggressive" };

describe("story boundary editing with existing renderer", () => {
  it("groups a story independently of its internal silence pieces", () => {
    expect(midformStories(draft.rows, 12).map(s => [s.start, s.end])).toEqual([[2, 5], [8, 10]]);
  });
  it("extends and trims either edge while preserving immutable clocks and renderer validation", () => {
    const [story] = midformStories(draft.rows, 12);
    const extended = resizeMidformStory(draft, story, "start", 1);
    expect(extended.rows.filter(r => r.keep).map(r => r.id)).toEqual(["1", "2", "3", "4", "8", "9"]);
    const trimmed = resizeMidformStory(extended, story, "end", 4);
    expect(trimmed.rows.filter(r => r.keep).map(r => r.id)).toEqual(["1", "2", "3", "8", "9"]);
    expect(validateMidformDraft(trimmed, draft.rows)).toEqual(trimmed);
  });
  it("clamps to available source and preserves cuts inside the selected story", () => {
    const [story] = midformStories(draft.rows, 12);
    const cut = { ...draft, rows: draft.rows.map(r => r.id === "3" ? { ...r, keep: false } : r) };
    const result = resizeMidformStory(cut, story, "start", -100);
    expect(result.rows.find(r => r.id === "3")?.keep).toBe(false);
    expect(result.rows.find(r => r.id === "8")?.keep).toBe(true);
    expect(result.rows[0].keep).toBe(true);
    expect(result.rows.map(r => [r.id, r.start, r.end])).toEqual(draft.rows.map(r => [r.id, r.start, r.end]));
  });
  it("splits without changing media and deletes only the selected piece using the existing API contract", () => {
    const [story] = midformStories(draft.rows,12);
    const split = splitMidformStory(draft,story,3);
    expect(split.sceneSplits).toEqual([3]);
    expect(split.rows).toBe(draft.rows);
    const stories = midformStories(draft.rows,12,split.sceneSplits);
    expect(stories).toHaveLength(3);
    const removed = deleteMidformStory(split,stories[1]);
    expect(removed.rows.filter(row=>row.keep).map(row=>row.id)).toEqual(["2","8","9"]);
    const renderable = midformRenderableDraft(removed);
    expect(renderable).not.toHaveProperty("sceneSplits");
    expect(validateMidformDraft(renderable,draft.rows)).toEqual(renderable);
    const remaining=midformStories(draft.rows,12,removed.sceneSplits)[0];
    expect(resizeMidformStory(removed,remaining,"end",5).rows.filter(row=>row.keep).map(row=>row.id)).toEqual(["2","3","4","8","9"]);
  });
  it("keeps at least one selected piece", () => {
    const only={...draft,rows:draft.rows.map(row=>({...row,keep:[2,3,4].includes(Number(row.id))}))};
    expect(deleteMidformStory(only,midformStories(only.rows,12)[0])).toBe(only);
  });
  it("aligns caption blocks with the output after internal silence cuts", () => {
    const cues=midformCaptionCues(draft.rows,[[3,3.5]]);
    expect(cues.find(cue=>cue.id==="8")).toMatchObject({start:2.5,end:3.5,sourceStart:8});
    expect(cues.at(-1)?.end).toBe(4.5);
  });
  it("retains immutable scene handles across cuts, restores context, and preserves the API clock", () => {
    const scenes=[{start:2,end:5,availableStart:0,availableEnd:7},{start:8,end:10,availableStart:7,availableEnd:12}];
    const original=midformStories(draft.rows,12,[],scenes);
    const cut={...draft,rows:draft.rows.map(row=>row.id==="3"?{...row,keep:false}:row)};
    const reopened=midformStories(draft.rows,12,[],scenes);
    expect(reopened).toEqual(original);
    const extended=resizeMidformStory(cut,reopened[0],"start",0);
    expect(extended.rows.filter(row=>row.keep).map(row=>row.id)).toEqual(["0","1","2","4","8","9"]);
    expect(extended.rows.find(row=>row.id==="3")?.keep).toBe(false);
    expect(validateMidformDraft(midformRenderableDraft(extended),draft.rows)).toEqual(extended);
    expect(reopened[1].availableStart).toBe(7);
  });
  it("keeps adjacent legacy scenes separate without inventing missing context", () => {
    const old={...draft,rows:draft.rows.slice(0,8).map(row=>({...row,keep:true}))};
    const scenes=midformStories(old.rows,8,[],[{start:0,end:4},{start:4,end:8}]);
    expect(scenes.map(scene=>[scene.start,scene.end,scene.availableStart,scene.availableEnd])).toEqual([[0,4,0,4],[4,8,4,8]]);
    expect(resizeMidformStory(old,scenes[0],"end",100).rows.filter(row=>row.keep)).toHaveLength(8);
  });
  it("resets the initial selected scenes while preserving corrected captions and speaker edits", () => {
    const edited={...draft,sceneSplits:[3],rows:draft.rows.map(row=>({...row,keep:!row.keep,text:`교정 ${row.text}`}))};
    const reset=resetMidformSelection(edited,draft.rows);
    expect(reset.rows.map(row=>row.keep)).toEqual(draft.rows.map(row=>row.keep));
    expect(reset.rows.map(row=>row.text)).toEqual(edited.rows.map(row=>row.text));
    expect(reset.sceneSplits).toEqual([]);
    expect(validateMidformDraft(midformRenderableDraft(reset),draft.rows)).toEqual(midformRenderableDraft(reset));
  });
});
