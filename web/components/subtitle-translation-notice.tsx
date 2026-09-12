import type { SubtitleTranslationOutcome } from "@/lib/subtitle-translation-outcome";
import { subtitleTranslationNotice } from "@/lib/subtitle-translation-outcome";

export function SubtitleTranslationNotice({ outcome, locale }: {
  outcome?: SubtitleTranslationOutcome | null; locale: string;
}) {
  const message = subtitleTranslationNotice(outcome, locale);
  return message ? <p role="status" data-subtitle-translation-warning
    className="my-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
    {message}
  </p> : null;
}
