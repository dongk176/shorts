import { describe, expect, it } from "vitest";
import {
  createEditorTextOverlay,
  createInitialEditorOverlayLayout,
} from "./editor-overlay-preview";
import {
  cloneEditorDocumentSnapshot,
  createEditorDocumentSnapshot,
  createEditorDocumentSnapshotV3,
  editorDocumentSnapshotsEqual,
} from "./editor-document-snapshot";

const snapshot = () => {
  const overlays = createInitialEditorOverlayLayout();
  overlays.textOverlays = [createEditorTextOverlay("text-1", 3)];
  overlays.textOverlays[0] = {
    ...overlays.textOverlays[0],
    text: "추가 문구",
    fontId: "do-hyeon",
    color: "#000000",
    effect: "shadow",
    offset: { x: 42, y: -18 },
    width: 420,
    scale: 1.35,
    startSeconds: 0.5,
    endSeconds: 2.5,
  };
  overlays.offsets.video = { x: 24, y: -12 };
  overlays.offsets.title = { x: -30, y: 18 };
  overlays.offsets.channel = { x: 12, y: 20 };
  overlays.commentOffsets = { "comment-1": { x: 0, y: 88 } };
  overlays.scales = { video: 1.2, title: 1.1, channel: 0.9 };
  overlays.fonts = { title: "black-han-sans", channel: "suit" };
  overlays.visible = {
    video: true,
    title: true,
    comment: true,
    channel: false,
  };
  overlays.commentTheme = "light";
  overlays.layerOrder = [
    "video",
    "comment",
    "text:text-1",
    "title",
    "channel",
  ];
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
    expect(value.overlays.textOverlays[0]).toMatchObject({
      text: "추가 문구",
      fontId: "do-hyeon",
      color: "#000000",
      effect: "shadow",
      offset: { x: 42, y: -18 },
      width: 420,
      scale: 1.35,
      startSeconds: 0.5,
      endSeconds: 2.5,
    });
    expect(value.overlays.offsets.video).toEqual({ x: 24, y: -12 });
    expect(value.overlays.offsets.title).toEqual({ x: 0, y: 18 });
    expect(value.overlays.commentOffsets["comment-1"]).toEqual({ x: 0, y: 88 });
    expect(value.title.fontScale).toBeCloseTo(1.1);
    expect(value.overlays.scales).toEqual({ video: 1.2, title: 1, channel: 0.9 });
    expect(value.overlays.fonts).toEqual({ title: "black-han-sans", channel: "suit" });
    expect(value.overlays.visible.channel).toBe(false);
    expect(value.overlays.commentTheme).toBe("light");
    expect(value.overlays.layerOrder).toEqual([
      "video",
      "comment",
      "text:text-1",
      "title",
      "channel",
    ]);
    expect(value.overlays.background).toEqual({
      kind: "color",
      color: "#FFFFFF",
    });
    expect(value.title.text).toBe("후킹 제목");
    expect(value.channel.thumbnailUrl).toBe("blob:channel-image");
    expect(value.subtitles.segments[0].text).toBe("자막");
  });

  it("consolidates legacy dual title sizing into the canonical font scale", () => {
    const overlays = createInitialEditorOverlayLayout();
    overlays.scales.title = 1.4;
    const value = createEditorDocumentSnapshot({
      ...snapshot(),
      title: {
        text: "후킹 제목",
        textStyles: [],
        fontScale: 1.2,
      },
      overlays,
    });

    expect(value.title.fontScale).toBeCloseTo(1.68);
    expect(value.overlays.scales.title).toBe(1);
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
    expect(original.overlays.offsets.video.x).toBe(24);
    expect(editorDocumentSnapshotsEqual(original, cloned)).toBe(false);
  });

  it("keeps subtitle layout out of ordinary v2 while preserving it in admin v3", () => {
    const ordinary = snapshot();
    ordinary.subtitles.enabled = false;
    const admin = createEditorDocumentSnapshotV3(ordinary, {
      offsetY: -240,
      scale: 1.35,
      accentColor: "#16A34A",
      cueEdits: [{ cueIndex: 2, text: "수정한 자막" }],
    });

    expect(ordinary.version).toBe(2);
    expect("renderSpec" in ordinary).toBe(false);
    expect(admin.subtitles.enabled).toBe(false);
    expect(admin.renderSpec).toMatchObject({
      version: 2,
      subtitles: {
        centerX: 540,
        offsetY: -240,
        scale: 1.35,
        accentColor: "#16A34A",
        cueEdits: [{ cueIndex: 2, text: "수정한 자막" }],
      },
    });

    const cloned = cloneEditorDocumentSnapshot(admin);
    expect(cloned).toEqual(admin);
    expect(cloned.subtitles.enabled).toBe(false);
    if (cloned.version !== 3 || cloned.renderSpec.version !== 2) {
      throw new Error("admin subtitle render spec was not cloned");
    }
    cloned.renderSpec.subtitles.cueEdits![0].text = "별도 변경";
    expect(admin.renderSpec.version).toBe(2);
    if (admin.renderSpec.version !== 2) throw new Error("invalid test fixture");
    expect(admin.renderSpec.subtitles.cueEdits?.[0].text).toBe("수정한 자막");
  });
});
