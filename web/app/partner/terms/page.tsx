import type { Metadata } from "next";
import { LegalDocument, LegalSection, type LegalTranslation } from "@/components/legal-document";
import { createNoIndexMetadata } from "@/lib/seo";

export const metadata: Metadata = createNoIndexMetadata(
  "레퍼럴 파트너 운영 약관",
  "Easy Cut 레퍼럴 파트너 수익 및 정산 기준입니다.",
);

const partnerTermsTranslations: Record<"en" | "ja", LegalTranslation> = {
  en: {
    eyebrow: "Referral Partner Terms",
    title: "Referral Partner Terms",
    description: "Terms for member attribution, earnings, refund adjustments, and settlements through Easy Cut referral links.",
    sections: [
      { title: "1. Referral attribution", paragraphs: ["A new member who first visits through an active partner's link is automatically attributed to that partner if they sign up within one year of the first visit. Existing members are not attributed, and the first valid link is not replaced by a later visit through another partner's link."] },
      { title: "2. Earnings calculation", paragraphs: ["Partner earnings are calculated by subtracting refunds from the referred member's actual payment, applying the partner rate in effect at payment, and rounding down amounts below KRW 1. Initial purchases, subscription renewals, term packages, and additional products are included; cancellations and refunds are deducted from earnings."] },
      { title: "3. Confirmation and settlement", paragraphs: ["Earnings remain pending for seven days after payment approval and then become eligible for settlement. The company may pay verified amounts to the registered bank account once a month. If a later refund or correction creates a negative balance after payment, it is deducted first from the next settlement."] },
      { title: "4. Account and bank-account management", paragraphs: ["Partners must securely manage their login details and settlement account and promptly update any changes. Temporary passwords must be changed at first login, and suspected account sharing or unauthorized third-party use must be reported to the company."] },
      { title: "5. Prohibited conduct and operating status", paragraphs: ["Self-referrals, fraudulent sign-ups, repeated payments and refunds, misleading advertising, spam, and conduct that harms trust in the service are prohibited. The company may hold earnings that require review and temporarily pause new attributions. Legitimate confirmed earnings accrued before termination are preserved."] },
      { title: "6. Contact", paragraphs: ["Send earnings, settlement, or account questions to easycut@easycut.co.kr. If transaction and settlement records do not match, you may submit the relevant order time and on-screen records needed for review."] },
    ],
  },
  ja: {
    eyebrow: "Referral Partner Terms",
    title: "紹介パートナー運営規約",
    description: "Easy Cutの紹介リンクにおける会員帰属、収益計算、返金調整、精算基準をご案内します。",
    sections: [
      { title: "1. 紹介者への帰属", paragraphs: ["有効なパートナーのリンクを初めて訪れた新規会員が、初回訪問日から1年以内に登録した場合、そのパートナーに自動的に帰属します。既存会員は帰属対象外で、最初の有効なリンクは別のパートナーリンクへの訪問によって変更されません。"] },
      { title: "2. 収益計算", paragraphs: ["パートナー収益は、紹介会員の実際の決済額から返金額を差し引き、決済時点のパートナー収益率を適用し、1ウォン未満を切り捨てて計算します。初回決済、サブスクリプション更新、期間パッケージ、追加商品の決済を含み、決済取消・返金は収益から差し引かれます。"] },
      { title: "3. 確定と精算", paragraphs: ["決済承認後7日間は精算待ちとなり、その後精算可能になります。会社は確認済みの金額を月1回、登録口座へ支払うことができます。支払い後の返金や訂正によって残高がマイナスになった場合は、次回精算から優先して差し引きます。"] },
      { title: "4. アカウントと口座の管理", paragraphs: ["パートナーはログイン情報と精算口座を安全に管理し、変更事項を速やかに更新する必要があります。仮パスワードは初回ログイン時に変更し、アカウント共有や第三者による不正利用が疑われる場合は会社へ通知してください。"] },
      { title: "5. 禁止行為と運営状態", paragraphs: ["自己紹介、虚偽登録、決済・返金の繰り返し、誤解を招く広告、スパム、サービスへの信頼を損なう行為を禁止します。会社は確認が必要な収益を保留し、新規帰属を一時停止できます。終了前に発生した正当な確定収益は保全されます。"] },
      { title: "6. お問い合わせ", paragraphs: ["収益・精算・アカウントに関するお問い合わせはeasycut@easycut.co.krまでお送りください。取引と精算の記録が一致しない場合は、確認に必要な注文時刻と画面上の記録を提出できます。"] },
    ],
  },
};

export default function PartnerTermsPage() {
  return (
    <LegalDocument
      eyebrow="Referral Partner Terms"
      title="레퍼럴 파트너 운영 약관"
      description="Easy Cut 레퍼럴 링크의 회원 귀속, 수익 계산, 환불 조정 및 정산 기준을 안내합니다."
      effectiveDate="2026년 7월 28일"
      translations={partnerTermsTranslations}
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
        <p>수익·정산·계정 문의는 <a href="mailto:easycut@easycut.co.kr">easycut@easycut.co.kr</a>으로 보내 주세요. 거래와 정산 내역이 일치하지 않으면 확인에 필요한 주문 시각과 화면 내역을 함께 제출할 수 있습니다.</p>
      </LegalSection>
    </LegalDocument>
  );
}
