import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  editorDraftDocumentSnapshotSchema,
  editorDocumentOutputDuration,
  editorDocumentSnapshotSchema,
} from "./editor-document-contract";
import { createEditorDocumentSnapshot } from "./editor-document-snapshot";
import { createInitialEditorOverlayLayout } from "./editor-overlay-preview";

function validDocument() {
  return createEditorDocumentSnapshot({
    sourceShortId: "d164fb8d-d6e1-4232-8463-9115cdf7e561",
    baseRenderVersion: 3,
    template: {
      id: "comment-capture",
      customTemplateId: null,
      presetVersion: 3,
      snapshot: { presetVersion: 3 },
    },
    title: {
      text: "정확한 제목",
      textStyles: [{ start: 0, end: 3, color: "#FFFFFF" }],
      fontScale: 1,
    },
    channel: {
      displayName: "PAKA",
      thumbnailUrl: "https://example.com/channel.png",
      thumbnailAssetKey: null,
    },
    comments: [{
      id: "comment-1",
      startSeconds: 0,
      endSeconds: 1.5,
      text: "첫 댓글",
      initial: "첫",
      avatarColor: "#2563EB",
      nickname: "댓글러",
      likeCount: 30,
      ageLabel: "1개월 전",
    }],
    subtitles: {
      enabled: true,
      segments: [{ start: 0, end: 5, text: "원본 타임라인 자막" }],
    },
    overlays: createInitialEditorOverlayLayout(),
    video: {
      clips: [
        {
          id: "clip-1",
          sourceStartSeconds: 1,
          sourceEndSeconds: 2.5,
        },
        {
          id: "clip-2",
          sourceStartSeconds: 4,
          sourceEndSeconds: 6,
        },
      ],
      aspectRatio: "16:9",
      timelineStartSeconds: 10,
      timelineEndSeconds: 20,
      selectionStartSeconds: 11,
      selectionEndSeconds: 16,
    },
  });
}

describe("editor document v2 contract", () => {
  it("accepts the repository-wide worker contract fixture", () => {
    const fixture = JSON.parse(readFileSync(
      path.resolve(process.cwd(), "../test-fixtures/editor-document-v2.json"),
      "utf8",
    ));
    expect(editorDocumentSnapshotSchema.parse(fixture).version).toBe(2);
  });

  it("accepts a complete scene and derives the ripple output duration", () => {
    const parsed = editorDocumentSnapshotSchema.parse(validDocument());
    expect(editorDocumentOutputDuration(parsed)).toBe(3.5);
  });

  it("rejects overlapping source clips", () => {
    const value = validDocument();
    value.video.clips[1].sourceStartSeconds = 2;
    expect(() => editorDocumentSnapshotSchema.parse(value)).toThrow(
      "영상 조각의 원본 구간이 서로 겹칠 수 없습니다.",
    );
  });

  it("rejects a layer order that omits a renderable layer", () => {
    const value = validDocument();
    value.overlays.layerOrder = ["video", "title", "channel"];
    expect(() => editorDocumentSnapshotSchema.parse(value)).toThrow(
      "레이어 순서가 현재 오버레이와 일치하지 않습니다.",
    );
  });

  it("rejects a selection that no longer matches the retained clips", () => {
    const value = validDocument();
    value.video.selectionEndSeconds = 15;
    expect(() => editorDocumentSnapshotSchema.parse(value)).toThrow(
      "영상 선택 범위가 영상 조각과 일치하지 않습니다.",
    );
  });

  it("rejects two channel thumbnail sources", () => {
    const value = validDocument();
    value.channel.thumbnailAssetKey =
      "edit-sources/session/job/short/editor-assets/channel.webp";
    expect(() => editorDocumentSnapshotSchema.parse(value)).toThrow(
      "채널 이미지는 URL과 저장 자산 중 하나만 사용할 수 있습니다.",
    );
  });

  it("rejects duplicate comment identifiers", () => {
    const value = validDocument();
    value.comments.push({
      ...value.comments[0],
      startSeconds: 1.5,
      endSeconds: 3.5,
    });
    expect(() => editorDocumentSnapshotSchema.parse(value)).toThrow(
      "댓글 식별자는 중복될 수 없습니다.",
    );
  });

  it("rejects timed overlays beyond the ripple output", () => {
    const value = validDocument();
    value.comments[0].endSeconds = 4;
    expect(() => editorDocumentSnapshotSchema.parse(value)).toThrow(
      "댓글 노출 구간이 최종 영상 길이를 넘을 수 없습니다.",
    );
  });

  it("keeps source-timeline overlays in an in-progress shortened-video draft", () => {
    const value = validDocument();
    value.comments[0].endSeconds = 4;
    expect(editorDraftDocumentSnapshotSchema.parse(value).comments[0].endSeconds)
      .toBe(4);
  });

  it("rejects horizontal comment offsets that the editor cannot render", () => {
    const value = validDocument();
    value.overlays.commentOffsets["comment-1"] = { x: 1, y: 20 };
    expect(() => editorDocumentSnapshotSchema.parse(value)).toThrow();
  });

  it("rejects card-only colors from renderer overlay inputs", () => {
    const value = validDocument();
    value.overlays.background = {
      kind: "color",
      color: "#F04444" as never,
    };
    expect(() => editorDocumentSnapshotSchema.parse(value)).toThrow();
  });
});

describe("editor document v3 render specification", () => {
  it("accepts the shared v3 fixture and distinguishes Noto title/text weights", () => {
    const fixture = JSON.parse(readFileSync(
      path.resolve(process.cwd(), "../test-fixtures/editor-document-v3.json"),
      "utf8",
    ));
    const parsed = editorDocumentSnapshotSchema.parse(fixture);
    expect(parsed.version).toBe(3);
    if (parsed.version !== 3) throw new Error("v3 fixture was parsed as v2");
    expect(parsed.renderSpec.title.font.resolvedWeight).toBe(700);
    expect(parsed.renderSpec.textOverlays[0].font.resolvedWeight).toBe(800);
    expect(parsed.renderSpec.textOverlays[0]).toMatchObject({
      startFrame: 15,
      endFrame: 75,
    });
  });

  it("rejects a client render specification that differs from semantic edits", () => {
    const fixture = JSON.parse(readFileSync(
      path.resolve(process.cwd(), "../test-fixtures/editor-document-v3.json"),
      "utf8",
    ));
    fixture.renderSpec.textOverlays[0].font.resolvedWeight = 700;
    expect(() => editorDocumentSnapshotSchema.parse(fixture)).toThrow();
  });

  it("accepts the admin-only vertical subtitle layout while fixing horizontal position", () => {
    const fixture = JSON.parse(readFileSync(
      path.resolve(process.cwd(), "../test-fixtures/editor-document-v3.json"),
      "utf8",
    ));
    fixture.renderSpec.version = 2;
    fixture.renderSpec.subtitles = {
      centerX: 540,
      offsetY: 700,
      scale: 1.4,
      accentColor: "#16A34A",
      cueEdits: [{ cueIndex: 0, text: "수정한 자막" }],
    };

    const parsed = editorDocumentSnapshotSchema.parse(fixture);
    expect(parsed.version).toBe(3);
    if (parsed.version !== 3 || parsed.renderSpec.version !== 2) {
      throw new Error("admin subtitle render spec was not preserved");
    }
    expect(parsed.renderSpec.subtitles).toEqual({
      centerX: 540,
      offsetY: 700,
      scale: 1.4,
      accentColor: "#16A34A",
      cueEdits: [{ cueIndex: 0, text: "수정한 자막" }],
    });

    fixture.renderSpec.subtitles.centerX = 520;
    expect(() => editorDocumentSnapshotSchema.parse(fixture)).toThrow();
  });

  it("accepts an admin subtitle font regardless of JSON object key order", () => {
    const fixture = JSON.parse(readFileSync(
      path.resolve(process.cwd(), "../test-fixtures/editor-document-v3.json"),
      "utf8",
    ));
    fixture.renderSpec.version = 2;
    fixture.renderSpec.subtitles = {
      centerX: 540,
      offsetY: 120,
      fontId: "do-hyeon",
      scale: 1.45,
      accentColor: "#EF4444",
    };

    const parsedDraft = editorDraftDocumentSnapshotSchema.parse(fixture);
    const parsedApply = editorDocumentSnapshotSchema.parse(fixture);
    expect(parsedDraft.version).toBe(3);
    expect(parsedApply.version).toBe(3);
    if (
      parsedApply.version !== 3
      || parsedApply.renderSpec.version !== 2
    ) {
      throw new Error("admin subtitle font render spec was not preserved");
    }
    expect(parsedApply.renderSpec.subtitles.fontId).toBe("do-hyeon");
  });

  it("accepts v3 absolute subtitle size and regular text color", () => {
    const fixture = JSON.parse(readFileSync(
      path.resolve(process.cwd(), "../test-fixtures/editor-document-v3.json"),
      "utf8",
    ));
    fixture.renderSpec.version = 3;
    fixture.renderSpec.subtitles = {
      centerX: 540,
      offsetY: -180,
      scale: 1,
      fontId: "do-hyeon",
      fontSize: 88,
      color: "#F8FAFC",
      accentColor: "#EF4444",
    };

    const parsed = editorDocumentSnapshotSchema.parse(fixture);
    expect(parsed.version).toBe(3);
    if (parsed.version !== 3 || parsed.renderSpec.version !== 3) {
      throw new Error("v3 subtitle render spec was not preserved");
    }
    expect(parsed.renderSpec.subtitles).toMatchObject({
      centerX: 540,
      fontSize: 88,
      color: "#F8FAFC",
    });

    fixture.renderSpec.subtitles.fontSize = 121;
    expect(() => editorDocumentSnapshotSchema.parse(fixture)).toThrow();
  });
});
