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
  const label = busy ? saved ? copy.removing : copy.saving : saved ? copy.remove : copy.save;
  return <button type="button" aria-pressed={saved} aria-busy={busy} aria-label={`${label}: ${title}`} title={label} disabled={busy || disabled}
    onClick={event => { event.stopPropagation(); onClick(); }}
    className={`relative z-30 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:cursor-wait disabled:opacity-60 ${saved ? "border-violet-200/50 bg-violet-600/90 text-white hover:bg-violet-500" : "border-white/25 bg-black/65 text-white hover:border-white/50 hover:bg-black/85"}`}>
    {busy ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] motion-safe:animate-spin" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" opacity=".25" /><path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" /></svg> : <BookmarkIcon filled={saved} />}
  </button>;
}
