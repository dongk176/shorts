import type { ReactNode } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { AuthControls } from "@/components/auth-controls";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { authProfile } from "@/lib/session";
import styles from "./updates.module.css";
export default async function UpdatesLayout({ children }: {
    children: ReactNode;
}) {
    const user = await getAuthenticatedUser();
    return <div className={`site-chrome desktop-sidebar-layout ${styles.shell}`} lang="ko">
    <a className={styles.skip} href="#updates-main">본문으로 건너뛰기</a>
    <SiteHeader desktopSidebar showUsageIndicator={false}><AuthControls user={user ? authProfile(user) : null} next="/updates"/></SiteHeader>
    {children}
    <footer className={styles.footer}><Link href="/updates"><strong>Easy <em>Cut</em></strong><span>조금씩 더 나은 제작 경험을 만듭니다.</span></Link><div><Link href="/support">의견 보내기 ↗</Link><span>© 2026 EasyCut · 아티룸</span></div></footer>
  </div>;
}
