import { z } from "zod";
import {
  templateIds,
  videoAspectRatios,
} from "@/lib/contracts";
import {
  EDITOR_FONT_METRICS_REVISION,
  editorFontIds,
  resolveEditorFontFaceV4,
} from "@/lib/editor-fonts";
import {
  EDITOR_DOCUMENT_SNAPSHOT_VERSION,
  EDITOR_DOCUMENT_V3_VERSION,
} from "@/lib/editor-document-snapshot";
import {
  createEditorRenderSpec,
  EDITOR_RENDER_FPS,
  EDITOR_RENDER_SPEC_LEGACY_VERSION,
  EDITOR_RENDER_SPEC_SUBTITLE_LEGACY_VERSION,
  EDITOR_RENDER_SPEC_VERSION,
  EDITOR_RENDER_SPEC_V4_VERSION,
  EDITOR_SUBTITLE_OFFSET_Y_MAX,
  EDITOR_SUBTITLE_OFFSET_Y_MIN,
  EDITOR_SUBTITLE_SCALE_MAX,
  EDITOR_SUBTITLE_SCALE_MIN,
  isQuantizedEditorRenderPx,
  type EditorRenderSpec,
} from "@/lib/editor-render-spec";
import {
  stockBackgroundIds,
  textOverlayStyleSchema,
  templatePresetColors,
  TEMPLATE_CANVAS,
} from "@/lib/template-config";
import { wrapPreviewTitle } from "@/lib/title-preview";

export const EDITOR_DOCUMENT_MAX_TEXT_OVERLAYS = 20;
export const EDITOR_DOCUMENT_MAX_COMMENTS = 20;
export const EDITOR_DOCUMENT_MAX_VIDEO_CLIPS = 120;
export const EDITOR_DOCUMENT_MIN_OUTPUT_SECONDS = 1;
export const EDITOR_DOCUMENT_MIN_CLIP_SECONDS = 0.15;

const finiteNumber = z.number().finite();
const canvasX = finiteNumber.min(-TEMPLATE_CANVAS.width).max(TEMPLATE_CANVAS.width);
const canvasY = finiteNumber.min(-TEMPLATE_CANVAS.height).max(TEMPLATE_CANVAS.height);
const canvasPointSchema = z.object({
  x: canvasX,
  y: canvasY,
}).strict();
const commentCanvasPointSchema = z.object({
  x: z.literal(0),
  y: canvasY,
}).strict();
const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const safeIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9:_-]+$/);
const titleTextStyleSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  color: hexColorSchema.optional(),
  backgroundColor: hexColorSchema.optional(),
}).strict().refine((style) => style.end > style.start)
  .refine((style) => Boolean(style.color || style.backgroundColor));
const commentSchema = z.object({
  id: safeIdSchema,
  startSeconds: finiteNumber.nonnegative(),
  endSeconds: finiteNumber.positive(),
  text: z.string().trim().min(1).max(200),
  initial: z.string().trim().min(1).max(2),
  avatarColor: hexColorSchema,
  nickname: z.string().trim().min(1).max(30),
  likeCount: z.number().int().min(10).max(999_999),
  ageLabel: z.string().trim().min(1).max(20),
}).strict().refine((comment) => comment.endSeconds > comment.startSeconds);
const subtitleSchema = z.object({
  start: finiteNumber.nonnegative(),
  end: finiteNumber.positive(),
  text: z.string().trim().min(1).max(500),
}).strict().refine((subtitle) => subtitle.end > subtitle.start);
const editorTextOverlaySchema = textOverlayStyleSchema.extend({
  startSeconds: finiteNumber.nonnegative(),
  endSeconds: finiteNumber.positive(),
}).strict().refine((overlay) => overlay.endSeconds > overlay.startSeconds);
const videoClipSchema = z.object({
  id: safeIdSchema,
  sourceStartSeconds: finiteNumber.nonnegative(),
  sourceEndSeconds: finiteNumber.positive(),
}).strict().refine(
  (clip) => (
    clip.sourceEndSeconds - clip.sourceStartSeconds
    >= EDITOR_DOCUMENT_MIN_CLIP_SECONDS - 0.001
  ),
);
const layerOrderItemSchema = z.string().min(1).max(105).refine(
  (value) => (
    ["video", "title", "comment", "channel"].includes(value)
    || /^text:[A-Za-z0-9:_-]{1,100}$/.test(value)
  ),
);

const resolvedFontFaceSchema = z.object({
  fontId: z.enum(editorFontIds),
  fileId: z.string().min(1).max(100),
  family: z.string().min(1).max(200),
  requestedWeight: z.union([z.literal(700), z.literal(800)]),
  resolvedWeight: z.union([z.literal(400), z.literal(700), z.literal(800)]),
  variableWeight: z.union([z.literal(700), z.literal(800)]).nullable(),
}).strict();

const fixedPointPx = finiteNumber.refine(
  isQuantizedEditorRenderPx,
  "렌더 좌표는 0.001px 단위여야 합니다.",
);
const resolvedFontFaceV4Schema = resolvedFontFaceSchema.extend({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  metrics: z.object({
    revision: z.literal(EDITOR_FONT_METRICS_REVISION),
  }).strict(),
}).strict();

const renderFrameSchema = z.number().int().nonnegative();
const renderSpecBaseSchema = z.object({
  canvas: z.object({
    width: z.literal(TEMPLATE_CANVAS.width),
    height: z.literal(TEMPLATE_CANVAS.height),
  }).strict(),
  fps: z.literal(EDITOR_RENDER_FPS),
  layerOrder: z.array(layerOrderItemSchema).min(1).max(24),
  title: z.object({
    lines: z.array(z.string().max(80)).min(1).max(2),
    centerX: z.literal(540),
    offsetY: canvasY,
    fontSize: finiteNumber.min(18).max(200),
    scale: z.literal(1),
    font: resolvedFontFaceSchema,
  }).strict(),
  channel: z.object({
    offsetX: canvasX,
    offsetY: canvasY,
    scale: finiteNumber.min(0.5).max(2),
    font: resolvedFontFaceSchema,
  }).strict(),
  comments: z.array(z.object({
    id: safeIdSchema,
    offsetY: canvasY,
    startFrame: renderFrameSchema,
    endFrame: renderFrameSchema,
  }).strict().refine((item) => item.endFrame > item.startFrame)).max(20),
  textOverlays: z.array(z.object({
    id: safeIdSchema,
    lines: z.array(z.string().max(120)).min(1).max(20),
    centerX: finiteNumber.min(-TEMPLATE_CANVAS.width).max(TEMPLATE_CANVAS.width * 2),
    centerY: finiteNumber.min(-TEMPLATE_CANVAS.height).max(TEMPLATE_CANVAS.height * 2),
    width: finiteNumber.min(1).max(1_000),
    fontSize: z.literal(72),
    lineHeight: z.literal(86),
    scale: finiteNumber.min(0.25).max(3),
    color: z.enum(templatePresetColors),
    effect: z.enum(["none", "outline", "shadow"]),
    outlineWidth: z.union([z.literal(0), z.literal(10)]),
    shadowBlur: z.union([z.literal(0), z.literal(13)]),
    startFrame: renderFrameSchema,
    endFrame: renderFrameSchema,
    font: resolvedFontFaceSchema,
  }).strict().refine((item) => item.endFrame > item.startFrame)).max(20),
  video: z.object({
    offsetX: canvasX,
    offsetY: canvasY,
    scale: finiteNumber.min(0.1).max(5),
  }).strict(),
});
const renderSpecV1Schema = renderSpecBaseSchema.extend({
  version: z.literal(EDITOR_RENDER_SPEC_LEGACY_VERSION),
}).strict();
const renderSpecV2Schema = renderSpecBaseSchema.extend({
  version: z.literal(EDITOR_RENDER_SPEC_SUBTITLE_LEGACY_VERSION),
  subtitles: z.object({
    centerX: z.literal(540),
    offsetY: finiteNumber
      .min(EDITOR_SUBTITLE_OFFSET_Y_MIN)
      .max(EDITOR_SUBTITLE_OFFSET_Y_MAX),
    scale: finiteNumber
      .min(EDITOR_SUBTITLE_SCALE_MIN)
      .max(EDITOR_SUBTITLE_SCALE_MAX),
    fontId: z.enum(editorFontIds).optional(),
    accentColor: hexColorSchema.optional(),
    cueEdits: z.array(z.object({
      cueIndex: z.number().int().min(0).max(1_999),
      text: z.string().trim().min(1).max(200),
    }).strict()).max(2_000).optional(),
  }).strict(),
}).strict();
const renderSpecV3Schema = renderSpecBaseSchema.extend({
  version: z.literal(EDITOR_RENDER_SPEC_VERSION),
  subtitles: z.object({
    centerX: z.literal(540),
    offsetY: finiteNumber
      .min(EDITOR_SUBTITLE_OFFSET_Y_MIN)
      .max(EDITOR_SUBTITLE_OFFSET_Y_MAX),
    scale: finiteNumber
      .min(EDITOR_SUBTITLE_SCALE_MIN)
      .max(EDITOR_SUBTITLE_SCALE_MAX),
    fontId: z.enum(editorFontIds).optional(),
    fontSize: finiteNumber.min(24).max(120),
    color: hexColorSchema,
    accentColor: hexColorSchema.optional(),
    cueEdits: z.array(z.object({
      cueIndex: z.number().int().min(0).max(1_999),
      text: z.string().trim().min(1).max(200),
    }).strict()).max(2_000).optional(),
  }).strict(),
}).strict();
const renderTitleBackgroundRunV4Schema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  color: hexColorSchema,
  x: fixedPointPx.min(-TEMPLATE_CANVAS.width).max(TEMPLATE_CANVAS.width * 2).optional(),
  y: fixedPointPx.min(-TEMPLATE_CANVAS.height).max(TEMPLATE_CANVAS.height * 2).optional(),
  width: fixedPointPx.positive().max(TEMPLATE_CANVAS.width * 2).optional(),
  height: fixedPointPx.positive().max(TEMPLATE_CANVAS.height * 2).optional(),
  radius: fixedPointPx.min(0).max(200).optional(),
}).strict().superRefine((run, context) => {
  if (run.end <= run.start) {
    context.addIssue({ code: "custom", message: "제목 배경 범위가 올바르지 않습니다." });
  }
  const geometry = [run.x, run.y, run.width, run.height, run.radius];
  if (geometry.some((value) => value !== undefined)
    && geometry.some((value) => value === undefined)) {
    context.addIssue({ code: "custom", message: "제목 배경 좌표가 완전하지 않습니다." });
  }
});
const renderTitleLineBoxV4Schema = z.object({
  text: z.string().max(80),
  centerX: fixedPointPx.min(-TEMPLATE_CANVAS.width).max(TEMPLATE_CANVAS.width * 2),
  centerY: fixedPointPx.min(-TEMPLATE_CANVAS.height).max(TEMPLATE_CANVAS.height * 2),
  width: fixedPointPx.positive().max(TEMPLATE_CANVAS.width),
  height: fixedPointPx.positive().max(TEMPLATE_CANVAS.height),
  baselineY: fixedPointPx.min(-TEMPLATE_CANVAS.height).max(TEMPLATE_CANVAS.height * 2),
  backgroundRuns: z.array(renderTitleBackgroundRunV4Schema).max(80),
}).strict().superRefine((line, context) => {
  const characterCount = Array.from(line.text).length;
  line.backgroundRuns.forEach((run, index) => {
    if (run.end > characterCount) {
      context.addIssue({
        code: "custom",
        path: ["backgroundRuns", index, "end"],
        message: "제목 배경 범위가 줄의 Unicode 문자 범위를 넘을 수 없습니다.",
      });
    }
    if (index > 0 && run.start < line.backgroundRuns[index - 1].end) {
      context.addIssue({
        code: "custom",
        path: ["backgroundRuns", index, "start"],
        message: "제목 배경 범위는 서로 겹칠 수 없습니다.",
      });
    }
  });
});
const renderTitleV4Schema = z.object({
  visible: z.boolean(),
  lines: z.array(z.string().max(80)).min(1).max(2),
  centerX: fixedPointPx.min(-TEMPLATE_CANVAS.width).max(TEMPLATE_CANVAS.width * 2),
  centerY: fixedPointPx.min(-TEMPLATE_CANVAS.height).max(TEMPLATE_CANVAS.height * 2),
  offsetY: fixedPointPx.min(-TEMPLATE_CANVAS.height).max(TEMPLATE_CANVAS.height),
  fontSize: fixedPointPx.min(18).max(200),
  scale: z.literal(1),
  lineGap: fixedPointPx.min(0).max(400),
  linePaddingX: fixedPointPx.min(0).max(400),
  linePaddingY: fixedPointPx.min(0).max(400),
  clamp: z.object({
    minX: fixedPointPx.min(-TEMPLATE_CANVAS.width).max(TEMPLATE_CANVAS.width),
    maxX: fixedPointPx.min(0).max(TEMPLATE_CANVAS.width * 2),
    minY: fixedPointPx.min(-TEMPLATE_CANVAS.height).max(TEMPLATE_CANVAS.height),
    maxY: fixedPointPx.min(0).max(TEMPLATE_CANVAS.height * 2),
  }).strict(),
  lineBoxes: z.array(renderTitleLineBoxV4Schema).min(1).max(2),
  font: resolvedFontFaceV4Schema,
}).strict().superRefine((title, context) => {
  if (
    title.clamp.minX > title.clamp.maxX
    || title.clamp.minY > title.clamp.maxY
    || title.centerX < title.clamp.minX
    || title.centerX > title.clamp.maxX
    || title.centerY < title.clamp.minY
    || title.centerY > title.clamp.maxY
  ) {
    context.addIssue({
      code: "custom",
      path: ["clamp"],
      message: "제목 중심점은 렌더 경계 안에 있어야 합니다.",
    });
  }
  if (
    title.lineBoxes.length !== title.lines.length
    || title.lineBoxes.some((line, index) => (
      line.text !== title.lines[index]
      || line.centerX !== title.centerX
      || line.centerX - line.width / 2 < title.clamp.minX - 0.001
      || line.centerX + line.width / 2 > title.clamp.maxX + 0.001
      || line.centerY - line.height / 2 < title.clamp.minY - 0.001
      || line.centerY + line.height / 2 > title.clamp.maxY + 0.001
      || line.baselineY < line.centerY - line.height / 2
      || line.baselineY > line.centerY + line.height / 2
    ))
  ) {
    context.addIssue({
      code: "custom",
      path: ["lineBoxes"],
      message: "제목 줄 상자는 확정 줄과 렌더 경계에 정확히 맞아야 합니다.",
    });
  }
  if (title.lineBoxes.some((line) => line.backgroundRuns.some((run) => (
    [run.x, run.y, run.width, run.height, run.radius]
      .some((value) => value === undefined)
  )))) {
    context.addIssue({
      code: "custom",
      path: ["lineBoxes"],
      message: "v4 제목 배경은 확정 좌표를 모두 저장해야 합니다.",
    });
  }
});
const renderSpecV4Schema = renderSpecBaseSchema.omit({
  title: true,
  channel: true,
  textOverlays: true,
}).extend({
  version: z.literal(EDITOR_RENDER_SPEC_V4_VERSION),
  title: renderTitleV4Schema,
  channel: renderSpecBaseSchema.shape.channel.extend({
    visible: z.boolean(),
    font: resolvedFontFaceV4Schema,
  }).strict(),
  textOverlays: z.array(
    renderSpecBaseSchema.shape.textOverlays.element.safeExtend({
      font: resolvedFontFaceV4Schema,
    }).strict(),
  ).max(20),
  subtitles: renderSpecV3Schema.shape.subtitles.extend({
    visible: z.literal(true),
    captionSpecVersion: z.literal(4),
  }).strict().optional(),
}).strict();
const renderSpecSchema = z.discriminatedUnion("version", [
  renderSpecV1Schema,
  renderSpecV2Schema,
  renderSpecV3Schema,
  renderSpecV4Schema,
]);

export function parseInitialEditorRenderSpec(
  value: unknown,
): EditorRenderSpec | null {
  const parsed = renderSpecSchema.safeParse(value);
  if (!parsed.success) return null;
  const renderSpec = parsed.data as EditorRenderSpec;
  if (renderSpec.version !== EDITOR_RENDER_SPEC_V4_VERSION) {
    return null;
  }
  const titleFont = resolveEditorFontFaceV4(
    renderSpec.title.font.fontId,
    "title",
  );
  const channelFont = resolveEditorFontFaceV4(
    renderSpec.channel.font.fontId,
    "channel",
  );
  if (
    !editorJsonValuesEqual(renderSpec.title.font, titleFont)
    || !editorJsonValuesEqual(renderSpec.channel.font, channelFont)
    || renderSpec.textOverlays.some((overlay) => (
      !editorJsonValuesEqual(
        overlay.font,
        resolveEditorFontFaceV4(overlay.font.fontId, "text"),
      )
    ))
  ) {
    return null;
  }
  return renderSpec;
}

const editorDocumentSnapshotBaseSchema = z.object({
  version: z.literal(EDITOR_DOCUMENT_SNAPSHOT_VERSION),
  sourceShortId: z.string().uuid(),
  baseRenderVersion: z.number().int().nonnegative(),
  template: z.object({
    id: z.enum(templateIds),
    customTemplateId: z.string().uuid().nullable(),
    presetVersion: z.number().int().min(0).max(100),
    snapshot: z.record(z.string(), z.json()).nullable(),
  }).strict(),
  title: z.object({
    text: z.string().trim().min(1).max(80)
      .refine((value) => value.split("\n").length <= 2),
    textStyles: z.array(titleTextStyleSchema).max(80),
    fontScale: finiteNumber.min(0.5).max(2),
  }).strict(),
  channel: z.object({
    displayName: z.string().trim().min(1).max(50),
    thumbnailUrl: z.string().max(400_000).nullable(),
    thumbnailAssetKey: z.string()
      .regex(/^edit-sources\/[A-Za-z0-9/_-]+\/editor-assets\/[A-Za-z0-9_-]+\.(?:png|jpg|webp)$/)
      .nullable(),
  }).strict().refine(
    (channel) => !(channel.thumbnailUrl && channel.thumbnailAssetKey),
    "채널 이미지는 URL과 저장 자산 중 하나만 사용할 수 있습니다.",
  ),
  comments: z.array(commentSchema).max(EDITOR_DOCUMENT_MAX_COMMENTS),
  subtitles: z.object({
    enabled: z.boolean(),
    segments: z.array(subtitleSchema).max(2_000),
  }).strict(),
  overlays: z.object({
    offsets: z.object({
      video: canvasPointSchema,
      title: canvasPointSchema,
      comment: commentCanvasPointSchema,
      channel: canvasPointSchema,
    }).strict(),
    commentOffsets: z.record(safeIdSchema, commentCanvasPointSchema),
    scales: z.object({
      video: finiteNumber.min(0.1).max(5),
      title: finiteNumber.min(0.5).max(2),
      channel: finiteNumber.min(0.5).max(2),
    }).strict(),
    fonts: z.object({
      title: z.enum(editorFontIds),
      channel: z.enum(editorFontIds),
    }).strict(),
    visible: z.object({
      video: z.literal(true),
      title: z.boolean(),
      comment: z.boolean(),
      channel: z.boolean(),
    }).strict(),
    commentTheme: z.enum(["dark", "light"]).nullable(),
    textOverlays: z.array(editorTextOverlaySchema)
      .max(EDITOR_DOCUMENT_MAX_TEXT_OVERLAYS),
    layerOrder: z.array(layerOrderItemSchema)
      .min(1)
      .max(4 + EDITOR_DOCUMENT_MAX_TEXT_OVERLAYS),
    background: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("color"),
        color: z.enum(templatePresetColors),
      }).strict(),
      z.object({
        kind: z.literal("image"),
        assetId: z.enum(stockBackgroundIds),
      }).strict(),
      z.object({
        kind: z.literal("uploaded_image"),
        assetId: z.string().uuid().transform((id) => id.toLowerCase()),
      }).strict(),
    ]).nullable(),
  }).strict(),
  video: z.object({
    clips: z.array(videoClipSchema)
      .min(1)
      .max(EDITOR_DOCUMENT_MAX_VIDEO_CLIPS),
    aspectRatio: z.enum(videoAspectRatios),
    timelineStartSeconds: finiteNumber.nonnegative(),
    timelineEndSeconds: finiteNumber.positive(),
    selectionStartSeconds: finiteNumber.nonnegative(),
    selectionEndSeconds: finiteNumber.positive(),
  }).strict(),
}).strict();

const editorDocumentV3BaseSchema = editorDocumentSnapshotBaseSchema.extend({
  version: z.literal(EDITOR_DOCUMENT_V3_VERSION),
  renderSpec: renderSpecSchema,
}).strict();

type EditorDocumentSnapshotShape = z.infer<
  typeof editorDocumentSnapshotBaseSchema | typeof editorDocumentV3BaseSchema
>;

function editorJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => (
        editorJsonValuesEqual(value, right[index])
      ));
  }
  if (
    left === null
    || right === null
    || typeof left !== "object"
    || typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && editorJsonValuesEqual(leftRecord[key], rightRecord[key])
    ));
}

function validateEditorDocumentSnapshot(
  document: EditorDocumentSnapshotShape,
  context: z.RefinementCtx,
  timedOverlaysMustFitOutput: boolean,
) {
  const titleLength = Array.from(document.title.text).length;
  const titleStyles = [...document.title.textStyles]
    .sort((left, right) => left.start - right.start);
  if (titleStyles.some((style) => style.end > titleLength)) {
    context.addIssue({
      code: "custom",
      path: ["title", "textStyles"],
      message: "제목 스타일 범위가 제목 길이를 넘을 수 없습니다.",
    });
  }
  if (titleStyles.some(
    (style, index) => index > 0 && style.start < titleStyles[index - 1].end,
  )) {
    context.addIssue({
      code: "custom",
      path: ["title", "textStyles"],
      message: "제목 스타일 범위가 서로 겹칠 수 없습니다.",
    });
  }

  const timelineDuration = (
    document.video.timelineEndSeconds - document.video.timelineStartSeconds
  );
  if (timelineDuration <= 0) {
    context.addIssue({
      code: "custom",
      path: ["video", "timelineEndSeconds"],
      message: "편집 타임라인 범위가 올바르지 않습니다.",
    });
  }
  let outputDuration = 0;
  document.video.clips.forEach((clip, index) => {
    if (clip.sourceEndSeconds > timelineDuration + 0.001) {
      context.addIssue({
        code: "custom",
        path: ["video", "clips", index],
        message: "영상 조각이 편집 타임라인을 벗어났습니다.",
      });
    }
    if (
      index > 0
      && clip.sourceStartSeconds
        < document.video.clips[index - 1].sourceEndSeconds - 0.001
    ) {
      context.addIssue({
        code: "custom",
        path: ["video", "clips", index],
        message: "영상 조각의 원본 구간이 서로 겹칠 수 없습니다.",
      });
    }
    outputDuration += clip.sourceEndSeconds - clip.sourceStartSeconds;
  });
  if (outputDuration < EDITOR_DOCUMENT_MIN_OUTPUT_SECONDS - 0.001) {
    context.addIssue({
      code: "custom",
      path: ["video", "clips"],
      message: `최종 영상은 ${EDITOR_DOCUMENT_MIN_OUTPUT_SECONDS}초 이상이어야 합니다.`,
    });
  }
  const firstClip = document.video.clips[0];
  const lastClip = document.video.clips.at(-1);
  if (
    document.video.selectionEndSeconds
      <= document.video.selectionStartSeconds
    || document.video.selectionStartSeconds
      < document.video.timelineStartSeconds - 0.001
    || document.video.selectionEndSeconds
      > document.video.timelineEndSeconds + 0.001
    || (
      firstClip
      && Math.abs(
        document.video.selectionStartSeconds
        - document.video.timelineStartSeconds
        - firstClip.sourceStartSeconds,
      ) > 0.051
    )
    || (
      lastClip
      && Math.abs(
        document.video.selectionEndSeconds
        - document.video.timelineStartSeconds
        - lastClip.sourceEndSeconds,
      ) > 0.051
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["video", "selectionStartSeconds"],
      message: "영상 선택 범위가 영상 조각과 일치하지 않습니다.",
    });
  }
  if (document.subtitles.segments.some(
    (segment) => segment.end > timelineDuration + 0.001,
  )) {
    context.addIssue({
      code: "custom",
      path: ["subtitles", "segments"],
      message: "자막 구간이 편집 타임라인을 벗어났습니다.",
    });
  }

  const orderedComments = [...document.comments]
    .sort((left, right) => left.startSeconds - right.startSeconds);
  if (
    new Set(document.comments.map((comment) => comment.id)).size
      !== document.comments.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["comments"],
      message: "댓글 식별자는 중복될 수 없습니다.",
    });
  }
  if (timedOverlaysMustFitOutput && orderedComments.some(
    (comment) => comment.endSeconds > outputDuration + 0.001,
  )) {
    context.addIssue({
      code: "custom",
      path: ["comments"],
      message: "댓글 노출 구간이 최종 영상 길이를 넘을 수 없습니다.",
    });
  }
  if (orderedComments.some(
    (comment, index) => (
      index > 0
      && comment.startSeconds < orderedComments[index - 1].endSeconds - 0.001
    ),
  )) {
    context.addIssue({
      code: "custom",
      path: ["comments"],
      message: "댓글 노출 구간이 서로 겹칠 수 없습니다.",
    });
  }

  const commentIds = new Set(document.comments.map((comment) => comment.id));
  for (const commentId of Object.keys(document.overlays.commentOffsets)) {
    if (!commentIds.has(commentId)) {
      context.addIssue({
        code: "custom",
        path: ["overlays", "commentOffsets", commentId],
        message: "삭제된 댓글의 위치 정보가 남아 있습니다.",
      });
    }
  }
  const textIds = new Set(
    document.overlays.textOverlays.map((overlay) => overlay.id),
  );
  if (textIds.size !== document.overlays.textOverlays.length) {
    context.addIssue({
      code: "custom",
      path: ["overlays", "textOverlays"],
      message: "텍스트 식별자는 중복될 수 없습니다.",
    });
  }
  if (timedOverlaysMustFitOutput && document.overlays.textOverlays.some(
    (overlay) => overlay.endSeconds > outputDuration + 0.001,
  )) {
    context.addIssue({
      code: "custom",
      path: ["overlays", "textOverlays"],
      message: "텍스트 노출 구간이 최종 영상 길이를 넘을 수 없습니다.",
    });
  }
  const expectedLayers = new Set([
    "video",
    "title",
    "comment",
    "channel",
    ...[...textIds].map((id) => `text:${id}`),
  ]);
  const layerOrder = document.overlays.layerOrder;
  if (
    new Set(layerOrder).size !== layerOrder.length
    || layerOrder.some((layer) => !expectedLayers.has(layer))
    || [...expectedLayers].some((layer) => !layerOrder.includes(layer))
  ) {
    context.addIssue({
      code: "custom",
      path: ["overlays", "layerOrder"],
      message: "레이어 순서가 현재 오버레이와 일치하지 않습니다.",
    });
  }
  if (document.version === EDITOR_DOCUMENT_V3_VERSION) {
    if (document.renderSpec.version === EDITOR_RENDER_SPEC_V4_VERSION) {
      const v4 = document.renderSpec;
      const canonicalTitleLines = wrapPreviewTitle(document.title.text);
      const expectedTitleFont = resolveEditorFontFaceV4(
        document.overlays.fonts.title,
        "title",
      );
      const expectedChannelFont = resolveEditorFontFaceV4(
        document.overlays.fonts.channel,
        "channel",
      );
      const exactTextFonts = document.overlays.textOverlays.map((overlay) => (
        resolveEditorFontFaceV4(overlay.fontId, "text")
      ));
      if (
        v4.title.visible !== document.overlays.visible.title
        || v4.title.lines.length !== canonicalTitleLines.length
        || v4.title.lines.some((line, index) => (
          line !== canonicalTitleLines[index]
        ))
        || v4.channel.visible !== document.overlays.visible.channel
        || Boolean(v4.subtitles) !== document.subtitles.enabled
        || !editorJsonValuesEqual(v4.title.font, expectedTitleFont)
        || !editorJsonValuesEqual(v4.channel.font, expectedChannelFont)
        || v4.textOverlays.length !== exactTextFonts.length
        || v4.textOverlays.some((overlay, index) => (
          !editorJsonValuesEqual(overlay.font, exactTextFonts[index])
          || overlay.id !== document.overlays.textOverlays[index]?.id
        ))
      ) {
        context.addIssue({
          code: "custom",
          path: ["renderSpec"],
          message: "V4 렌더 사양이 편집 내용과 승인 폰트 목록에 일치해야 합니다.",
        });
      }
    } else {
      const canonical = createEditorRenderSpec(
        document,
        undefined,
        document.renderSpec.version,
      );
      if (!editorJsonValuesEqual(document.renderSpec, canonical)) {
        context.addIssue({
          code: "custom",
          path: ["renderSpec"],
          message: "미리보기 렌더 사양이 편집 내용과 일치하지 않습니다.",
        });
      }
    }
  }
}

const editorDraftDocumentV2Schema =
  editorDocumentSnapshotBaseSchema.superRefine((document, context) => {
    validateEditorDocumentSnapshot(document, context, false);
  });
const editorDraftDocumentV3Schema =
  editorDocumentV3BaseSchema.superRefine((document, context) => {
    validateEditorDocumentSnapshot(document, context, false);
  });
export const editorDraftDocumentSnapshotSchema = z.union([
  editorDraftDocumentV2Schema,
  editorDraftDocumentV3Schema,
]);

const editorDocumentV2Schema =
  editorDocumentSnapshotBaseSchema.superRefine((document, context) => {
    validateEditorDocumentSnapshot(document, context, true);
  });
const editorDocumentV3Schema =
  editorDocumentV3BaseSchema.superRefine((document, context) => {
    validateEditorDocumentSnapshot(document, context, true);
    // Old drafts retain raw drag coordinates; only submitted documents must
    // match the worker's exact comparison with the fixed-point render spec.
    if (
      document.renderSpec.version === EDITOR_RENDER_SPEC_V4_VERSION
      && document.renderSpec.title.offsetY !== document.overlays.offsets.title.y
    ) {
      context.addIssue({
        code: "custom",
        path: ["renderSpec", "title", "offsetY"],
        message: "제목 위치가 렌더 사양과 일치해야 합니다.",
      });
    }
  });
export const editorDocumentSnapshotSchema = z.union([
  editorDocumentV2Schema,
  editorDocumentV3Schema,
]);

export type ValidatedEditorDocumentSnapshot = z.infer<
  typeof editorDocumentSnapshotSchema
>;

export function editorDocumentOutputDuration(
  document: Pick<ValidatedEditorDocumentSnapshot, "video">,
) {
  return Math.round(document.video.clips.reduce(
    (duration, clip) => (
      duration + clip.sourceEndSeconds - clip.sourceStartSeconds
    ),
    0,
  ) * 1_000) / 1_000;
}
