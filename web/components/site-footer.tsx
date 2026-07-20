import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <Link href="/" className="site-footer-brand" aria-label="이지컷 Easy Cut 홈">
          <span className="brand-type">Easy <em>Cut</em></span>
          <span>© 2026</span>
        </Link>
        <ul className="site-footer-business" aria-label="사업자 정보">
          <li>아티룸</li>
          <li>대표 김동민</li>
          <li>사업자등록번호 638-04-03590</li>
          <li>통신판매업 신고번호 2025-서울마포-2971</li>
          <li><a href="tel:010-4836-2874">고객센터 010-4836-2874</a></li>
        </ul>
        <nav className="site-footer-links" aria-label="정책 및 고객 지원">
          <Link href="/pricing">요금제</Link>
          <Link href="/faq">자주 묻는 질문</Link>
          <Link href="/terms">이용약관</Link>
          <Link href="/privacy">개인정보처리방침</Link>
          <Link href="/support">고객 지원</Link>
        </nav>
      </div>
    </footer>
  );
}
