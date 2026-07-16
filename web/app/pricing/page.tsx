import { SiteHeader } from "@/components/site-header";
import { PricingCards } from "./pricing-cards";

export default function PricingPage() {
  return (
    <div className="app-shell pricing-page min-h-screen text-neutral-100">
      <SiteHeader><a href="/auth/sign-in?next=%2Fpricing" className="header-cta">Google로 로그인 <span aria-hidden="true">→</span></a></SiteHeader>
      <main className="pricing-main">
        <PricingCards />
        <p className="pricing-note">모든 플랜은 한 번에 하나의 작업을 처리하며, 생성된 프로젝트는 최대 30일까지 안전하게 보관됩니다.</p>
      </main>
      <footer className="site-footer"><div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between"><div><span className="brand-type">Easy <em>Cut</em></span><p className="mt-2 text-xs text-neutral-500">© 2026 Easy Cut. 아카이브를 바이럴 콘텐츠로 변환하세요.</p></div><div className="flex flex-wrap gap-6 text-xs text-neutral-400"><a href="#">이용약관</a><a href="#">개인정보처리방침</a><a href="#">고객 지원</a><a href="#">제휴 프로그램</a></div></div></footer>
    </div>
  );
}
