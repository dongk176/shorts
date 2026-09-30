"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";
export function TemplateFavoriteButton({
  active,
  busy,
  templateName,
  onClick,
}: {
  active: boolean;
  busy: boolean;
  templateName: string;
  onClick: () => void;
}) {
  const ui = useUiText();
  return (
    <button
      type="button"
      aria-label={`${templateName} · ${ui(active ? "즐겨찾기 해제" : "즐겨찾기 추가")}`}
      aria-pressed={active}
      disabled={busy}
      onClick={onClick}
      className={`absolute right-5 top-5 z-20 flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[13px] font-extrabold shadow-[0_8px_24px_rgba(0,0,0,.38)] backdrop-blur-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff8c7c] disabled:cursor-wait disabled:opacity-60 ${
        active
          ? "border-[#ff8c7c]/70 bg-[#ff715e] text-white hover:bg-[#ff836f]"
          : "border-white/20 bg-black/70 text-white hover:border-white/40 hover:bg-black/85"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 4.75A1.75 1.75 0 0 1 8.5 3h7A1.75 1.75 0 0 1 17.25 4.75V21L12 17.5 6.75 21V4.75Z" />
      </svg>
      <span>{ui(busy ? "변경 중" : "즐겨찾기")}</span>
    </button>
  );
}
