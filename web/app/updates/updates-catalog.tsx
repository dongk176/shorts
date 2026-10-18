"use client";
import { UPDATE_PAGE_SIZE } from "./pagination";
import { useState } from "react";
import Link from "next/link";
import { updateKinds, displayDate, type UpdatePost } from "./data";
import { UpdateCover } from "./update-cover";
import type { SiteLocale } from "@/lib/i18n/config";
import { localizedHref } from "@/lib/i18n/routing";
import { updateCopy, updateKind } from "./copy";
import styles from "./updates.module.css";
function PostMeta({ post, locale }: {
    post: UpdatePost; locale: SiteLocale;
}) { return <div className={styles.meta}><time dateTime={post.date}>{displayDate(post.date)}</time><span className={styles.tag} data-kind={post.kind}>{updateKind(post.kind, locale)}</span></div>; }
export function UpdatesCatalog({ updates, page = 1, totalPages = 1, locale = "ko" }: { updates: UpdatePost[]; page?: number; totalPages?: number; locale?: SiteLocale }) {
    const c = updateCopy(locale);
    const href = (path: string) => localizedHref(path, locale);
    const [category, setCategory] = useState("전체");
    const [month, setMonth] = useState("전체 기간");
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(8);
    const filtered = updates.filter(p => (category === "전체" || p.kind === category) && (month === "전체 기간" || p.date.startsWith(month)) && `${p.title} ${p.summary} ${p.topic} ${p.changes.join(" ")} ${(p.blocks ?? []).flatMap(b => b.type === "text" ? b.paragraphs : b.type === "steps" ? b.items : []).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
    const isDefault = category === "전체" && month === "전체 기간" && !query.trim();
    const featured = isDefault && page === 1 ? filtered[0] : null;
    const cards = isDefault ? filtered.slice(1) : filtered;
    const visibleCards = isDefault ? cards.slice((page - 1) * UPDATE_PAGE_SIZE, page * UPDATE_PAGE_SIZE) : cards.slice(0, limit);
    return <section className={styles.catalog} aria-label={c.list}>
  <div className={styles.filters}><div className={styles.tabs} aria-label={c.categories}>{updateKinds.map(kind => <button key={kind} type="button" aria-pressed={category === kind} onClick={() => { setCategory(kind); setLimit(8); }}>{updateKind(kind, locale)}{kind === "전체" ? <span>{updates.length}</span> : null}</button>)}</div><div className={styles.tools}><label className={styles.search}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" aria-label={c.search} placeholder={c.search} value={query} onChange={e => { setQuery(e.target.value); setLimit(8); }}/></label><select aria-label={c.month} value={month} onChange={e => { setMonth(e.target.value); setLimit(8); }}><option value="전체 기간">{c.allTime}</option>{[...new Set(updates.map(p => p.date.slice(0, 7)))].sort().reverse().map(m => <option key={m} value={m}>{c.monthLabel(m)}</option>)}</select></div></div>
  {!isDefault ? <p className={styles.resultCount} role="status">{c.count(filtered.length)}{query.trim() ? ` · “${query.trim()}”` : ""}</p> : null}
  {featured ? <Link className={styles.featured} href={href(`/updates/${featured.slug}`)} prefetch={false}><UpdateCover post={featured} priority/><div className={styles.featuredCopy}><span className={styles.latest}><i />{c.latest}</span><h2>{featured.title}</h2><p>{featured.summary}</p><span className={styles.readStory}>{c.read} <span>↗</span></span><PostMeta post={featured} locale={locale}/></div></Link> : null}
  <div className={styles.grid}>{visibleCards.map((post, index) => <article key={post.slug} className={styles.card}><Link href={href(`/updates/${post.slug}`)} prefetch={false}><UpdateCover post={post} priority={!featured && index < 2}/><div className={styles.cardCopy}><span className={styles.topic}>{post.topic}</span><h2>{post.title}<span aria-hidden="true">↗</span></h2><p>{post.summary}</p><PostMeta post={post} locale={locale}/></div></Link></article>)}</div>
  {!filtered.length ? <div className={styles.empty}><h2>{c.empty}</h2><p>{c.emptyHelp}</p><button onClick={() => { setQuery(""); setCategory("전체"); setMonth("전체 기간"); }}>{c.showAll}</button></div> : null}
  {!isDefault && cards.length > limit ? <button className={styles.loadMore} type="button" onClick={() => setLimit(n => n + 8)}>{c.older} <span>{cards.length - limit}</span><span aria-hidden="true">↓</span></button> : null}
  {isDefault && totalPages > 1 ? <nav aria-label={c.pages} className="flex items-center justify-center gap-4">
    {page > 1 ? <Link className={styles.loadMore} href={href(page === 2 ? "/updates" : `/updates?page=${page - 1}`)}>← {c.newer}</Link> : null}
    <span className="mt-8 text-sm text-neutral-400">{page} / {totalPages}</span>
    {page < totalPages ? <Link className={styles.loadMore} href={href(`/updates?page=${page + 1}`)}>{c.older} ↓</Link> : null}
  </nav> : null}
 </section>;
}
