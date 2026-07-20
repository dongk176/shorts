import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "고객센터·사업자 정보 | 이지컷",
  description: "이지컷 고객센터 운영시간, 연락처와 사업자 정보를 확인하세요.",
  path: "/support",
});

export default function SupportPage() {
  return (
    <LegalDocument eyebrow="Customer Support" title="고객센터" description="서비스 이용, 결제, 개인정보 및 계정 관련 문의를 아래 연락처로 보내주세요." effectiveDate="2026년 7월 14일">
      <LegalSection title="고객센터">
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-5 sm:p-6">
          <p><strong className="inline-block w-24 text-white">운영시간</strong>평일 14:00 ~ 19:00</p>
          <p><strong className="inline-block w-24 text-white">전화</strong><a href="tel:010-4836-2874" className="text-[#ff8c7c] underline underline-offset-4">010-4836-2874</a></p>
          <p><strong className="inline-block w-24 text-white">이메일</strong><a href="mailto:artiroom176@gmail.com" className="text-[#ff8c7c] underline underline-offset-4">artiroom176@gmail.com</a></p>
        </div>
        <p className="text-neutral-500">주말과 공휴일에 접수된 문의는 다음 영업일 운영시간부터 순차적으로 답변합니다.</p>
      </LegalSection>
      <LegalSection title="사업자 정보">
        <div className="overflow-x-auto"><table><tbody>
          <tr><th>상호</th><td>아티룸</td></tr><tr><th>대표</th><td>김동민</td></tr><tr><th>사업자등록번호</th><td>638-04-03590</td></tr><tr><th>통신판매업 신고번호</th><td>2025-서울마포-2971</td></tr><tr><th>사업장 주소</th><td>서울특별시 마포구 성산로8길 40</td></tr>
        </tbody></table></div>
      </LegalSection>
    </LegalDocument>
  );
}
