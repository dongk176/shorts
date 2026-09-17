import { z } from "zod";

const outcomeSchema = z.object({
  policy: z.literal("translated-basic-v1"),
  status: z.enum(["ready", "unavailable"]),
  contextLimited: z.boolean(),
  partial: z.boolean().optional(),
}).strip();
export type SubtitleTranslationOutcome = z.infer<typeof outcomeSchema>;

export function subtitleTranslationOutcome(snapshot: unknown): SubtitleTranslationOutcome | null {
  const result = outcomeSchema.safeParse(
    snapshot && typeof snapshot === "object" && "translationOutcome" in snapshot
      ? snapshot.translationOutcome : null,
  );
  return result.success ? result.data : null;
}

export function subtitleTranslationNotice(outcome: SubtitleTranslationOutcome | null | undefined, locale: string): string | null {
  if (outcome?.status === "unavailable") return locale === "en"
    ? "Translation is incomplete for this clip. You can still play, download and edit the video, title and comments."
    : locale === "ja"
      ? "この区間の翻訳は未完了です。動画の再生・ダウンロード、動画・タイトル・コメントの編集は利用できます。"
      : "이 구간의 번역이 완료되지 않았습니다. 영상 재생·다운로드와 영상·제목·댓글 편집은 이용할 수 있습니다.";
  if (outcome?.partial) return locale === "en"
    ? "Some sections could not be translated. Completed translations are kept and can be edited."
    : locale === "ja"
      ? "一部の区間を翻訳できませんでした。翻訳済みの内容は保持され、編集できます。"
      : "일부 구간을 번역하지 못했습니다. 번역된 내용은 유지되며 편집할 수 있습니다.";
  if (outcome?.contextLimited) return locale === "en"
    ? "Some translation outside this clip is missing. Completed translations are kept."
    : locale === "ja"
      ? "前後の区間の翻訳が一部未完了です。翻訳済みの内容は保持されます。"
      : "앞뒤 구간의 번역이 일부 누락됐습니다. 번역된 내용은 유지됩니다.";
  return null;
}
