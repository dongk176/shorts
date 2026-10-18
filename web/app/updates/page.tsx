import { notFound } from "next/navigation";
import { publishedUpdates } from "@/lib/update-store";
export const dynamic = "force-dynamic";
import { updatePage } from "./pagination";
import { updatesMetadata } from "./metadata";
import type { Metadata } from "next";
import { UpdatesCatalog } from "./updates-catalog";
import styles from "./updates.module.css";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizedHref } from "@/lib/i18n/routing";
import { updateCopy } from "./copy";
type Props = { searchParams: Promise<{ page?: string | string[] }> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const locale = await getRequestLocale();
  const updates = await publishedUpdates(locale);
  const paging = updatePage((await searchParams).page, updates.length);
  return paging ? updatesMetadata(undefined, paging.page, locale) : { robots: { index: false, follow: true } };
}
export default async function UpdatesPage({ searchParams }: Props) {
    const locale = await getRequestLocale(); const c = updateCopy(locale);
    const updates = await publishedUpdates(locale);
  const paging = updatePage((await searchParams).page, updates.length);
    if (!paging) notFound();
    return <main id="updates-main" className={styles.main}>
   <header className={styles.hero}>
    <h1>{c.title}</h1>
    <p className={styles.lead}>{c.lead}</p>
   </header>
   <UpdatesCatalog updates={updates} locale={locale} page={paging.page} totalPages={paging.totalPages} />
   <aside className={styles.endnote}><span className={styles.eyebrow}>MADE WITH YOUR FEEDBACK</span><h2>{c.feedback}</h2><a href={localizedHref("/support", locale)} target="_blank" rel="noreferrer">{c.feedbackLink} <span>↗</span></a></aside>
   <p className={styles.archiveNote}>{c.archiveNote}</p>
 </main>;
}
