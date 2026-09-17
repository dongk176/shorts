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
    ? "Subtitle translation is incomplete. This Short plays and downloads without subtitles. You can still edit the video, title and comments."
    : locale === "ja"
      ? "字幕の翻訳が完了していないため、この動画は字幕なしで再生・ダウンロードされます。動画・タイトル・コメントは編集できます。"
      : "자막 번역이 완료되지 않아 이 쇼츠는 자막 없이 재생·다운로드됩니다. 영상·제목·댓글은 편집할 수 있습니다.";
  if (outcome?.partial) return locale === "en"
    ? "Some subtitles could not be translated. Completed subtitles are kept and can be edited."
    : locale === "ja"
      ? "一部の字幕を翻訳できませんでした。翻訳済みの字幕は保持され、編集できます。"
      : "일부 자막을 번역하지 못했습니다. 완료된 자막은 유지되며 편집할 수 있습니다.";
  if (outcome?.contextLimited) return locale === "en"
    ? "The selected clip's subtitles are translated. Translation outside this clip is incomplete, so you can edit within the current clip only."
    : locale === "ja"
      ? "選択区間の字幕は翻訳済みです。前後の翻訳が未完了のため、現在の動画区間内で編集できます。"
      : "현재 쇼츠의 자막은 번역됐습니다. 앞뒤 여유 구간의 번역이 완료되지 않아 현재 영상 구간 안에서 편집할 수 있습니다.";
  return null;
}
