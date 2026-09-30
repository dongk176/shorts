import type { Metadata } from "next";
import { UpdatesCatalog } from "./updates-catalog";
import styles from "./updates.module.css";
export const metadata: Metadata = { title: "업데이트", description: "이지컷의 새 기능과 개선 소식. 실제 화면으로 만나는 더 편리한 쇼츠 제작.", alternates: { canonical: "https://www.easycut.co.kr/updates" }, robots: { index: true, follow: true } };
export default function UpdatesPage() {
    return <main id="updates-main" className={styles.main}>
   <header className={styles.hero}>
    <h1>이지컷의 새로운 소식</h1>
    <p className={styles.lead}>새로운 기능과 개선 사항을 만나보세요.</p>
   </header>
   <UpdatesCatalog />
   <aside className={styles.endnote}><span className={styles.eyebrow}>MADE WITH YOUR FEEDBACK</span><h2>다음 업데이트의 시작은<br />여러분의 한마디입니다.</h2><a href="https://www.easycut.co.kr/support" target="_blank" rel="noreferrer">이지컷에 의견 보내기 <span>↗</span></a></aside>
   <p className={styles.archiveNote}>7월 25일 이후 사용자 기능 변경을 모은 기록입니다. 날짜는 변경 이력 기준이며 실제 공개일과 차이가 있을 수 있습니다. 이미지는 2026년 9월 30일 실제 서비스 화면을 캡처했습니다.</p>
 </main>;
}
