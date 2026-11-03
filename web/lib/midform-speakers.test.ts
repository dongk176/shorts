import { expect, it } from "vitest";
import { initialSpeakerNames, speakerAppearance, speakerKeys, transcriptGroups } from "./midform-speakers";

it("groups only consecutive excluded rows without joining across kept dialogue", () => {
  const rows = [false, false, true, false].map((keep, index) => ({ id: String(index), start: index, end: index + 1, text: "대사", speaker: "a", keep }));
  const groups = transcriptGroups(rows);
  expect(groups.map(group => group.rows.map(row => row.id))).toEqual([["0", "1"], ["2"], ["3"]]);
  expect(rows.map(row => row.keep)).toEqual([false, false, true, false]);
});
it("does not shift speaker colors for unassigned or overlapping speech", () => {
  expect(speakerAppearance("b", ["a", "unknown", "overlap", "b"])).toEqual(speakerAppearance("b", ["a", "b"]));
});
it("numbers people consecutively across unknown/overlapping intervals and preserves edited names", () => {
  const rows = ["speaker_2", "unknown", "speaker_0", "overlap", "speaker_1", "speaker_2"].map((speaker, index) => ({ id: String(index), start: index, end: index + 1, text: "대사", speaker, keep: true }));
  expect(initialSpeakerNames(rows)).toEqual({ speaker_2: "화자 1", unknown: "미확인", speaker_0: "화자 2", overlap: "겹친 음성", speaker_1: "화자 3" });
  expect(initialSpeakerNames(rows, { speaker_0: "진행자" }, { speaker_1: "출연자" })).toMatchObject({ speaker_2: "화자 1", speaker_0: "진행자", speaker_1: "출연자" });
});
it("keeps speaker badges and colors when database object-key ordering changes", () => {
  const rows = ["speaker_2", "unknown", "speaker_0"].map((speaker, index) => ({ id: String(index), start: index, end: index + 1, text: "대사", speaker, keep: true }));
  const before = { rows, framing: {}, names: { speaker_2: "진행자", unknown: "미확인", speaker_0: "출연자" }, removeSilence: true };
  const after = { ...before, names: { unknown: "미확인", speaker_0: "출연자", speaker_2: "진행자" } };
  expect(speakerAppearance("speaker_2", speakerKeys(before))).toEqual(speakerAppearance("speaker_2", speakerKeys(after)));
  expect(speakerAppearance("speaker_2", speakerKeys(after)).badge).toBe("A");
});
