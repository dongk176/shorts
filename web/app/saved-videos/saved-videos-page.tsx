"use client";
import { useState } from "react";
import Link from "@/lib/i18n/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { AuthControls } from "@/components/auth-controls";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { BookmarkIcon, SaveVideoButton } from "@/components/save-video-button";
import { savedVideoCopy } from "@/lib/saved-videos";
import { useSavedVideos } from "@/lib/use-saved-videos";
import type { AuthProfile } from "@/lib/session";
import { VideoCard } from "../실시간인기/popular-videos-explorer";

export function SavedVideosPage({ user }: { user: AuthProfile | null }) {
  const { locale } = useI18n();
  const copy = savedVideoCopy[locale];
  const [loginOpen, setLoginOpen] = useState(false);
  const saved = useSavedVideos(Boolean(user), () => setLoginOpen(true), user?.id);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(48);
  const [active, setActive] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = saved.items.filter(item => !normalizedQuery || `${item.video?.title || ""} ${item.video?.channelName || ""}`.toLocaleLowerCase().includes(normalizedQuery));
  const primary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-violet-500";
  return <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen overflow-visible text-neutral-100">
    <SiteHeader desktopSidebar><AuthControls user={user} next="/saved-videos" loginOpen={loginOpen} onLoginOpenChange={setLoginOpen} /></SiteHeader>
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-5 sm:px-8 sm:pt-7">
      <header className="mb-6 md:pr-36"><div className="flex items-center gap-3 text-violet-200"><BookmarkIcon filled /><h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{copy.title}</h1></div><p className="mt-3 text-sm leading-6 text-neutral-400">{copy.description}</p></header>
      <div role="status" className="sr-only">{saved.notice}</div>
      {saved.error && <p role="alert" className="fixed bottom-20 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-xl border border-red-300/30 bg-[#321c22] p-4 text-sm text-red-100 shadow-xl sm:max-w-sm">{saved.error}</p>}
      {!user ? <section className="rounded-2xl border border-white/10 bg-white/[.025] px-5 py-16 text-center"><div className="mb-5 flex justify-center text-violet-300"><BookmarkIcon /></div><h2 className="text-xl font-bold">{copy.loginTitle}</h2><p className="mx-auto mb-6 mt-3 max-w-md text-sm leading-6 text-neutral-400">{copy.loginHint}</p><button type="button" onClick={() => setLoginOpen(true)} className={primary}>{copy.login}</button></section>
        : saved.loading ? <p role="status" className="py-16 text-center text-neutral-400">{copy.loading}</p>
        : saved.loadError ? <section role="alert" className="rounded-2xl border border-white/10 p-8 text-center"><p>{copy.error}</p><button type="button" className={`${primary} mt-5`} onClick={() => void saved.reload()}>{copy.retry}</button></section>
        : saved.items.length === 0 ? <section className="rounded-2xl border border-white/10 bg-white/[.025] px-5 py-16 text-center"><div className="mb-5 flex justify-center text-violet-300"><BookmarkIcon /></div><h2 className="text-xl font-bold">{copy.empty}</h2><p className="mb-6 mt-3 text-sm leading-6 text-neutral-400">{copy.emptyHint}</p><Link href="/popular" className={primary}>{copy.browse} →</Link></section>
        : <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold text-neutral-300">{copy.count(saved.items.length)}</p><Link href="/popular" className="inline-flex min-h-11 items-center text-sm font-semibold text-violet-200 hover:text-white">{copy.browse} ↗</Link></div>
          <label className="mb-6 block"><span className="sr-only">{copy.search}</span><input type="search" value={query} onChange={e => { setQuery(e.target.value); setShown(48); }} placeholder={copy.search} className="min-h-12 w-full rounded-xl border border-white/15 bg-[#191c1e] px-4 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-violet-300" /></label>
          {filtered.length === 0 ? <div className="py-12 text-center"><p>{copy.noResults}</p><button type="button" className="mt-3 min-h-11 px-3 text-violet-200 underline" onClick={() => setQuery("")}>{copy.clear}</button></div>
            : <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.slice(0,shown).map((item,index) => {
              const saveAction = <SaveVideoButton title={item.video?.title || copy.unavailable} saved busy={saved.pending.has(item.video?.videoId || item.id)} onClick={() => void saved.mutate(item.video,item)} />;
              return item.video ? <VideoCard key={item.id} video={item.video} rank={index+1} searching active={active===item.id} onOpen={() => setActive(item.id)} onClose={() => setActive(null)} saveAction={saveAction} />
                : <article key={item.id} className="flex min-h-64 flex-col rounded-2xl border border-white/10 bg-[#191c1e]/90 p-5"><div className="mb-5 text-neutral-500"><BookmarkIcon /></div><h2 className="font-bold">{copy.unavailable}</h2><p className="mb-6 mt-3 text-sm leading-6 text-neutral-400">{copy.unavailableHint}</p><div className="mt-auto flex justify-end">{saveAction}</div></article>;
            })}</div>}
          {filtered.length > shown && <div className="mt-8 text-center"><button type="button" className="min-h-12 rounded-xl border border-white/20 px-8 text-sm font-bold hover:bg-white/5" onClick={() => setShown(n=>n+48)}>{copy.more}</button></div>}
        </>}
    </main><SiteFooter />
  </div>;
}
