import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { refundTranslations } from "@/lib/i18n/legal-translations";
import { getRequestLocale } from "@/lib/i18n/server";
import { createPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const translated = locale === "ko" ? undefined : refundTranslations[locale];
  return createPageMetadata({
    title: `${translated?.title ?? "취소 및 환불 정책"} | Easy Cut`,
    description: translated?.description
      ?? "이지컷 월간 구독, 월별 패키지 이용권과 추가 처리시간의 해지·청약철회·환불 기준을 안내합니다.",
    path: "/refund",
  });
}

const accentLink = "font-bold text-[#ff8c7c] underline underline-offset-4";

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      eyebrow="Cancellation & Refund Policy"
      title="취소 및 환불 정책"
      description="Easy Cut 월간 구독, 월별 이용권을 묶어 선결제하는 기간 패키지와 추가 처리시간의 취소·청약철회·환불 기준입니다."
      effectiveDate="2026년 7월 26일 개정 · 환불정책 v2 신규 주문부터"
      translations={refundTranslations}
    >
      <section aria-labelledby="refund-summary" className="overflow-hidden rounded-3xl border border-[#ff8c7c]/25 bg-[linear-gradient(135deg,rgba(255,113,94,.12),rgba(160,120,255,.07))] p-5 sm:p-7">
        <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff9b8d]">Before you request</p>
        <h2 id="refund-summary" className="mt-2 text-xl font-black tracking-tight text-white">먼저 확인해 주세요</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">월간 구독 해지</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">다음 자동결제만 중단합니다. 이미 결제한 현재 월은 종료일까지 이용하며 자동 환불되지 않습니다.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">패키지 월별 환불</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">완료된 월과 현재 사용한 월의 계약 월단가를 제외하고 아직 제공되지 않은 미래 월 이용료를 환불합니다.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">7일 이내 미사용</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">유료 작업·처리시간·필터·전자책 등 유료 기능을 전혀 사용하지 않았다면 전액 환불합니다.</p>
          </div>
        </div>
        <p className="mt-5 text-xs leading-6 text-neutral-400">관계 법령이나 소비자분쟁해결기준이 이용자에게 더 유리한 경우 해당 기준이 우선합니다.</p>
      </section>

      <LegalSection title="제1조 목적 및 적용 범위">
        <p>본 정책은 아티룸(이하 “회사”)이 Easy Cut에서 판매하는 이지컷 프로 월간 구독, 스타터·전문가 기간 패키지, 추가 처리시간 및 그 밖의 유료 디지털 서비스에 적용됩니다.</p>
        <p>결제 화면에 표시된 상품명, 기간, 월별 제공량, 계약 월단가, 총 결제금액, 환불정책 버전과 개별 조건이 해당 주문의 구체적인 계약 내용이 됩니다.</p>
        <p>강행 법령 또는 소비자분쟁해결기준이 본 정책보다 이용자에게 유리한 권리를 정한 경우 그 기준을 우선 적용합니다.</p>
      </LegalSection>

      <LegalSection title="제2조 용어의 뜻">
        <ul>
          <li>• <strong className="text-white">월간 구독</strong>: 매 결제일에 1개월 이용료를 자동결제하고 이용자가 해지할 때까지 갱신하는 상품입니다.</li>
          <li>• <strong className="text-white">기간 패키지</strong>: 독립된 월별 이용권 3개, 6개 또는 12개를 한 번에 결제하는 가분적 상품입니다.</li>
          <li>• <strong className="text-white">계약 월단가</strong>: 기간 패키지의 실 결제금액을 계약 개월 수로 나눈 월별 이용권의 가격입니다.</li>
          <li>• <strong className="text-white">사용 월</strong>: 이미 기간이 끝난 월 또는 현재 월의 유료 작업·기본 처리시간·유료 기능이 사용되거나 제공이 시작된 월입니다.</li>
          <li>• <strong className="text-white">미래 월</strong>: 환불 신청 시점에 아직 개시되지 않았고 처리시간도 지급되지 않은 월별 이용권입니다.</li>
          <li>• <strong className="text-white">추가 처리시간</strong>: 기본 처리시간과 별도로 구매하며 승인일부터 90일간 유효한 상품입니다.</li>
        </ul>
      </LegalSection>

      <LegalSection title="제3조 상품별 결제 및 제공 기준">
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>상품</th><th>결제 방식</th><th>제공·환불 단위</th></tr></thead>
            <tbody>
              <tr><td>이지컷 프로</td><td>매월 자동결제</td><td>1개월 단위</td></tr>
              <tr><td>기간 패키지</td><td>3·6·12개월 이용권 일괄 결제</td><td>결제일부터 시작하는 월별 이용권 단위</td></tr>
              <tr><td>추가 처리시간</td><td>구매 시 1회 결제</td><td>해당 구매 원장 단위</td></tr>
            </tbody>
          </table>
        </div>
        <p>기간 패키지는 첫 월별 이용권과 처리시간을 결제 승인 즉시 제공하고, 이후 계약이 유지되는 동안 매월 같은 기준일에 다음 월별 이용권과 처리시간을 제공합니다.</p>
        <p>사용량은 생성된 쇼츠 길이가 아니라 처리 대상으로 제출한 원본 영상의 길이를 기준으로 기록합니다. 작업이 처리 중이면 예약 사용량, 정상 완료되면 확정 사용량으로 기록합니다.</p>
      </LegalSection>

      <LegalSection title="제4조 월간 구독 해지">
        <p>이지컷 프로 해지를 확정하면 다음 자동결제를 중단합니다. 이미 결제한 현재 월 이용권과 남은 기본 처리시간은 해당 결제기간 종료일까지 유지되며, 단순 해지만으로 현재 결제가 환불되지는 않습니다.</p>
        <p>결제기간 종료 전에 즉시 종료와 환불을 별도로 요청한 경우에는 이용 여부, 신청 시점, 회사 귀책 여부 및 관계 법령을 확인하여 처리합니다.</p>
      </LegalSection>

      <LegalSection title="제5조 기간 패키지의 월별 제공">
        <p>기간 패키지의 각 월별 이용권은 결제 승인일을 기준으로 매월 순차 개시됩니다. 계약 월단가는 할인 전 월간 상품 가격이 아니라 해당 패키지의 실제 결제금액을 계약 개월 수로 나눈 금액입니다.</p>
        <p>월별로 지급된 미사용 기본 처리시간은 패키지 이용기간 동안 합산될 수 있습니다. 다만 환불 후에는 환불 대상 미래 월의 처리시간을 새로 지급하지 않으며, 이용권 종료 시 남은 기본 처리시간은 소멸합니다.</p>
        <p>복수의 패키지는 주문별 이용기간·처리시간·사용기록·환불액을 독립적으로 계산합니다.</p>
      </LegalSection>

      <LegalSection title="제6조 7일 이내 미사용 청약철회">
        <p>법정 청약철회 기간 안에 신청하고 다음 조건을 모두 충족하면 해당 주문의 실 결제금액을 전액 환불합니다.</p>
        <ul>
          <li>• 유료 영상 작업을 제출하거나 완료하지 않았을 것</li>
          <li>• 기본 또는 추가 처리시간을 예약·사용·소비하지 않았을 것</li>
          <li>• 활성 이용권 전용 실시간 인기 필터 결과를 제공받지 않았을 것</li>
          <li>• 유료 전용 템플릿·전자책 등 별도 디지털콘텐츠의 제공이 시작되지 않았을 것</li>
          <li>• 관계 법령상 청약철회 제한 사유에 해당하지 않을 것</li>
        </ul>
        <p>기본 목록 열람, 잠긴 기능의 단순 클릭 또는 결과가 제공되지 않은 오류 요청은 유료 사용으로 기록하지 않습니다.</p>
      </LegalSection>

      <LegalSection title="제7조 기간 패키지 사용 후 환불">
        <p>환불정책 v2가 적용된 기간 패키지는 완료된 월과 현재 사용한 월의 이용대금을 제외하고 현재 미사용 월 및 아직 개시되지 않은 미래 월의 이용대금을 환불합니다.</p>
        <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5 text-center sm:p-6">
          <p className="text-xs font-bold tracking-wide text-neutral-500">기간 패키지 환불액</p>
          <p className="mt-2 text-base font-black leading-7 text-white sm:text-lg">실 결제금액 − 제공 완료 월 이용대금 − 기존 환불액</p>
        </div>
        <ul>
          <li>• 제공 완료 월 이용대금 = 실 결제금액 × 공제 월수 ÷ 전체 계약 개월 수</li>
          <li>• 공제 월수에는 이미 종료된 월별 이용권이 포함됩니다.</li>
          <li>• 현재 월에 유료 작업을 제출했거나 기본 처리시간이 예약·확정된 경우, 유료 필터 결과 또는 유료 디지털콘텐츠를 제공받은 경우 현재 월도 공제 월수에 포함됩니다.</li>
          <li>• 현재 월을 공제하면 해당 월별 이용권 종료일까지 유료 권한과 남은 기본 처리시간을 유지하고, 다음 월부터 권한과 처리시간 지급을 중단합니다.</li>
          <li>• 현재 월이 전혀 사용되지 않았다면 현재 월과 미래 월 이용대금을 환불하고 환불 완료 시 패키지 권한을 종료할 수 있습니다.</li>
          <li>• 별도 구매한 추가 처리시간만 사용한 작업은 기간 패키지의 사용 월로 중복 계산하지 않습니다.</li>
          <li>• 월별 이용대금 외에 잔여기간 10% 위약금, 결제대행 수수료 또는 별도 환불 처리비를 중복 공제하지 않습니다.</li>
          <li>• 원 미만은 버리고 이미 완료되거나 처리 중인 환불액은 추가 환불액에서 제외합니다.</li>
        </ul>
      </LegalSection>

      <LegalSection title="제8조 이전 환불정책이 적용되는 주문">
        <p>결제 당시 환불정책 v1이 표시·기록된 주문에는 당시 정책의 경과일수 기준과 중도해지 위약금 기준을 적용합니다. 정책 변경을 기존 주문에 소급하여 불리하게 적용하지 않습니다.</p>
        <p><Link href="/refund/versions/1" className={accentLink}>환불정책 v1 확인하기</Link></p>
      </LegalSection>

      <LegalSection title="제9조 추가 처리시간의 환불">
        <p>추가 처리시간은 승인일부터 90일간 유효합니다. 결제일부터 7일 이내이고 예약·사용·소비된 시간이 없다면 전액 환불할 수 있습니다.</p>
        <p>일부라도 사용하거나 처리 중인 추가시간은 자동 환불할 수 없습니다. 관계 법령상 반환이 필요한 경우 사용대금과 허용된 비용을 확인하여 수동 처리합니다.</p>
      </LegalSection>

      <LegalSection title="제10조 회사 귀책·서비스 하자">
        <p>회사의 시스템 오류로 작업이 정상 완료되지 않은 경우 사용량 반환, 재처리, 대체 제공 또는 이용기간 연장을 우선 제공할 수 있습니다. 정상 제공이 불가능하거나 법령상 환불 사유가 성립하면 전부 또는 제공되지 않은 부분을 환불합니다.</p>
        <p>중복 결제·과오금 등 회사의 책임 있는 사유가 확인되면 수수료 없이 해당 금액을 환불합니다.</p>
      </LegalSection>

      <LegalSection title="제11조 환불 제한 및 부정 이용">
        <p>기술적으로 정상 완료된 결과에 대한 단순한 취향·조회수 기대·편집 선호 차이, 이용자의 잘못된 URL·설정·권리 확인, 지원하지 않는 입력, 약관 위반 또는 부정 이용은 회사 귀책에 해당하지 않습니다.</p>
        <p>허위 자료, 결과물 이용 후 사용사실 은폐, 반복적인 결제 취소 또는 카드사 이의제기와 회사 환불의 중복 진행은 금지됩니다.</p>
      </LegalSection>

      <LegalSection title="제12조 환불 신청 방법">
        <p>환불은 <a href="mailto:artiroom176@gmail.com" className={accentLink}>artiroom176@gmail.com</a>으로 신청해야 하며, 구독 해지 또는 패키지 종료 예약만으로 환불 신청이 접수되지는 않습니다.</p>
        <p>계정 이메일, 결제일·금액, 상품명, 주문번호와 환불 사유를 보내야 합니다. 회사는 본인·결제·사용 내역 확인에 필요한 최소한의 자료를 요청할 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="제13조 환불 방법과 권한 처리">
        <p>환불액 확정 후 법정 기한 안에 원 결제수단으로 승인 취소 또는 환급을 요청합니다. 카드사 반영 시점은 카드사와 결제일에 따라 달라질 수 있습니다.</p>
        <p>전액환불 또는 즉시 종료 대상이면 유료 권한과 기본 처리시간을 회수합니다. 현재 월 이용대금을 공제한 패키지는 해당 월 종료일까지 권한을 유지한 뒤 자동 종료합니다.</p>
      </LegalSection>

      <LegalSection title="제14조 기록 및 입증">
        <p>회사는 결제, 환불정책 버전, 월별 처리시간 지급, 사용량 예약·확정·반환, 작업 결과, 유료 필터·다운로드 제공, 환불 계산 및 권한 종료 기록을 관련 법령과 개인정보처리방침이 정한 기간 동안 보관할 수 있습니다.</p>
        <p>계약 체결, 정책 고지, 콘텐츠·용역 제공과 사용 여부에 다툼이 있는 경우 관계 법령에 따른 입증책임을 부담합니다.</p>
      </LegalSection>

      <LegalSection title="제15조 정책 변경 및 분쟁 해결">
        <p>각 주문에는 결제 당시의 환불정책 버전을 기록하며 해당 거래에는 그 버전을 적용합니다. 이용자에게 불리한 변경은 기존 결제에 소급하지 않습니다.</p>
        <p>본 정책에서 정하지 않은 사항은 서비스 이용약관, 구매약관, 결제 화면의 개별 조건, 대한민국 관계 법령 및 소비자분쟁해결기준에 따릅니다.</p>
        <p>분쟁이 해결되지 않는 경우 1372 소비자상담센터, 한국소비자원 또는 콘텐츠분쟁조정위원회에 상담·조정을 신청할 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="제16조 사업자 및 환불 담당자 정보">
        <div className="overflow-x-auto">
          <table><tbody>
            <tr><th>상호</th><td>아티룸</td></tr>
            <tr><th>대표</th><td>김동민</td></tr>
            <tr><th>사업자등록번호</th><td>638-04-03590</td></tr>
            <tr><th>통신판매업 신고번호</th><td>2025-서울마포-2971</td></tr>
            <tr><th>주소</th><td>서울특별시 마포구 성산로8길 40</td></tr>
            <tr><th>문의</th><td><a href="mailto:artiroom176@gmail.com" className={accentLink}>artiroom176@gmail.com</a> · <a href="tel:010-4836-2874" className={accentLink}>010-4836-2874</a></td></tr>
          </tbody></table>
        </div>
      </LegalSection>
    </LegalDocument>
  );
}
