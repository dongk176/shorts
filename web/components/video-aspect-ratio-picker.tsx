"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";
import { useNavigationLocale } from "@/lib/i18n/provider";
import { aspectRatioName } from "@/lib/i18n/product";
import { videoAspectRatioOptions, type VideoAspectRatio } from "@/lib/contracts";
import { videoAspectRatioSelection } from "@/lib/video-aspect-ratio-selection";

export function VideoAspectRatioPicker({
  value,
  lockedValue,
  disabledValues = [],
  disabledReason,
  onChange,
}: {
  value: VideoAspectRatio;
  lockedValue?: VideoAspectRatio;
  disabledValues?: VideoAspectRatio[];
  disabledReason?: string;
  onChange: (value: VideoAspectRatio) => void;
}) {
  const ui = useUiText();
  const locale = useNavigationLocale();
  const { locked, displayedValue } = videoAspectRatioSelection(value, lockedValue);
  const descriptionId = locked
    ? "custom-template-aspect-ratio-lock"
    : disabledReason
      ? "preset-template-aspect-ratio-restriction"
      : undefined;

  return (
    <fieldset className="min-w-0" aria-describedby={descriptionId}>
      <legend className="sr-only">{ui("영상 비율")}</legend>
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-[72px] shrink-0 text-xs font-semibold text-neutral-400">{ui("영상 비율")}</span>
        <div className="flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {videoAspectRatioOptions.map((option) => {
            const selected = displayedValue === option.value;
            const disabled = locked || disabledValues.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                aria-label={aspectRatioName(option.value, locale).includes(option.value) ? aspectRatioName(option.value, locale) : `${aspectRatioName(option.value, locale)} ${option.value}`}
                aria-pressed={selected}
                onClick={() => onChange(option.value)}
                className={`shrink-0 rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${selected ? "border-red-500 bg-red-500/15 text-white" : "border-white/10 bg-[#141416] text-neutral-400 hover:border-white/30"} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10`}
              >
                {option.value}
              </button>
            );
          })}
        </div>
        {locked && <span className="shrink-0 rounded-full border border-[#ff715e]/25 bg-[#ff715e]/10 px-2 py-0.5 text-[10px] font-bold text-[#ff9b8d]">{ui("템플릿에 고정")}</span>}
      </div>
      {locked && <p id={descriptionId} className="mt-2 text-[11px] leading-5 text-neutral-500">{locale === "ko" ? `내 템플릿에 저장된 ${lockedValue} 비율로 생성됩니다.` : locale === "en" ? `Your template uses the saved ${lockedValue} aspect ratio.` : `マイテンプレートに保存された${lockedValue}の比率で作成されます。`}</p>}
      {!locked && disabledReason && <p id={descriptionId} className="mt-2 text-[11px] leading-5 text-neutral-500">{disabledReason}</p>}
    </fieldset>
  );
}
