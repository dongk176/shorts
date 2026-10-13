import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentTextFont, hasUnsupportedCjkFont } from "./content-language";
import { editorDocumentSnapshotSchema, editorDocumentOutputDuration } from "./editor-document-contract";
import { canonicalizeEditorDocumentTimelineForSave } from "./editor-timeline-sync";
import { normalizeStoredCaptionComposition } from "./caption-composition-compat";
const fixture = () => JSON.parse(readFileSync(new URL("../../test-fixtures/editor-document-v2.json", import.meta.url), "utf8"));
describe("editor reliability across pinned workers", () => {
  it("selects an actual CJK face, retaining compatible choices", () => {
    expect(contentTextFont("国 年 最 違 間 韓", "pretendard", true)).toBe("noto-sans-jp");
    expect(contentTextFont("こんにちは", "pretendard", false)).toBe("noto-sans-kr");
    expect(contentTextFont("こんにちは", "noto-serif-kr", true)).toBe("noto-serif-kr");
    expect(contentTextFont("한글 English", "pretendard", true)).toBe("pretendard");
  });
  it("rejects invisible-only titles before creating a render job", () => {
    const doc = fixture(); doc.title.text = "\u200b"; doc.title.textStyles = [];
    expect(editorDocumentSnapshotSchema.safeParse(doc).success).toBe(false);
    doc.overlays.visible.title = false;
    expect(editorDocumentSnapshotSchema.safeParse(doc).success).toBe(true);
  });
  it("rejects stale client requests with missing CJK glyphs", () => {
    const doc = fixture(); doc.channel.displayName = "日本国";
    doc.overlays.visible.channel = true; doc.overlays.fonts.channel = "pretendard";
    expect(hasUnsupportedCjkFont(doc)).toBe(true);
    doc.overlays.fonts.channel = "noto-sans-kr";
    expect(hasUnsupportedCjkFont(doc)).toBe(false);
  });
  it("uses a rounding boundary accepted by both JS and Python workers", () => {
    const doc = fixture();
    doc.video.clips = [{ id: "clip-1", sourceStartSeconds: 0, sourceEndSeconds: 1.0625 }];
    doc.video.selectionStartSeconds = 10; doc.video.selectionEndSeconds = 11.0625;
    doc.comments = [{ id: "comment-1", startSeconds: 0, endSeconds: 1.0634,
      text: "댓글", initial: "댓", avatarColor: "#2563EB", nickname: "댓글러", likeCount: 30, ageLabel: "1개월 전" }];
    expect(editorDocumentOutputDuration(doc)).toBe(1.062);
    expect(editorDocumentSnapshotSchema.safeParse(doc).success).toBe(false);
    doc.comments[0].endSeconds = 1.062;
    expect(editorDocumentSnapshotSchema.safeParse(doc).success).toBe(true);
  });
  it("canonicalizes metadata drift without shifting absolute source time", () => {
    const doc = fixture();
    const start = doc.video.timelineStartSeconds;
    doc.video.clips = [{ id: "clip-1", sourceStartSeconds: 1, sourceEndSeconds: 3 }];
    const next = canonicalizeEditorDocumentTimelineForSave(doc, {
      timelineStartSeconds: start + 0.1, timelineEndSeconds: doc.video.timelineEndSeconds - 0.1, version: 1,
    });
    expect(next.video.timelineStartSeconds).toBe(start + 0.1);
    expect(next.video.clips[0].sourceStartSeconds).toBe(0.9);
    expect(next.video.selectionStartSeconds).toBe(start + 1);
    expect(next.video.selectionEndSeconds).toBe(start + 3);
    expect(doc.video.clips[0].sourceStartSeconds).toBe(1);
  });
  it("repairs only legacy 5:4 metadata, preserving absolute captions", () => {
    const spec = JSON.parse(readFileSync(new URL("../../test-fixtures/caption-composition-5x4.json", import.meta.url), "utf8")).stored;
    delete spec.translation;
    spec.layout.caption = { x: 90, y: 1340, width: 900, height: 140 };
    const next = normalizeStoredCaptionComposition(spec)!;
    if (next.schemaVersion !== 4) throw new Error("Expected v4");
    expect(next.layout!.caption).toEqual({ x: 90, y: 1340, width: 900, height: 52 });
    expect(next.safeArea).toEqual(spec.safeArea);
    expect(next.cues).toEqual(spec.cues);
    expect(next.style).toEqual(spec.style);
    expect(next.layout!.video).toEqual(spec.layout.video);
    expect(normalizeStoredCaptionComposition(next)).toBeNull();
  });
});
