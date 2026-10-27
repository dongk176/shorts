"use client";

import { useEffect, useRef, useState } from "react";
import { useNavigationLocale } from "@/lib/i18n/provider";
import { sortRankingExamples, type RankingExample as Example } from "@/lib/ranking-examples";
import { useRankingBackdrop } from "./use-ranking-backdrop";
import { RankingSelect } from "./ranking-select";
import "./ranking-examples.css";

type Catalog = { checkedAt: string; items: Example[] };
function views(value: number) { return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value); }

export function RankingExamples() {
  const locale = useNavigationLocale();
  const backdrop = useRankingBackdrop(close);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("views");
  const [selected, setSelected] = useState<Example | null>(null);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; };
  }, [open]);
  useEffect(() => {
    if (!open || catalog) return;
    const controller = new AbortController();
    setError("");
    void fetch("/api/ranking-shorts/examples", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("예시를 불러오지 못했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.");
        return response.json() as Promise<Catalog>;
      }).then(setCatalog).catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "예시를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [open, catalog, retry]);
  function close() { dialog.current?.close(); setOpen(false); setSelected(null); trigger.current?.focus(); }
  const search = query.trim().toLocaleLowerCase();
  const items = sortRankingExamples((catalog?.items ?? []).filter((item) => (category === "all" || item.category === category) && `${item.title} ${item.channel} ${item.category}`.toLocaleLowerCase().includes(search)), locale, sort);
  return <>
    <button ref={trigger} type="button" className="ranking-examples-trigger" onClick={() => setOpen(true)}><span className="ranking-examples-icon" aria-hidden="true"><svg viewBox="0 0 20 20" width="18" height="18"><path d="m7 4 9 6-9 6Z" fill="currentColor"/></svg></span><span>예시 보기</span><svg className="ranking-examples-arrow" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
    {open && <dialog ref={dialog} className="ranking-examples-dialog" aria-labelledby="ranking-examples-title" onCancel={(event) => { event.preventDefault(); if (selected) setSelected(null); else close(); }} {...backdrop}>
      <div className="ranking-examples-panel">
        <header className="ranking-examples-header"><div><h2 id="ranking-examples-title">랭킹 쇼츠 예시</h2><p>{catalog ? `${catalog.items.length}개의 레퍼런스 · 조회수 ${catalog.checkedAt} 기준` : "다양한 랭킹 쇼츠를 살펴보세요"}</p></div><button type="button" className="ranking-examples-close" aria-label="예시 보기 닫기" onClick={close}>×</button></header>
        {selected ? <div className="ranking-example-detail">
          <button type="button" className="ranking-example-back" onClick={() => setSelected(null)}>← 목록으로</button>
          <div className="ranking-example-watch"><iframe key={selected.id} title={selected.title} src={`https://www.youtube.com/embed/${selected.id}?autoplay=1&playsinline=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /><div><span className="ranking-example-category">{selected.category}</span><h3>{selected.title}</h3><p>{selected.channel}</p><p>조회수 {selected.views.toLocaleString("ko-KR")}회 · {selected.publishedAt}</p><p>조회수 {selected.checkedAt ?? catalog?.checkedAt} 기준</p><a href={selected.url} target="_blank" rel="noopener noreferrer">YouTube에서 보기 ↗</a><p className="ranking-example-note">재생이 제한된 영상은 YouTube에서 확인해 주세요.</p></div></div>
        </div> : <>
          <div className="ranking-examples-tools"><label className="ranking-examples-search"><span className="sr-only">예시 제목·채널·소재 검색</span><input placeholder="제목·채널·소재 검색" value={query} onChange={(event) => setQuery(event.target.value)} /></label><RankingSelect label="예시 소재" value={category} onChange={setCategory} options={[{value:"all",label:"전체 소재"}, ...Array.from(new Set(catalog?.items.map(item => item.category) ?? [])).sort().map(value => ({value,label:value}))]} /><RankingSelect label="예시 정렬" value={sort} onChange={setSort} options={[{value:"views",label:"조회수순"},{value:"recent",label:"최신순"}]} /></div>
          <div className="ranking-examples-scroll">
            {error ? <div role="alert" className="ranking-examples-empty"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button></div> : !catalog ? <p className="ranking-examples-empty" role="status">예시를 불러오는 중…</p> : <>
              <p className="ranking-examples-count" aria-live="polite">{items.length}개 영상{locale === "ko" ? " · 한국어 영상 먼저" : ""}</p>
              {items.length ? <div className="ranking-examples-grid">{items.map(item => <article key={item.id} className="ranking-example-card"><button type="button" className="ranking-example-thumbnail" aria-label={`${item.title} 재생`} onClick={() => setSelected(item)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" /><span className="ranking-example-play" aria-hidden="true">▶</span><span className="ranking-example-duration">{Math.floor(item.duration / 60)}:{String(item.duration % 60).padStart(2,"0")}</span>
              </button><div className="ranking-example-info"><span className="ranking-example-category">{item.category}</span><button type="button" className="ranking-example-title" onClick={() => setSelected(item)}>{item.title}</button><p>{item.channel}</p><div className="ranking-example-stats"><strong>조회수 {views(item.views)}회</strong><span>{item.publishedAt}</span></div></div></article>)}</div> : <div className="ranking-examples-empty"><p>검색 결과가 없습니다.</p><button type="button" onClick={() => {setQuery("");setCategory("all");}}>검색 초기화</button></div>}
            </>}
          </div>
        </>}
      </div>
    </dialog>}
  </>;
}
