import { YoutubeLaunchGuideReplay } from "@/components/youtube-launch-guide";
import type { UpdateBlock } from "@/lib/update-content";
import { AnnotatedScreen } from "./annotated-screen";
import type { SiteLocale } from "@/lib/i18n/config";
import { localizedHref } from "@/lib/i18n/routing";
import { updateCopy } from "./copy";
import styles from "./updates.module.css";
export function UpdateBlocks({ blocks, locale = "ko" }: { blocks: UpdateBlock[]; locale?: SiteLocale }) {
 const c = updateCopy(locale);
 return blocks.map((block, index) => {
  if (block.type === "youtube-guide") return <YoutubeLaunchGuideReplay key={index} locale={locale}/>;
  if (block.type === "text") return <section key={index}>{block.eyebrow && <p className={styles.eyebrow}>{block.eyebrow}</p>}{block.heading && <h2>{block.heading}</h2>}{block.paragraphs.map((p, i) => <p key={i}>{block.strongFirst && i === 0 ? <strong>{p}</strong> : p}</p>)}</section>;
  if (block.type === "image") return <section key={index}>{block.heading && <h2>{block.heading}</h2>}{block.description && <p>{block.description}</p>}<AnnotatedScreen image="" shot={block.shot} locale={locale}/></section>;
  return <section key={index} className={styles.steps}><p className={styles.eyebrow}>{c.how}</p><h2>{block.heading}</h2><ol>{block.items.map((step, i) => <li key={i}><span>{String(i + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol><a className={styles.cta} href={`https://www.easycut.co.kr${localizedHref(block.href, locale)}`} target="_blank" rel="noreferrer">{c.open} <span>↗</span></a><small>{c.newTab}</small></section>;
 });
}
