import { createElement } from "react";
import type { SiteLocale } from "@/lib/i18n/config";

const messages: Record<SiteLocale, string> = {
  ko: "편집 적용에 실패했습니다. 기존 영상은 유지됩니다. ‘편집하기’에서 내용을 확인한 뒤 다시 적용해 주세요.",
  en: "Your edits could not be applied. The previous video is still available. Open the editor, review your edits, and try applying them again.",
  ja: "編集を適用できませんでした。元の動画は保持されています。編集画面で内容を確認し、もう一度適用してください。",
};

export function EditorApplyFailureNotice({
  failed,
  locale,
}: {
  failed: boolean;
  locale: SiteLocale;
}) {
  if (!failed) return null;

  return createElement(
    "p",
    {
      role: "alert",
      "data-i18n-skip": true,
      className: "mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-amber-200",
    },
    messages[locale],
  );
}
