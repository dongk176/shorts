"use client";
import Link from "next/link";
import { YoutubeLaunchGuideReplay } from "@/components/youtube-launch-guide";
import { displayDate, type UpdatePost } from "./data";
import { AnnotatedScreen } from "./annotated-screen";
import { UpdateCover } from "./update-cover";
import { UpdateBlocks } from "./update-blocks";
import type { SiteLocale } from "@/lib/i18n/config";
import { localizedHref } from "@/lib/i18n/routing";
import { updateCopy, updateKind } from "./copy";
import styles from "./updates.module.css";
export function UpdateArticleView({ post, related = [], locale = "ko" }: { post: UpdatePost; related?: UpdatePost[]; locale?: SiteLocale }) {
    const c = updateCopy(locale); const href = (path: string) => localizedHref(path, locale);
    return <article id="updates-main" className={styles.articleMain}>
  <Link href={href("/updates")} className={styles.back}>← {c.back}</Link>
  <header className={styles.articleHeader}><div className={styles.articleLabels}><span className={styles.tag} data-kind={post.kind}>{updateKind(post.kind, locale)}</span><span>{post.topic}</span></div><h1>{post.title}</h1><p>{post.summary}</p><div className={styles.meta}><span className={styles.authorMark}>e</span><span>{c.team}</span><span>·</span><time dateTime={post.date}>{displayDate(post.date)}</time><span>·</span><span>{c.minutes(post.readingMinutes)}</span></div></header>
  <div className={styles.articleCover}><UpdateCover post={post} priority/></div>
  <div className={styles.articleBody}>
    {post.blocks ? <UpdateBlocks blocks={post.blocks} locale={locale}/> : <>
    <section><p className={styles.eyebrow}>{c.changes}</p><h2>{c.changed}</h2>{post.changes.map((change, i) => <p key={change}>{i === 0 ? <strong>{change}</strong> : change}</p>)}</section>
    <section><h2>{c.screen}</h2><p>{c.screenHelp}</p><AnnotatedScreen image={post.image} shot={post.shot} locale={locale}/>{post.slug === "saved-videos" ? <AnnotatedScreen image="saved-empty" locale={locale}/> : null}</section>
    {post.slug === "channel-connections" ? <YoutubeLaunchGuideReplay locale={locale}/> : null}
    <section className={styles.steps}><p className={styles.eyebrow}>{c.how}</p><h2>{c.try}</h2><ol>{post.steps.map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol><a className={styles.cta} href={`https://www.easycut.co.kr${href(post.href)}`} target="_blank" rel="noreferrer">{c.open} <span>↗</span></a><small>{c.newTab}</small></section>
    </>}
    <p className={styles.articleNote}>{c.note(displayDate(post.date))}</p>
  </div>
  {related.length ? <section className={styles.related}><h2>{c.related}</h2><div className={styles.grid}>{related.map(item => <Link href={href(`/updates/${item.slug}`)} key={item.slug} prefetch={false}><UpdateCover post={item}/><h3>{item.title}</h3><p>{displayDate(item.date)} · {updateKind(item.kind, locale)}</p></Link>)}</div></section> : null}
  <Link href={href("/updates")} className={styles.allPosts}>← {c.returnAll}</Link>
 </article>;
}
