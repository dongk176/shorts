import { z } from "zod";
import { entertainmentSchema } from "./midform-captions";

// Production admission stays off until the dedicated release has been verified.
export function midformCloudEnabled(env: Record<string, string | undefined> = process.env) {
  return env.MIDFORM_ENABLED === "true" && env.EASYCUT_ENVIRONMENT !== "lab"
    && z.string().uuid().safeParse(env.MIDFORM_RELEASE_ID).success;
}

export const midformRequestSchema = z.object({
  version: z.literal(1),
  targetSeconds: z.literal(0),
}).strict();

export const midformDraftSchema = z.object({
  rows: z.array(z.object({
    id: z.string().regex(/^\d+$/), start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(), text: z.string().max(2000),
    speaker: z.string().max(80), keep: z.boolean(),
  }).strict()).min(1).max(6000),
  framing: z.record(z.string().max(80), z.enum(["wide", "left", "center", "right"])),
  names: z.record(z.string().max(80), z.string().max(80)),
  removeSilence: z.literal(true),
  silencePreset: z.literal("aggressive").optional(),
  entertainment: entertainmentSchema.optional(),
}).strict();

// Client edits may change selection/captions, never the immutable source clock.
export function validateMidformDraft(value: unknown, sourceRows: unknown) {
  const draft = midformDraftSchema.parse(value);
  const source = midformDraftSchema.shape.rows.parse(sourceRows);
  if (source.length !== draft.rows.length || draft.rows.some((row, index) => {
    const original = source[index];
    return row.id !== original.id || row.start !== original.start
      || row.end !== original.end;
  })) throw new Error("편집 원본이 변경되었습니다. 영상을 다시 열어 주세요.");
  const known = new Set([...source.map(row => row.speaker), "unknown", "overlap"]);
  const custom = /^user_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (Object.keys(draft.names).filter(key => !known.has(key)).length > 64
    || draft.rows.some(row => !known.has(row.speaker) && !(custom.test(row.speaker)
      && Object.hasOwn(draft.names, row.speaker) && draft.names[row.speaker].trim()))) {
    throw new Error("화자 지정을 확인해 주세요.");
  }
  if (!draft.rows.some(row => row.keep)) throw new Error("남길 구간을 선택해 주세요.");
  const duration = Math.max(...source.map(row => row.end));
  if (draft.entertainment?.items.some(cue => cue.end > duration + .05)) {
    throw new Error("예능 자막이 영상 범위를 벗어났습니다.");
  }
  return draft;
}
