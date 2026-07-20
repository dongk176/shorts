import { videoAspectRatioOptions, type VideoAspectRatio } from "@/lib/contracts";
import { videoAspectRatioSelection } from "@/lib/video-aspect-ratio-selection";

export function VideoAspectRatioPicker({
  value,
  lockedValue,
  onChange,
}: {
  value: VideoAspectRatio;
  lockedValue?: VideoAspectRatio;
  onChange: (value: VideoAspectRatio) => void;
}) {
  const { locked, displayedValue } = videoAspectRatioSelection(value, lockedValue);
  const descriptionId = locked ? "custom-template-aspect-ratio-lock" : undefined;

  return (
    <fieldset className="min-w-0" aria-describedby={descriptionId}>
      <legend className="mb-2 text-xs font-semibold text-neutral-400">
        <span className="inline-flex items-center gap-2">
          <span>영상 비율</span>
          {locked && <span className="rounded-full border border-[#ff715e]/25 bg-[#ff715e]/10 px-2 py-0.5 text-[10px] font-bold text-[#ff9b8d]">템플릿에 고정</span>}
        </span>
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {videoAspectRatioOptions.map((option) => {
          const selected = displayedValue === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={locked}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${selected ? "border-red-500 bg-red-500/15 text-white" : "border-white/10 bg-[#141416] text-neutral-400 hover:border-white/30"} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10`}
            >
              <span>{option.label}</span><span className="ml-1 text-[10px] text-neutral-500">{option.value}</span>
            </button>
          );
        })}
      </div>
      {locked && <p id={descriptionId} className="mt-2 text-[11px] leading-5 text-neutral-500">내 템플릿에 저장된 {lockedValue} 비율로 생성됩니다.</p>}
    </fieldset>
  );
}
