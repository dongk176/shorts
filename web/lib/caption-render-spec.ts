import { z } from "zod";
import {
  DEFAULT_EDITOR_FONT_ID,
  editorFontIds,
} from "./editor-fonts";

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

const compiledCaptionRenderSpecSchema = z.object({
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

export const captionRenderSpecSchema = compiledCaptionRenderSpecSchema.extend({
  editorSource: z.object({
    timelineStartSeconds: finiteNumber.nonnegative(),
    timelineEndSeconds: finiteNumber.positive(),
    spec: compiledCaptionRenderSpecSchema,
  }).strict().refine(
    (source) => source.timelineEndSeconds > source.timelineStartSeconds,
  ).optional(),
}).strip();

export type CaptionRenderSpec = z.infer<typeof captionRenderSpecSchema>;
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
