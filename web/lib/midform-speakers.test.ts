import { expect, it } from "vitest";
import { speakerAppearance, transcriptGroups } from "./midform-speakers";

it("groups only consecutive excluded rows without joining across kept dialogue", () => {
  const rows = [false, false, true, false].map((keep, index) => ({ id: String(index), start: index, end: index + 1, text: "대사", speaker: "a", keep }));
  const groups = transcriptGroups(rows);
  expect(groups.map(group => group.rows.map(row => row.id))).toEqual([["0", "1"], ["2"], ["3"]]);
  expect(rows.map(row => row.keep)).toEqual([false, false, true, false]);
});
it("does not shift speaker colors for unassigned or overlapping speech", () => {
  expect(speakerAppearance("b", ["a", "unknown", "overlap", "b"])).toEqual(speakerAppearance("b", ["a", "b"]));
});
