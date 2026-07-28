import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { createNoIndexMetadata } from "@/lib/seo";

export const metadata: Metadata = createNoIndexMetadata(
  "레퍼럴 파트너 운영 약관",
  "Easy Cut 레퍼럴 파트너 수익 및 정산 기준입니다.",
);

export default function PartnerTermsPage() {
  return (
    <LegalDocument
      eyebrow="Referral Partner Terms"
      title="레퍼럴 파트너 운영 약관"
      description="Easy Cut 레퍼럴 링크의 회원 귀속, 수익 계산, 환불 조정 및 정산 기준을 안내합니다."
      effectiveDate="2026년 7월 28일"
    >
      <LegalSection title="1. 추천인 귀속">
        <p>활성 파트너의 링크를 최초 방문한 신규 회원은 최초 방문일부터 1년 안에 가입할 경우 해당 파트너에게 자동 귀속됩니다. 기존 회원은 귀속되지 않으며, 최초 유효 링크는 다른 파트너 링크 방문으로 변경되지 않습니다.</p>
      </LegalSection>
      <LegalSection title="2. 수익 계산">
        <p>파트너 수익은 추천 회원의 실제 결제액에서 환불액을 뺀 금액에 결제 당시 파트너 수익률을 적용해 1원 미만을 버려 계산합니다. 최초 결제, 구독 갱신, 기간 패키지 및 추가 상품 결제가 포함되며 결제 취소·환불은 수익에서 차감됩니다.</p>
      </LegalSection>
      <LegalSection title="3. 확정과 정산">
        <p>결제 승인 후 7일 동안 수익은 정산 대기 상태이며 이후 정산 가능 상태가 됩니다. 회사는 월 1회 확인된 금액을 등록 계좌로 지급할 수 있습니다. 지급 후 발생한 환불이나 오류 정정으로 음수 잔액이 생기면 다음 정산에서 우선 차감합니다.</p>
      </LegalSection>
      <LegalSection title="4. 계정과 계좌 관리">
        <p>파트너는 로그인 정보와 정산 계좌를 안전하게 관리하고 변경 사항을 즉시 갱신해야 합니다. 임시 비밀번호는 최초 로그인 시 변경해야 하며, 계정 공유나 제3자의 무단 사용으로 의심되는 경우 회사에 알려야 합니다.</p>
      </LegalSection>
      <LegalSection title="5. 금지 행위와 운영 상태">
        <p>자기추천, 허위 가입, 반복 결제·환불, 오해를 유발하는 광고, 스팸 및 서비스 신뢰를 훼손하는 행위를 금지합니다. 회사는 확인이 필요한 수익을 보류하고 신규 귀속을 일시정지할 수 있으며, 종료 전 발생한 정당한 확정 수익은 보존합니다.</p>
      </LegalSection>
      <LegalSection title="6. 문의">
        <p>수익·정산·계정 문의는 <a href="mailto:artiroom176@gmail.com">artiroom176@gmail.com</a>으로 보내 주세요. 거래와 정산 내역이 일치하지 않으면 확인에 필요한 주문 시각과 화면 내역을 함께 제출할 수 있습니다.</p>
      </LegalSection>
    </LegalDocument>
  );
}
