"use client";
import Link from "next/link";
import { YoutubeLaunchGuideReplay } from "@/components/youtube-launch-guide";
import { displayDate, type UpdatePost } from "./data";
import { AnnotatedScreen } from "./annotated-screen";
import { UpdateCover } from "./update-cover";
import { UpdateBlocks } from "./update-blocks";
import styles from "./updates.module.css";
export function UpdateArticleView({ post, related = [] }: { post: UpdatePost; related?: UpdatePost[] }) {
    return <article id="updates-main" className={styles.articleMain}>
  <Link href="/updates" className={styles.back}>← 모든 업데이트</Link>
  <header className={styles.articleHeader}><div className={styles.articleLabels}><span className={styles.tag} data-kind={post.kind}>{post.kind}</span><span>{post.topic}</span></div><h1>{post.title}</h1><p>{post.summary}</p><div className={styles.meta}><span className={styles.authorMark}>e</span><span>이지컷 팀</span><span>·</span><time dateTime={post.date}>{displayDate(post.date)}</time><span>·</span><span>{post.readingMinutes}분 읽기</span></div></header>
  <div className={styles.articleCover}><UpdateCover post={post} priority/></div>
  <div className={styles.articleBody}>
    {post.blocks ? <UpdateBlocks blocks={post.blocks}/> : <>
    <section><p className={styles.eyebrow}>변경 내용</p><h2>이렇게 달라졌어요</h2>{post.changes.map((change, i) => <p key={change}>{i === 0 ? <strong>{change}</strong> : change}</p>)}</section>
    <section><h2>화면으로 살펴보기</h2><p>실제 화면에서 사용할 위치를 확인해 보세요. 이미지를 누르면 더 크게 볼 수 있어요.</p><AnnotatedScreen image={post.image}/>{post.slug === "saved-videos" ? <AnnotatedScreen image="saved-empty"/> : null}</section>
    {post.slug === "channel-connections" ? <YoutubeLaunchGuideReplay /> : null}
    <section className={styles.steps}><p className={styles.eyebrow}>사용 방법</p><h2>이렇게 사용해 보세요</h2><ol>{post.steps.map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol><a className={styles.cta} href={`https://www.easycut.co.kr${post.href}`} target="_blank" rel="noreferrer">실제 기능 열기 <span>↗</span></a><small>현재 서비스가 새 탭에서 열립니다.</small></section>
    </>}
    <p className={styles.articleNote}>이 글은 {displayDate(post.date)} 변경 기록을 바탕으로 정리했어요. 캡처는 현재 화면으로, 업데이트 당시의 모습과 다를 수 있습니다. 사용 가능한 기능은 계정·플랜과 현재 서비스 안내를 확인해 주세요.</p>
  </div>
  {related.length ? <section className={styles.related}><h2>함께 보면 좋은 업데이트</h2><div className={styles.grid}>{related.map(item => <Link href={`/updates/${item.slug}`} key={item.slug} prefetch={false}><UpdateCover post={item}/><h3>{item.title}</h3><p>{displayDate(item.date)} · {item.kind}</p></Link>)}</div></section> : null}
  <Link href="/updates" className={styles.allPosts}>← 전체 업데이트로 돌아가기</Link>
 </article>;
}
