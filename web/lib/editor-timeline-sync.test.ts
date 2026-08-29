import { describe, expect, it } from "vitest";
import type { EditorDocumentSnapshot } from "@/lib/editor-document-snapshot";
import {
  editorDocumentMatchesTimeline,
  synchronizeEditorDocumentTimeline,
} from "@/lib/editor-timeline-sync";

function documentFixture(): EditorDocumentSnapshot {
  return {
    version: 2,
    sourceShortId: "c19c0a32-62b6-43a7-8887-8ea930dc4e83",
    baseRenderVersion: 1,
    template: {
      id: "dark-minimal",
      customTemplateId: null,
      presetVersion: 3,
      snapshot: { presetVersion: 3 },
    },
    title: { text: "제목", textStyles: [], fontScale: 1 },
    channel: {
      displayName: "채널",
      thumbnailUrl: null,
      thumbnailAssetKey: null,
    },
    comments: [],
    subtitles: {
      enabled: true,
      segments: [{ start: 2, end: 4, text: "자막" }],
    },
    overlays: {
      offsets: {
        video: { x: 0, y: 0 },
        title: { x: 0, y: 0 },
        comment: { x: 0, y: 0 },
        channel: { x: 0, y: 0 },
      },
      commentOffsets: {},
      scales: { video: 1, title: 1, channel: 1 },
      fonts: { title: "pretendard", channel: "pretendard" },
      visible: { video: true, title: true, comment: false, channel: true },
      commentTheme: null,
      textOverlays: [],
      layerOrder: ["video", "title", "channel"],
      background: null,
    },
    video: {
      clips: [{
        id: "clip-1",
        sourceStartSeconds: 0,
        sourceEndSeconds: 10,
      }],
      aspectRatio: "1:1",
      timelineStartSeconds: 310,
      timelineEndSeconds: 320,
      selectionStartSeconds: 310,
      selectionEndSeconds: 320,
    },
  };
}

describe("editor timeline synchronization", () => {
  it("keeps an already matching document unchanged", () => {
    const document = documentFixture();
    const synchronized = synchronizeEditorDocumentTimeline(document, {
      timelineStartSeconds: 310,
      timelineEndSeconds: 320,
      version: 0,
    });

    expect(editorDocumentMatchesTimeline(synchronized, {
      timelineStartSeconds: 310,
      timelineEndSeconds: 320,
      version: 0,
    })).toBe(true);
    expect(synchronized).toEqual(document);
  });

  it("rebases clips and subtitles when the captured timeline expands", () => {
    const synchronized = synchronizeEditorDocumentTimeline(documentFixture(), {
      timelineStartSeconds: 280,
      timelineEndSeconds: 350,
      version: 1,
    });

    expect(synchronized.video).toMatchObject({
      timelineStartSeconds: 280,
      timelineEndSeconds: 350,
      selectionStartSeconds: 310,
      selectionEndSeconds: 320,
      clips: [{ sourceStartSeconds: 30, sourceEndSeconds: 40 }],
    });
    expect(synchronized.subtitles.segments).toEqual([
      { start: 32, end: 34, text: "자막" },
    ]);
    expect(synchronized.title.text).toBe("제목");
  });

  it("fails closed when the source timeline is replaced instead of expanded", () => {
    expect(() => synchronizeEditorDocumentTimeline(documentFixture(), {
      timelineStartSeconds: 312,
      timelineEndSeconds: 322,
      version: 2,
    })).toThrow("편집용 영상 범위가 변경되었습니다");
  });
});
