import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { createPageMetadata } from "@/lib/seo";
import { getRequestLocale } from "@/lib/i18n/server";
import { termsTranslations } from "@/lib/i18n/legal-translations";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const translated = locale === "ko" ? undefined : termsTranslations[locale];
  return createPageMetadata({
    title: `${translated?.title ?? "서비스 이용약관"} | Easy Cut`,
    description: translated?.description ?? "이지컷 AI 쇼츠 제작 서비스 이용약관입니다.",
    path: "/terms",
  });
}

export default function TermsPage() {
  return (
    <LegalDocument eyebrow="Terms of Service" title="서비스 이용약관" description="본 약관은 Easy Cut이 제공하는 YouTube 영상 기반 쇼츠 제작 서비스의 이용 조건과 운영팀 및 이용자의 권리·의무를 정합니다." effectiveDate="2026년 7월 21일" translations={termsTranslations}>
      <LegalSection title="제1조 목적 및 적용"><p>본 약관은 Easy Cut 운영팀(이하 “운영팀”)이 제공하는 웹사이트, 영상 분석, 쇼츠 생성·편집·저장 및 이에 부수되는 서비스(이하 “서비스”)에 적용됩니다. 이용자가 서비스를 이용하거나 계정을 생성하면 본 약관에 동의한 것으로 봅니다.</p></LegalSection>
      <LegalSection title="제2조 계정 및 로그인"><p>이용자는 정확한 정보를 사용하여 본인의 소셜 계정으로 로그인해야 하며 자신의 계정과 로그인 수단을 안전하게 관리할 책임이 있습니다. 계정의 무단 사용이 의심되는 경우 즉시 고객 지원에 알려야 합니다.</p></LegalSection>
      <LegalSection title="제3조 서비스 이용 조건">
        <ul><li>• 입력할 수 있는 원본 영상 길이는 최대 60분입니다.</li><li>• 기본적으로 한 번에 하나의 생성 작업만 진행할 수 있습니다.</li><li>• 생성 개수, 보관 기간, 이용량 및 기능 범위는 선택한 요금제에 따라 달라질 수 있습니다.</li><li>• 외부 플랫폼의 정책, 원본 상태, 네트워크 또는 AI 처리 결과에 따라 생성이 제한되거나 실패할 수 있습니다.</li></ul>
      </LegalSection>
      <LegalSection title="제4조 콘텐츠 권리와 이용자의 책임">
        <p>이용자는 자신이 소유하거나 적법한 이용 허가를 받은 YouTube 영상만 입력해야 합니다. 이용자는 저작권, 초상권, 상표권, 개인정보 및 YouTube를 포함한 외부 플랫폼의 정책을 준수해야 합니다.</p>
        <p>이용자의 권리 보유 확인은 외부 플랫폼이 요구하는 별도의 접근·다운로드 허가를 대신하지 않습니다. 운영팀은 플랫폼 정책, 네트워크 상태 또는 기술적 제한에 따라 URL 기반 원본 수집을 거절하고, 이용자가 적법하게 보유한 원본 파일의 직접 제공을 요청할 수 있습니다.</p>
        <p>이용자가 입력한 원본과 생성 결과물에 대한 권리는 원래의 권리자에게 귀속됩니다. 운영팀은 서비스 제공, 오류 복구 및 보안 유지에 필요한 범위에서만 이용자 콘텐츠를 처리합니다.</p>
      </LegalSection>
      <LegalSection title="제5조 금지 행위">
        <ul><li>• 타인의 계정, 비공개·유료·연령 제한·DRM 보호 콘텐츠에 대한 무단 접근 또는 제한 우회</li><li>• 외부 플랫폼의 인증, 요청량, 봇 검증, 지역 또는 콘텐츠 제한을 회피하기 위한 계정·쿠키·토큰·프록시·접속 위치 변경</li><li>• 권리자의 허락 없이 콘텐츠를 복제·배포하거나 타인의 권리를 침해하는 행위</li><li>• 불법, 유해, 사기, 차별, 명예훼손 또는 악성코드 유포 목적의 이용</li><li>• 자동화된 대량 요청, 서비스 방해, 보안 취약점 악용 또는 이용 한도 우회</li><li>• 관련 법령 및 외부 플랫폼 약관을 위반하는 행위</li></ul>
      </LegalSection>
      <LegalSection title="제6조 AI 생성 결과"><p>서비스는 AI와 자동화 기술을 사용하므로 하이라이트, 제목, 자막 등에 오류·누락·부정확한 내용이 포함될 수 있습니다. 이용자는 결과물을 게시하거나 상업적으로 이용하기 전에 적법성, 정확성 및 권리 관계를 직접 검토해야 합니다.</p></LegalSection>
      <LegalSection title="제7조 요금제와 결제"><p>유료 기능이 제공되는 경우 가격, 제공량, 결제 주기 및 환불 조건은 결제 전에 별도로 표시됩니다. 구매·갱신·플랜 변경과 추가 처리시간의 결제 조건은 <Link href="/purchase-terms" className="font-bold text-[#ff8c7c] underline underline-offset-4">유료서비스 구매약관</Link>을, 구독 해지·청약철회 및 환불의 세부 기준은 <Link href="/refund" className="font-bold text-[#ff8c7c] underline underline-offset-4">취소 및 환불 정책</Link>을 따릅니다. 외부 결제사업자의 정책이나 관련 법령에 따라 추가 조건이 적용될 수 있습니다. 무료 또는 시험 기능은 사전 안내 후 변경되거나 종료될 수 있습니다.</p></LegalSection>
      <LegalSection title="제8조 보관 및 삭제">
        <p>전체 원본 영상은 작업 중 임시 저장되며 작업 종료 시 삭제합니다. 편집용 클립, 완성 영상, 썸네일 및 자막은 요금제 정책에 따라 최초 생성일부터 최대 30일 보관되며 재편집하더라도 보관 기간이 연장되지 않을 수 있습니다.</p>
        <p>보관 기간이 끝나거나 이용자가 삭제하면 결과물을 복구할 수 없으므로 필요한 파일은 미리 내려받아야 합니다.</p>
      </LegalSection>
      <LegalSection title="제9조 서비스의 변경·중단"><p>운영팀은 안정성, 보안, 법령, 외부 서비스 변경 또는 운영상 필요에 따라 서비스의 전부 또는 일부를 변경·점검·중단할 수 있습니다. 예측 가능한 중대한 변경은 합리적인 방법으로 사전에 안내합니다.</p></LegalSection>
      <LegalSection title="제10조 이용 제한 및 계약 해지"><p>이용자가 본 약관이나 법령을 위반하거나 서비스의 안전한 운영을 방해하는 경우 운영팀은 작업 취소, 콘텐츠 삭제, 이용 제한 또는 계정 정지 조치를 할 수 있습니다. 이용자는 언제든지 계정 삭제를 요청하여 이용계약을 해지할 수 있습니다.</p></LegalSection>
      <LegalSection title="제11조 책임의 제한">
        <p>운영팀은 합리적인 범위에서 서비스를 안정적으로 제공하기 위해 노력합니다. 다만 천재지변, 통신 장애, 외부 플랫폼·클라우드·AI 공급자의 장애, 이용자의 귀책사유 또는 통제하기 어려운 사유로 발생한 손해에 대해서는 관련 법령이 허용하는 범위에서 책임이 제한될 수 있습니다.</p>
        <p>본 조는 운영팀의 고의 또는 중대한 과실로 인한 책임이나 관련 법령상 제한할 수 없는 소비자의 권리를 배제하지 않습니다.</p>
      </LegalSection>
      <LegalSection title="제12조 개인정보 보호"><p>개인정보 처리에 관한 사항은 <Link href="/privacy" className="font-bold text-[#ff8c7c] underline underline-offset-4">개인정보처리방침</Link>에 따릅니다.</p></LegalSection>
      <LegalSection title="제13조 준거법 및 분쟁 해결"><p>본 약관은 대한민국 법령에 따라 해석됩니다. 서비스와 관련한 분쟁이 발생하면 당사자 간 협의를 통해 해결하며 해결되지 않는 경우 관련 법령이 정한 관할 법원에서 처리합니다.</p></LegalSection>
      <LegalSection title="제14조 약관의 변경 및 문의">
        <p>운영팀은 관련 법령을 위반하지 않는 범위에서 본 약관을 변경할 수 있습니다. 이용자에게 불리한 중요한 변경은 시행 전에 서비스 화면을 통해 안내합니다.</p>
        <p>문의: 아티룸 고객센터 · 평일 14:00 ~ 19:00 · <a href="tel:010-4836-2874" className="text-[#ff8c7c] underline underline-offset-4">010-4836-2874</a> · <a href="mailto:artiroom176@gmail.com" className="text-[#ff8c7c] underline underline-offset-4">artiroom176@gmail.com</a></p>
      </LegalSection>
      <LegalSection title="제15조 사업자 정보">
        <div className="overflow-x-auto"><table><tbody>
          <tr><th>상호</th><td>아티룸</td></tr><tr><th>대표</th><td>김동민</td></tr><tr><th>사업자등록번호</th><td>638-04-03590</td></tr><tr><th>통신판매업 신고번호</th><td>2025-서울마포-2971</td></tr><tr><th>주소</th><td>서울특별시 마포구 성산로8길 40</td></tr>
        </tbody></table></div>
      </LegalSection>
    </LegalDocument>
  );
}
