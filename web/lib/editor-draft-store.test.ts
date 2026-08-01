import { describe, expect, it } from "vitest";
import { createEditorDocumentSnapshot } from "@/lib/editor-document-snapshot";
import { createInitialEditorOverlayLayout } from "@/lib/editor-overlay-preview";
import {
  createEditorDraftRecord,
  editorDraftSavedAgoLabel,
  editorDraftKey,
  parseEditorDraftChange,
  parseEditorDraftRecord,
} from "@/lib/editor-draft-store";
import { createEditorVideoClips } from "@/lib/editor-video-cuts";

const SHORT_ID = "8cf39a2c-4c34-4f78-9a1d-9bdf015a4b9e";

function document() {
  return createEditorDocumentSnapshot({
    sourceShortId: SHORT_ID,
    baseRenderVersion: 7,
    template: {
      id: "comment-capture",
      customTemplateId: null,
      presetVersion: 1,
      snapshot: { presetVersion: 1 },
    },
    title: { text: "임시저장", textStyles: [], fontScale: 1 },
    channel: {
      displayName: "채널",
      thumbnailUrl: null,
      thumbnailAssetKey: null,
    },
    comments: [],
    subtitles: { enabled: true, segments: [] },
    overlays: createInitialEditorOverlayLayout(),
    video: {
      clips: createEditorVideoClips(0, 5),
      aspectRatio: "1:1",
      timelineStartSeconds: 0,
      timelineEndSeconds: 5,
      selectionStartSeconds: 0,
      selectionEndSeconds: 5,
    },
  });
}

describe("editor draft store", () => {
  it("keys drafts by short and base render version", () => {
    expect(editorDraftKey(SHORT_ID, 7)).toBe(
      `editor-v2:${SHORT_ID}:render:7`,
    );
  });

  it("keeps a validated draft without an automatic expiry field", () => {
    const record = createEditorDraftRecord(
      document(),
      "2026-08-01T00:00:00.000Z",
    );
    expect(parseEditorDraftRecord(record)).toEqual(record);
    expect(record).not.toHaveProperty("expiresAt");
  });

  it("keeps source-timeline comments while a shortened video is being edited", () => {
    const value = document();
    value.video.clips = createEditorVideoClips(0, 3);
    value.video.selectionEndSeconds = 3;
    value.comments = [{
      id: "comment-1",
      startSeconds: 0,
      endSeconds: 5,
      text: "원본 영상 기준 댓글",
      initial: "원",
      avatarColor: "#2563EB",
      nickname: "댓글러",
      likeCount: 30,
      ageLabel: "1개월 전",
    }];
    const record = createEditorDraftRecord(value);
    expect(parseEditorDraftRecord(record)?.document.comments[0].endSeconds)
      .toBe(5);
  });

  it("rejects a draft whose identity differs from its document", () => {
    const record = createEditorDraftRecord(document());
    expect(parseEditorDraftRecord({
      ...record,
      baseRenderVersion: 8,
    })).toBeNull();
  });

  it("accepts only a valid cross-tab draft change signal", () => {
    expect(parseEditorDraftChange({
      shortId: SHORT_ID,
      baseRenderVersion: 7,
    })).toEqual({
      shortId: SHORT_ID,
      baseRenderVersion: 7,
    });
    expect(parseEditorDraftChange({
      shortId: "not-a-short-id",
      baseRenderVersion: 7,
    })).toBeNull();
  });

  it("describes the last successful save with a human relative time", () => {
    const now = Date.parse("2026-08-01T03:00:00.000Z");
    expect(editorDraftSavedAgoLabel("2026-08-01T02:59:40.000Z", now))
      .toBe("방금 전 저장됨");
    expect(editorDraftSavedAgoLabel("2026-08-01T02:54:00.000Z", now))
      .toBe("6분 전 저장됨");
    expect(editorDraftSavedAgoLabel("2026-08-01T00:00:00.000Z", now))
      .toBe("3시간 전 저장됨");
  });
});
