import { z } from "zod";

export const entertainmentStyles = {
  title: { label: "큰 제목", font: "Editor V3 Black Han Sans", size: 86, color: "#ffffff", angle: 0 },
  comic: { label: "코믹 강조", font: "Editor V3 Jua", size: 90, color: "#ffe568", angle: -3 },
  reaction: { label: "반응", font: "Editor V3 Jua", size: 86, color: "#ff83b5", angle: -3 },
  label: { label: "상황 설명", font: "Editor V3 Do Hyeon", size: 70, color: "#ffe568", angle: 0 },
  challenge: { label: "도전", font: "Editor V3 Galmuri 9", size: 55, color: "#73e6ff", angle: 0 },
  punchline: { label: "반전 강조", font: "Editor V3 Black Han Sans", size: 82, color: "#ffffff", angle: 0 },
} as const;
const plain = (max: number) => z.string().max(max).refine(value => !/[\x00-\x1f\x7f{}\\]/.test(value), "일반 문자로 입력해 주세요.");
export const entertainmentCaptionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  start: z.number().finite().nonnegative(), end: z.number().finite().positive(),
  text: plain(24).refine(text => Boolean(text.trim()), "자막 내용을 입력해 주세요."),
  kicker: plain(16), style: z.enum(["title", "comic", "reaction", "label", "challenge", "punchline"]),
  x: z.number().finite().min(.15).max(.85), y: z.number().finite().min(.2).max(.75),
  scale: z.number().finite().min(.65).max(1.25), enabled: z.boolean(),
}).strict().refine(cue => cue.end - cue.start >= .4 && cue.end - cue.start <= 6, "자막 표시 시간은 0.4~6초입니다.");
export const entertainmentSchema = z.object({
  enabled: z.boolean(), items: z.array(entertainmentCaptionSchema).max(40),
  mode: z.enum(["ai", "basic", "manual"]),
}).strict().superRefine((value, context) => {
  const active = value.items.filter(cue => cue.enabled).sort((a, b) => a.start - b.start);
  if (new Set(value.items.map(cue => cue.id)).size !== value.items.length
    || active.some((cue, index) => index > 0 && cue.start < active[index - 1].end)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "자막 식별자 또는 표시 시간이 겹칩니다." });
  }
});
export type EntertainmentCaption = z.infer<typeof entertainmentCaptionSchema>;
export type EntertainmentCaptions = z.infer<typeof entertainmentSchema>;
export const emptyEntertainment: EntertainmentCaptions = { enabled: false, items: [], mode: "manual" };

// A removed anchor removes its caption; a cut truncates it rather than repeating it.
export function visibleEntertainment(captions: EntertainmentCaptions | undefined,
  ranges: { start: number; end: number }[], position: number) {
  if (!captions?.enabled) return undefined;
  return captions.items.find(cue => {
    const range = ranges.find(r => r.start <= cue.start && cue.start < r.end);
    return cue.enabled && range && Math.min(cue.end, range.end) - cue.start >= .4
      && position >= cue.start && position < Math.min(cue.end, range.end);
  });
}
