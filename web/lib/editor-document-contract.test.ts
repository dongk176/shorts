import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  editorDraftDocumentSnapshotSchema,
  editorDocumentOutputDuration,
  editorDocumentSnapshotSchema,
  parseInitialEditorRenderSpec,
} from "./editor-document-contract";
import {
  canonicalizeEditorDocumentV4TitleOffset,
  cloneEditorDocumentSnapshot,
  createEditorDocumentSnapshot,
  type EditorDocumentSnapshot,
} from "./editor-document-snapshot";
import {
  createEditorDraftRecord,
  parseEditorDraftRecord,
} from "./editor-draft-store";
import { createInitialEditorOverlayLayout } from "./editor-overlay-preview";
import { resolveEditorFontFaceV4 } from "./editor-fonts";
import {
  compileEditorRenderTitleSpecV4,
  createEditorRenderSpec,
} from "./editor-render-spec";

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

function validV4Document(titleOffsetY = 0) {
  const document = validDocument();
  document.overlays.offsets.title.y = titleOffsetY;
  const legacy = createEditorRenderSpec(document, undefined, 1);
  if (legacy.version !== 1) throw new Error("invalid legacy fixture");
  const title = compileEditorRenderTitleSpecV4(
    document,
    (text, fontSize) => ({
      width: Array.from(text).length * fontSize * 0.72,
      actualBoundingBoxAscent: fontSize * 0.76,
      actualBoundingBoxDescent: fontSize * 0.24,
    }),
  );
  return {
    ...document,
    version: 3,
    renderSpec: {
      canvas: legacy.canvas,
      fps: legacy.fps,
      layerOrder: legacy.layerOrder,
      comments: legacy.comments,
      video: legacy.video,
      version: 4,
      title,
      channel: {
        ...legacy.channel,
        visible: document.overlays.visible.channel,
        font: resolveEditorFontFaceV4(document.overlays.fonts.channel, "channel"),
      },
      textOverlays: legacy.textOverlays.map((overlay, index) => ({
        ...overlay,
        font: resolveEditorFontFaceV4(
          document.overlays.textOverlays[index]?.fontId || "pretendard",
          "text",
        ),
      })),
      subtitles: {
        centerX: 540,
        offsetY: 0,
        scale: 1,
        fontSize: 48,
        color: "#FFFFFF",
        visible: true,
        captionSpecVersion: 4,
      },
    },
  } satisfies EditorDocumentSnapshot;
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

  it("preserves authoritative v4 geometry and nested version while cloning", () => {
    const value = validV4Document();
    const parsed = editorDocumentSnapshotSchema.parse(value);
    expect(parsed.version).toBe(3);
    if (parsed.version !== 3 || parsed.renderSpec.version !== 4) {
      throw new Error("v4 fixture was downgraded");
    }
    expect(parsed.renderSpec.title.lineBoxes).toEqual(
      value.renderSpec.title.lineBoxes,
    );
    const cloned = cloneEditorDocumentSnapshot(
      parsed as unknown as EditorDocumentSnapshot,
    );
    expect(cloned).toEqual(parsed);
    if (cloned.version !== 3 || cloned.renderSpec.version !== 4) {
      throw new Error("v4 clone was downgraded");
    }
    cloned.renderSpec.title.lineBoxes[0].centerY += 1;
    expect(parsed.renderSpec.title.lineBoxes[0].centerY).not.toBe(
      cloned.renderSpec.title.lineBoxes[0].centerY,
    );
  });

  it("reads an existing fractional-position draft but rejects it for submission", () => {
    const value = validV4Document(12.34567);
    expect(value.renderSpec.title.offsetY).toBe(12.346);
    const draft = editorDraftDocumentSnapshotSchema.parse(value);
    expect(draft.overlays.offsets.title.y).toBe(12.34567);
    const record = createEditorDraftRecord(value, "2026-08-31T00:00:00.000Z");
    expect(parseEditorDraftRecord(record)?.document).toEqual(value);
    expect(() => editorDocumentSnapshotSchema.parse(value)).toThrow(
      "제목 위치가 렌더 사양과 일치해야 합니다.",
    );
  });

  it.each([
    [12.34567, 12.346],
    [-12.34567, -12.346],
    [1919.99967, 1920],
    [-1919.99967, -1920],
    [0, 0],
  ])("canonicalizes only v4 semantic title Y %s to %s for submission", (raw, fixed) => {
    const value = validV4Document(raw);
    value.overlays.offsets.title.x = 18.12345;
    const original = structuredClone(value);
    const canonical = canonicalizeEditorDocumentV4TitleOffset(value);
    const expected = structuredClone(value);
    expected.overlays.offsets.title.y = fixed;

    expect(canonical).toEqual(expected);
    expect(canonical).not.toBe(value);
    expect(value).toEqual(original);
    expect(editorDocumentSnapshotSchema.parse(canonical).overlays.offsets.title.y)
      .toBe(fixed);
    expect(canonicalizeEditorDocumentV4TitleOffset(canonical)).toEqual(canonical);
    expect(canonicalizeEditorDocumentV4TitleOffset(value, 3)).toBe(value);
  });

  it("does not hide a stale v4 offset or weaken title font and weight validation", () => {
    const stale = validV4Document(12.34567);
    stale.renderSpec.title.offsetY = 40;
    const canonical = canonicalizeEditorDocumentV4TitleOffset(stale);
    expect(() => editorDocumentSnapshotSchema.parse(canonical)).toThrow(
      "제목 위치가 렌더 사양과 일치해야 합니다.",
    );

    const wrongFont = validV4Document();
    wrongFont.renderSpec.title.font = resolveEditorFontFaceV4("jua", "title");
    expect(() => editorDocumentSnapshotSchema.parse(wrongFont)).toThrow();
    const wrongWeight = validV4Document();
    wrongWeight.renderSpec.title.font.requestedWeight = 800;
    expect(() => editorDocumentSnapshotSchema.parse(wrongWeight)).toThrow();
  });

  it("normalizes a near-zero negative title drag without moving its geometry", () => {
    const value = validV4Document(-0.0004);
    expect(Object.is(value.renderSpec.title.offsetY, -0)).toBe(true);
    const canonical = canonicalizeEditorDocumentV4TitleOffset(value);
    const expected = structuredClone(value);
    expected.overlays.offsets.title.y = 0;
    expected.renderSpec.title.offsetY = 0;

    expect(canonical).toEqual(expected);
    expect(editorDocumentSnapshotSchema.safeParse(canonical).success).toBe(true);
    expect(value.overlays.offsets.title.y).toBe(-0.0004);
    expect(Object.is(value.renderSpec.title.offsetY, -0)).toBe(true);
  });

  it("parses an authoritative initial render spec without a document wrapper", () => {
    const value = validV4Document().renderSpec;
    expect(parseInitialEditorRenderSpec(value)).toEqual(value);

    const legacy = createEditorRenderSpec(validDocument(), undefined, 3);
    expect(parseInitialEditorRenderSpec(legacy)).toBeNull();

    const forged = structuredClone(value);
    forged.channel.font.sha256 = "0".repeat(64);
    expect(parseInitialEditorRenderSpec(forged)).toBeNull();
    expect(parseInitialEditorRenderSpec({ version: 4 })).toBeNull();
  });

  it("rejects forged v4 fonts, over-precision, and invalid Unicode runs", () => {
    const forgedFont = validV4Document();
    forgedFont.renderSpec.title.font.sha256 = "0".repeat(64);
    expect(() => editorDocumentSnapshotSchema.parse(forgedFont)).toThrow();

    const overPrecision = validV4Document();
    overPrecision.renderSpec.title.lineBoxes[0].centerY += 0.0001;
    expect(() => editorDocumentSnapshotSchema.parse(overPrecision)).toThrow();

    const invalidRun = validV4Document();
    invalidRun.renderSpec.title.lineBoxes[0].backgroundRuns = [{
      start: 0,
      end: Array.from(invalidRun.renderSpec.title.lineBoxes[0].text).length + 1,
      color: "#FFFFFF",
    }];
    expect(() => editorDocumentSnapshotSchema.parse(invalidRun)).toThrow();

    const missingBackgroundGeometry = validV4Document();
    const sealedText = missingBackgroundGeometry.renderSpec.title
      .lineBoxes[0].text;
    missingBackgroundGeometry.renderSpec.title.lineBoxes[0].backgroundRuns = [{
      start: 0,
      end: Math.min(1, Array.from(sealedText).length),
      color: "#FF715E",
    }];
    expect(() => editorDocumentSnapshotSchema.parse(missingBackgroundGeometry))
      .toThrow("v4 제목 배경은 확정 좌표를 모두 저장해야 합니다.");
  });

  it("rejects stale v4 title geometry after the semantic title changes", () => {
    const staleTitle = validV4Document();
    staleTitle.title.text = "바뀐 제목은 기존 줄 상자를 재사용할 수 없습니다";
    expect(() => editorDocumentSnapshotSchema.parse(staleTitle)).toThrow(
      "V4 렌더 사양이 편집 내용과 승인 폰트 목록에 일치해야 합니다.",
    );
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
