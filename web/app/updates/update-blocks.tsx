import { YoutubeLaunchGuideReplay } from "@/components/youtube-launch-guide";
import type { UpdateBlock } from "@/lib/update-content";
import { AnnotatedScreen } from "./annotated-screen";
import styles from "./updates.module.css";
export function UpdateBlocks({ blocks }: { blocks: UpdateBlock[] }) {
 return blocks.map((block, index) => {
  if (block.type === "youtube-guide") return <YoutubeLaunchGuideReplay key={index}/>;
  if (block.type === "text") return <section key={index}>{block.eyebrow && <p className={styles.eyebrow}>{block.eyebrow}</p>}{block.heading && <h2>{block.heading}</h2>}{block.paragraphs.map((p, i) => <p key={i}>{block.strongFirst && i === 0 ? <strong>{p}</strong> : p}</p>)}</section>;
  if (block.type === "image") return <section key={index}>{block.heading && <h2>{block.heading}</h2>}{block.description && <p>{block.description}</p>}<AnnotatedScreen image="" shot={block.shot}/></section>;
  return <section key={index} className={styles.steps}><p className={styles.eyebrow}>사용 방법</p><h2>{block.heading}</h2><ol>{block.items.map((step, i) => <li key={i}><span>{String(i + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol><a className={styles.cta} href={`https://www.easycut.co.kr${block.href}`} target="_blank" rel="noreferrer">실제 기능 열기 <span>↗</span></a><small>현재 서비스가 새 탭에서 열립니다.</small></section>;
 });
}
