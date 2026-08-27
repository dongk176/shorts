import { z } from "zod";
import {
  DEFAULT_EDITOR_FONT_ID,
  EDITOR_FONT_METRICS_REVISION,
  editorCaptionCssToAssBaselineOffsetEmById,
  editorCaptionCssToAssScaleById,
  editorFontIds,
  resolveEditorFontFaceV4,
} from "./editor-fonts";
import { isQuantizedEditorRenderPx } from "./editor-render-spec";

// libass renders Pretendard's ASS `fs` smaller than browsers render the same
// numeric CSS font-size. This measured calibration keeps the V3 editor preview
// phrase bounds aligned to FFmpeg while both renderers shape normal spaces.
export const CAPTION_ASS_PREVIEW_FONT_SCALE = 0.84 as const;

const finiteNumber = z.number().finite();
const frame = z.number().int().nonnegative();
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

const captionWordSchema = z.object({
  text: z.string().min(1).max(200),
  startFrame: frame.optional(),
  endFrame: frame.optional(),
  speechStartFrame: frame.optional(),
  speechEndFrame: frame.optional(),
  spaceBefore: z.boolean().optional(),
  fontSize: finiteNumber.min(16).max(300).optional(),
  centerX: finiteNumber.min(-1_080).max(2_160).optional(),
  centerY: finiteNumber.min(-1_920).max(3_840).optional(),
  maxScale: finiteNumber.min(50).max(300).optional(),
}).strip();

const captionPositionSchema = z.object({
  centerX: finiteNumber.min(-1_080).max(2_160),
  centerY: finiteNumber.min(-1_920).max(3_840),
}).strict();

const captionEventSchema = z.object({
  startFrame: frame,
  endFrame: frame,
  activeWordIndex: z.number().int().nonnegative().optional(),
  positions: z.array(captionPositionSchema).max(20).optional(),
}).strip().refine((event) => event.endFrame > event.startFrame);

const captionCueSchema = z.object({
  sourceCueIndex: z.number().int().nonnegative().optional(),
  startFrame: frame,
  endFrame: frame,
  fontSize: finiteNumber.min(16).max(300).optional(),
  scaleX: finiteNumber.min(20).max(200).optional(),
  centerX: finiteNumber.min(-1_080).max(2_160).optional(),
  centerY: finiteNumber.min(-1_920).max(3_840).optional(),
  wordSeparator: z.string().max(4).optional(),
  words: z.array(captionWordSchema).min(1).max(20),
  lines: z.array(z.array(z.number().int().nonnegative()).max(20)).max(4).optional(),
  easeFrames: z.number().int().min(0).max(30).optional(),
  events: z.array(captionEventSchema).min(1).max(200),
}).strip().refine((cue) => cue.endFrame > cue.startFrame);

const captionRectSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
  width: finiteNumber.positive(),
  height: finiteNumber.positive(),
}).strict();

export const LEGACY_CAPTION_FONT_SNAPSHOT = {
  fontId: DEFAULT_EDITOR_FONT_ID,
  fileId: "Pretendard-Bold.woff2",
  sha256: "4609c3356e536fafe38f4add0daeceb3d8595d3057bce13c428c33ddbd43d362",
  family: "Pretendard",
  weight: 700,
} as const;

const captionFontSchema = z.object({
  fontId: z.enum(editorFontIds).optional(),
  fileId: z.string().min(1).max(100),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  family: z.string().min(1).max(200),
  weight: z.number().int().min(100).max(900),
}).strip().transform((font) => ({
  ...font,
  fontId: font.fontId ?? DEFAULT_EDITOR_FONT_ID,
}));

const fixedPointPx = finiteNumber.refine(
  isQuantizedEditorRenderPx,
  "Caption coordinates must use 0.001px fixed-point values.",
);
const captionFontV4Schema = z.object({
  fontId: z.enum(editorFontIds),
  fileId: z.string().min(1).max(100),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  family: z.string().min(1).max(200),
  weight: z.number().int().min(100).max(900),
  metrics: z.object({
    revision: z.literal(EDITOR_FONT_METRICS_REVISION),
    cssToAssScale: finiteNumber.min(0.5).max(1.5).refine(
      (value) => Math.abs(value * 1_000_000 - Math.round(value * 1_000_000))
        < 0.000_001,
      "Caption font scale must use six-decimal fixed point.",
    ),
    cssToAssBaselineOffsetEm: finiteNumber.min(-0.25).max(0.25).refine(
      (value) => Math.abs(value * 1_000_000 - Math.round(value * 1_000_000))
        < 0.000_001,
      "Caption baseline offset must use six-decimal fixed point.",
    ),
  }).strict(),
}).strict();

const compiledCaptionRenderSpecV3Schema = z.object({
  schemaVersion: z.literal(3),
  templateId: z.enum(["pop", "highlight"]),
  captionPlacement: z.enum(["lower", "center"]),
  fps: z.literal(30),
  timingLeadFrames: z.number().int().min(0).max(30).optional(),
  safeArea: captionRectSchema,
  font: captionFontSchema.default(LEGACY_CAPTION_FONT_SNAPSHOT),
  style: z.object({
    fontSize: finiteNumber.min(16).max(300),
    textColor: color,
    accentColor: color,
    outlineColor: color,
    outlineWidth: finiteNumber.min(0).max(30),
  }).strip(),
  cues: z.array(captionCueSchema).min(1).max(2_000),
}).strip();

const captionRenderSpecV3Schema = compiledCaptionRenderSpecV3Schema.extend({
  editorSource: z.object({
    timelineStartSeconds: finiteNumber.nonnegative(),
    timelineEndSeconds: finiteNumber.positive(),
    spec: compiledCaptionRenderSpecV3Schema,
  }).strict().refine(
    (source) => source.timelineEndSeconds > source.timelineStartSeconds,
  ).optional(),
}).strip();

const captionPositionV4Schema = z.object({
  centerX: fixedPointPx.min(-1_080).max(2_160),
  centerY: fixedPointPx.min(-1_920).max(3_840),
  advanceWidth: fixedPointPx.positive().max(2_160),
  gapBefore: z.union([z.literal(0), z.literal(6)]),
}).strict();

const captionEventV4Schema = z.object({
  startFrame: frame,
  endFrame: frame,
  activeWordIndex: z.number().int().nonnegative().optional(),
  positions: z.array(captionPositionV4Schema).min(1).max(20).optional(),
}).strict().refine((event) => event.endFrame > event.startFrame);

const captionCueV4Schema = z.object({
  sourceCueIndex: z.number().int().nonnegative().optional(),
  startFrame: frame,
  endFrame: frame,
  fontSize: finiteNumber.min(16).max(300).optional(),
  scaleX: finiteNumber.min(20).max(200).optional(),
  centerX: fixedPointPx.min(-1_080).max(2_160).optional(),
  centerY: fixedPointPx.min(-1_920).max(3_840).optional(),
  wordSeparator: z.string().max(4).optional(),
  separatorAdvanceWidth: fixedPointPx.positive().max(300).optional(),
  words: z.array(captionWordSchema).min(1).max(20),
  lines: z.array(z.array(z.number().int().nonnegative()).max(20)).max(4).optional(),
  easeFrames: z.number().int().min(0).max(30).optional(),
  events: z.array(captionEventV4Schema).min(1).max(200),
}).strict().refine((cue) => cue.endFrame > cue.startFrame);

const compiledCaptionRenderSpecV4Schema = z.object({
  schemaVersion: z.literal(4),
  templateId: z.enum(["pop", "highlight"]),
  layoutMode: z.literal("absolute-word-positions-v1"),
  wordGapPx: z.literal(6),
  joinedWordGapPx: z.literal(0),
  captionPlacement: z.enum(["lower", "center"]),
  fps: z.literal(30),
  clipStartSeconds: finiteNumber.nonnegative().optional(),
  clipEndSeconds: finiteNumber.positive().optional(),
  timingLeadFrames: z.number().int().min(0).max(30).optional(),
  layout: z.record(z.string(), z.json()).optional(),
  safeArea: captionRectSchema,
  font: captionFontV4Schema,
  style: z.object({
    fontSize: finiteNumber.min(16).max(300),
    textColor: color,
    accentColor: color,
    outlineColor: color,
    outlineWidth: finiteNumber.min(0).max(30),
    shadow: finiteNumber.min(0).max(30).optional(),
    background: color.nullable().optional(),
    maxLines: z.number().int().min(1).max(4).optional(),
  }).strict(),
  cues: z.array(captionCueV4Schema).min(1).max(2_000),
}).strict().refine(
  (spec) => spec.clipStartSeconds == null
    || spec.clipEndSeconds == null
    || spec.clipEndSeconds > spec.clipStartSeconds,
  "Caption clip range must be increasing.",
);

const captionRenderSpecV4Schema = compiledCaptionRenderSpecV4Schema.extend({
  editorSource: z.object({
    timelineStartSeconds: finiteNumber.nonnegative(),
    timelineEndSeconds: finiteNumber.positive(),
    spec: compiledCaptionRenderSpecV4Schema,
  }).strict().refine(
    (source) => source.timelineEndSeconds > source.timelineStartSeconds,
  ).optional(),
}).strict().superRefine((spec, context) => {
  const expectedFace = resolveEditorFontFaceV4(spec.font.fontId, "title");
  if (
    spec.font.fileId !== expectedFace.fileId
    || spec.font.sha256 !== expectedFace.sha256
    || spec.font.family !== expectedFace.family
    || spec.font.weight !== expectedFace.resolvedWeight
    || spec.font.metrics.revision !== expectedFace.metrics.revision
    || spec.font.metrics.cssToAssScale
      !== editorCaptionCssToAssScaleById[spec.font.fontId]
    || spec.font.metrics.cssToAssBaselineOffsetEm
      !== editorCaptionCssToAssBaselineOffsetEmById[spec.font.fontId]
  ) {
    context.addIssue({
      code: "custom",
      path: ["font"],
      message: "Caption font metadata must match the approved font manifest.",
    });
  }
  if (spec.templateId === "highlight") {
    spec.cues.forEach((cue, cueIndex) => {
      if (cue.separatorAdvanceWidth == null) {
        context.addIssue({
          code: "custom",
          path: ["cues", cueIndex, "separatorAdvanceWidth"],
          message: "V4 highlight captions require an exact separator advance.",
        });
      }
    });
    return;
  }
  spec.cues.forEach((cue, cueIndex) => {
    cue.events.forEach((event, eventIndex) => {
      if (
        event.activeWordIndex == null
        || event.activeWordIndex >= cue.words.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["cues", cueIndex, "events", eventIndex, "activeWordIndex"],
          message: "Pop caption events require a valid active word.",
        });
      }
      if (event.positions?.length !== cue.words.length) {
        context.addIssue({
          code: "custom",
          path: ["cues", cueIndex, "events", eventIndex, "positions"],
          message: "Every pop caption word requires one absolute position.",
        });
        return;
      }
      event.positions.forEach((position, wordIndex) => {
        const expectedGap = wordIndex === 0
          ? 0
          : cue.words[wordIndex].spaceBefore ? 6 : 0;
        if (position.gapBefore !== expectedGap) {
          context.addIssue({
            code: "custom",
            path: [
              "cues",
              cueIndex,
              "events",
              eventIndex,
              "positions",
              wordIndex,
              "gapBefore",
            ],
            message: "Pop caption gaps must use the canonical 6px/0px contract.",
          });
        }
      });
    });
  });
});

export const captionRenderSpecSchema = z.union([
  captionRenderSpecV3Schema,
  captionRenderSpecV4Schema,
]);

export type CaptionRenderSpec = z.infer<typeof captionRenderSpecSchema>;
export type CaptionRenderSpecV4 = Extract<
  CaptionRenderSpec,
  { schemaVersion: 4 }
>;
export type CaptionRenderCue = CaptionRenderSpec["cues"][number];
export type CaptionRenderEvent = CaptionRenderCue["events"][number];

export function parseCaptionRenderSpec(value: unknown): CaptionRenderSpec | null {
  const parsed = captionRenderSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function captionRenderSpecForEditor(
  spec: CaptionRenderSpec,
): CaptionRenderSpec {
  return spec.editorSource?.spec || spec;
}
