"use client";
import { useI18n } from "@/lib/i18n/provider";
import { savedVideoCopy } from "@/lib/saved-videos";

export function BookmarkIcon({ filled = false }: { filled?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" /></svg>;
}
export function SaveVideoButton({ saved, busy, disabled, title, onClick }: {
  saved: boolean; busy: boolean; disabled?: boolean; title: string; onClick: () => void;
}) {
  const { locale } = useI18n();
  const copy = savedVideoCopy[locale];
  return <button type="button" aria-pressed={saved} aria-label={`${saved ? copy.remove : copy.save}: ${title}`} disabled={busy || disabled}
    onClick={event => { event.stopPropagation(); onClick(); }}
    className={`relative z-30 inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:cursor-wait disabled:opacity-50 ${saved ? "border-violet-300/40 bg-violet-400/15 text-violet-200" : "border-white/15 bg-[#202326] text-neutral-200 hover:border-violet-300/50 hover:text-white"}`}>
    <BookmarkIcon filled={saved} />{busy ? saved ? copy.removing : copy.saving : saved ? copy.saved : copy.save}
  </button>;
}
