import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { EditorDocumentSnapshot } from "./editor-document-snapshot";
import { editorDocumentSnapshotSchema } from "./editor-document-contract";
import { synchronizeEditorDocumentTimeline } from "./editor-timeline-sync";

// Produced by the Python initial-output planner and compared in its own tests.
const fixture = JSON.parse(readFileSync("../test-fixtures/shorts-silence-inline.json", "utf8"));
describe("initial worker silence document", () => {
  it("opens in the existing editor and retains original source on timeline expansion", () => {
    const doc = editorDocumentSnapshotSchema.parse(fixture) as EditorDocumentSnapshot;
    const expanded = synchronizeEditorDocumentTimeline(doc, {
      timelineStartSeconds: 70, timelineEndSeconds: 134, version: 1,
      subtitleSegments: [{ start: 29, end: 30, text: "앞" }, { start: 34, end: 35, text: "뒤" }],
    });
    expect(editorDocumentSnapshotSchema.safeParse(expanded).success).toBe(true);
    expect(expanded.video.clips[0].sourceStartSeconds).toBe(30);
    expect(expanded.video.clips[1].sourceStartSeconds).toBe(32.9);
    expect(expanded.subtitles.segments.find(s => s.text === "after")!.start).toBe(33);
    expect(expanded.video.selectionStartSeconds).toBe(100);
    expect(expanded.subtitles.segments.map(s => s.text)).toEqual(["앞", "before", "after", "뒤"]);
    expect(expanded.comments).toEqual(doc.comments);
    expect(expanded.video.clips.reduce((sum, c) => sum + c.sourceEndSeconds - c.sourceStartSeconds, 0)).toBeCloseTo(2.2);
  });
});
