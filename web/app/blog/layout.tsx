import type { ReactNode } from "react";
import Link from "@/lib/i18n/navigation";
import { AuthControls } from "@/components/auth-controls";
import { SiteHeader } from "@/components/site-header";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { authProfile } from "@/lib/session";
import styles from "./blog.module.css";

export default async function BlogLayout({ children }: { children: ReactNode }) {
  const user = await getAuthenticatedUser();
  return (
    <div className={`app-shell site-chrome desktop-sidebar-layout ${styles.shell}`} lang="ko">
      <a href="#blog-main" className={styles.skip}>본문으로 건너뛰기</a>
      <SiteHeader desktopSidebar showUsageIndicator={false}>
        <AuthControls user={user ? authProfile(user) : null} next="/blog" />
      </SiteHeader>
      {children}
      <footer className={styles.footer}>
        <div><strong>EasyCut</strong><p>이지컷 운영팀 · 아티룸<br />쇼츠 제작의 시작부터 다음 한 편까지.</p></div>
        <nav aria-label="블로그 하단 안내"><Link href="/blog">모든 글</Link><Link href="/support">문의하기</Link><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link></nav>
        <span>© 2026 EasyCut</span>
      </footer>
    </div>
  );
}
