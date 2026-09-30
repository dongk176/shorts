import { z } from "zod";
import type { VideoAspectRatio } from "./contracts";

export const SNS_EDITOR_RELEASE_ID = "77d3b2de-12a4-4b7d-a134-87170b1d3ecf";
export const SNS_GENERATION_RELEASE_IDS = [
  "8dc98fc0-a5bb-411f-9cc6-0e8dc28648ca",
  "8af2c7e6-5421-4e93-9671-b0e8bb41de8a",
] as const;
export type SnsLanguage = "ko" | "en" | "ja";
export function snsCopyLimits(ratio: VideoAspectRatio, language: SnsLanguage) {
  const [title, body, tag] = { ko: [16, 18, 6], en: [26, 28, 12], ja: [13, 14, 6] }[language];
  return { title, body: ratio === "9:16" ? { ko: 13, en: 22, ja: 11 }[language] : body, tag,
    lines: ratio === "4:5" || ratio === "9:16" ? 1 : 2,
    tags: ratio === "16:9" || ratio === "5:4" ? 3 : 0 };
}
export function snsEditedSnapshotSchema(ratio: VideoAspectRatio, language: SnsLanguage) {
  const limits = snsCopyLimits(ratio, language);
  const line = (max: number) => z.string().trim().min(1).refine(value => !/[\r\n]/u.test(value) && [...value].length <= max,
    `한 줄에 ${max}자 이내로 입력해 주세요.`);
  return z.object({
    presetVersion: z.literal(4), snsTemplateVersion: z.literal(1),
    snsLanguage: z.literal(language), brandColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    snsContent: z.object({ title: line(limits.title), body: z.array(line(limits.body)).length(limits.lines),
      hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u).refine(t => [...t].length <= limits.tag + 1)).length(limits.tags)
        .refine(tags => new Set(tags).size === tags.length), source: z.literal("edited") }).strict(),
  }).strict();
}
