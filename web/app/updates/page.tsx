import { notFound } from "next/navigation";
import { publishedUpdates } from "@/lib/update-store";
export const dynamic = "force-dynamic";
import { updatePage } from "./pagination";
import { updatesMetadata } from "./metadata";
import type { Metadata } from "next";
import { UpdatesCatalog } from "./updates-catalog";
import styles from "./updates.module.css";
type Props = { searchParams: Promise<{ page?: string | string[] }> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const updates = await publishedUpdates();
  const paging = updatePage((await searchParams).page, updates.length);
  return paging ? updatesMetadata(undefined, paging.page) : { robots: { index: false, follow: true } };
}
export default async function UpdatesPage({ searchParams }: Props) {
    const updates = await publishedUpdates();
  const paging = updatePage((await searchParams).page, updates.length);
    if (!paging) notFound();
    return <main id="updates-main" className={styles.main}>
   <header className={styles.hero}>
    <h1>이지컷의 새로운 소식</h1>
    <p className={styles.lead}>새로운 기능과 개선 사항을 만나보세요.</p>
   </header>
   <UpdatesCatalog updates={updates} page={paging.page} totalPages={paging.totalPages} />
   <aside className={styles.endnote}><span className={styles.eyebrow}>MADE WITH YOUR FEEDBACK</span><h2>다음 업데이트의 시작은<br />여러분의 한마디입니다.</h2><a href="https://www.easycut.co.kr/support" target="_blank" rel="noreferrer">이지컷에 의견 보내기 <span>↗</span></a></aside>
   <p className={styles.archiveNote}>7월 25일 이후 사용자 기능 변경을 모은 기록입니다. 날짜는 변경 이력 기준이며 실제 공개일과 차이가 있을 수 있습니다. 이미지는 실제 서비스 화면이며, 각 이미지에 캡처 날짜를 표시했습니다.</p>
 </main>;
}
