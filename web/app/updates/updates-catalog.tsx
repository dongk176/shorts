"use client";
import { UPDATE_PAGE_SIZE } from "./pagination";
import { useState } from "react";
import Link from "next/link";
import { updates, updateKinds, displayDate, type UpdatePost } from "./data";
import { UpdateCover } from "./update-cover";
import styles from "./updates.module.css";
function PostMeta({ post }: {
    post: UpdatePost;
}) { return <div className={styles.meta}><time dateTime={post.date}>{displayDate(post.date)}</time><span className={styles.tag} data-kind={post.kind}>{post.kind}</span></div>; }
export function UpdatesCatalog({ page = 1, totalPages = 1 }: { page?: number; totalPages?: number }) {
    const [category, setCategory] = useState("전체");
    const [month, setMonth] = useState("전체 기간");
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(8);
    const filtered = updates.filter(p => (category === "전체" || p.kind === category) && (month === "전체 기간" || p.date.startsWith(month)) && `${p.title} ${p.summary} ${p.topic} ${p.changes.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
    const isDefault = category === "전체" && month === "전체 기간" && !query.trim();
    const featured = isDefault && page === 1 ? filtered[0] : null;
    const cards = isDefault ? filtered.slice(1) : filtered;
    const visibleCards = isDefault ? cards.slice((page - 1) * UPDATE_PAGE_SIZE, page * UPDATE_PAGE_SIZE) : cards.slice(0, limit);
    return <section className={styles.catalog} aria-label="업데이트 목록">
  <div className={styles.filters}><div className={styles.tabs} aria-label="업데이트 분류">{updateKinds.map(kind => <button key={kind} type="button" aria-pressed={category === kind} onClick={() => { setCategory(kind); setLimit(8); }}>{kind}{kind === "전체" ? <span>{updates.length}</span> : null}</button>)}</div><div className={styles.tools}><label className={styles.search}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" aria-label="업데이트 검색" placeholder="업데이트 검색" value={query} onChange={e => { setQuery(e.target.value); setLimit(8); }}/></label><select aria-label="업데이트 월" value={month} onChange={e => { setMonth(e.target.value); setLimit(8); }}><option>전체 기간</option><option value="2026-09">2026년 9월</option><option value="2026-08">2026년 8월</option><option value="2026-07">2026년 7월</option></select></div></div>
  {!isDefault ? <p className={styles.resultCount} role="status">{filtered.length}개의 업데이트{query.trim() ? ` · “${query.trim()}”` : ""}</p> : null}
  {featured ? <Link className={styles.featured} href={`/updates/${featured.slug}`} prefetch={false}><UpdateCover post={featured} priority/><div className={styles.featuredCopy}><span className={styles.latest}><i />최근 업데이트</span><h2>{featured.title}</h2><p>{featured.summary}</p><span className={styles.readStory}>업데이트 살펴보기 <span>↗</span></span><PostMeta post={featured}/></div></Link> : null}
  <div className={styles.grid}>{visibleCards.map((post, index) => <article key={post.slug} className={styles.card}><Link href={`/updates/${post.slug}`} prefetch={false}><UpdateCover post={post} priority={!featured && index < 2}/><div className={styles.cardCopy}><span className={styles.topic}>{post.topic}</span><h2>{post.title}<span aria-hidden="true">↗</span></h2><p>{post.summary}</p><PostMeta post={post}/></div></Link></article>)}</div>
  {!filtered.length ? <div className={styles.empty}><h2>아직 맞는 소식이 없어요.</h2><p>다른 검색어를 입력하거나 필터를 바꿔보세요.</p><button onClick={() => { setQuery(""); setCategory("전체"); setMonth("전체 기간"); }}>전체 업데이트 보기</button></div> : null}
  {!isDefault && cards.length > limit ? <button className={styles.loadMore} type="button" onClick={() => setLimit(n => n + 8)}>이전 업데이트 더 보기 <span>{cards.length - limit}</span><span aria-hidden="true">↓</span></button> : null}
  {isDefault && totalPages > 1 ? <nav aria-label="업데이트 페이지" className="flex items-center justify-center gap-4">
    {page > 1 ? <Link className={styles.loadMore} href={page === 2 ? "/updates" : `/updates?page=${page - 1}`}>← 최신 업데이트</Link> : null}
    <span className="mt-8 text-sm text-neutral-400">{page} / {totalPages}</span>
    {page < totalPages ? <Link className={styles.loadMore} href={`/updates?page=${page + 1}`}>이전 업데이트 더 보기 ↓</Link> : null}
  </nav> : null}
 </section>;
}
