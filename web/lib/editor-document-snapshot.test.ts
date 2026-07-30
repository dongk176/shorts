import { describe, expect, it } from "vitest";
import {
  createEditorTextOverlay,
  createInitialEditorOverlayLayout,
} from "./editor-overlay-preview";
import {
  cloneEditorDocumentSnapshot,
  createEditorDocumentSnapshot,
  editorDocumentSnapshotsEqual,
} from "./editor-document-snapshot";

const snapshot = () => {
  const overlays = createInitialEditorOverlayLayout();
  overlays.textOverlays = [createEditorTextOverlay("text-1", 3)];
  overlays.layerOrder.push("text:text-1");
  overlays.background = { kind: "color", color: "#FFFFFF" };
  return createEditorDocumentSnapshot({
  sourceShortId: "short-1",
  baseRenderVersion: 4,
  template: {
    id: "comment-capture",
    customTemplateId: null,
    presetVersion: 3,
    snapshot: { presetVersion: 3 },
  },
  title: {
    text: "후킹 제목",
    textStyles: [{ start: 0, end: 2, color: "#ffffff" }],
    fontScale: 1,
  },
  channel: {
    displayName: "채널명",
    thumbnailUrl: "blob:channel-image",
    thumbnailAssetKey: null,
  },
  comments: [{
    id: "comment-1",
    startSeconds: 0,
    endSeconds: 3,
    text: "댓글",
    initial: "댓",
    avatarColor: "#111111",
    nickname: "사용자",
    likeCount: 10,
    ageLabel: "1분 전",
  }],
  subtitles: {
    enabled: true,
    segments: [{ start: 0, end: 3, text: "자막" }],
  },
  overlays,
  video: {
    clips: [{
      id: "clip-1",
      sourceStartSeconds: 0,
      sourceEndSeconds: 3,
    }],
    aspectRatio: "16:9",
    timelineStartSeconds: 12,
    timelineEndSeconds: 18,
    selectionStartSeconds: 0,
    selectionEndSeconds: 3,
  },
  });
};

describe("editor document snapshot", () => {
  it("keeps every render-facing editor domain in one versioned snapshot", () => {
    const value = snapshot();
    expect(value.version).toBe(2);
    expect(value.baseRenderVersion).toBe(4);
    expect(value.video.clips).toHaveLength(1);
    expect(value.comments).toHaveLength(1);
    expect(value.overlays.textOverlays[0].text).toBe("텍스트를 입력하세요");
    expect(value.overlays.background).toEqual({
      kind: "color",
      color: "#FFFFFF",
    });
    expect(value.title.text).toBe("후킹 제목");
    expect(value.channel.thumbnailUrl).toBe("blob:channel-image");
    expect(value.subtitles.segments[0].text).toBe("자막");
  });

  it("clones nested state so preview and future render payloads cannot mutate each other", () => {
    const original = snapshot();
    const cloned = cloneEditorDocumentSnapshot(original);
    cloned.comments[0].text = "변경";
    cloned.title.textStyles[0].color = "#000000";
    cloned.video.clips[0].sourceEndSeconds = 2;
    cloned.subtitles.segments[0].text = "변경된 자막";
    cloned.overlays.offsets.video.x = 40;

    expect(original.comments[0].text).toBe("댓글");
    expect(original.title.textStyles[0].color).toBe("#ffffff");
    expect(original.video.clips[0].sourceEndSeconds).toBe(3);
    expect(original.subtitles.segments[0].text).toBe("자막");
    expect(original.overlays.offsets.video.x).toBe(0);
    expect(editorDocumentSnapshotsEqual(original, cloned)).toBe(false);
  });
});
