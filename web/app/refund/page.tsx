import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { createPageMetadata } from "@/lib/seo";
import { getRequestLocale } from "@/lib/i18n/server";
import { refundTranslations } from "@/lib/i18n/legal-translations";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const translated = locale === "ko" ? undefined : refundTranslations[locale];
  return createPageMetadata({
    title: `${translated?.title ?? "취소 및 환불 정책"} | Easy Cut`,
    description: translated?.description ?? "이지컷 월간 구독, 기간 패키지, 추가 처리시간의 해지·청약철회·환불 기준과 신청 방법을 안내합니다.",
    path: "/refund",
  });
}

const accentLink = "font-bold text-[#ff8c7c] underline underline-offset-4";

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      eyebrow="Cancellation & Refund Policy"
      title="취소 및 환불 정책"
      description="본 정책은 Easy Cut 월간 구독, 기간 패키지와 추가 처리시간의 결제 취소, 청약철회, 중도 해지 및 환불 기준을 정합니다. 결제 전 반드시 확인해 주세요."
      effectiveDate="2026년 7월 25일"
      translations={refundTranslations}
    >
      <section aria-labelledby="refund-summary" className="overflow-hidden rounded-3xl border border-[#ff8c7c]/25 bg-[linear-gradient(135deg,rgba(255,113,94,.12),rgba(160,120,255,.07))] p-5 sm:p-7">
        <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff9b8d]">Before you request</p>
        <h2 id="refund-summary" className="mt-2 text-xl font-black tracking-tight text-white">먼저 확인해 주세요</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">구독 해지 예약</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">다음 결제를 막는 기능입니다. 현재 결제기간은 그대로 유지되며 자동 환불되지 않습니다.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">7일 이내 전액 환불</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">유료 작업이나 별도 디지털콘텐츠를 전혀 사용하지 않은 경우에 한합니다.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">사용 후 환불</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">청약철회가 제한될 수 있으며, 환불 의무가 있는 경우 사용분·회수 할인·허용된 위약금을 공제합니다.</p>
          </div>
        </div>
        <p className="mt-5 text-xs leading-6 text-neutral-400">관계 법령이 본 정책보다 이용자에게 유리하게 적용되는 경우에는 해당 법령이 우선합니다.</p>
      </section>

      <LegalSection title="제1조 목적 및 적용 범위">
        <p>본 정책은 아티룸(이하 “회사”)이 Easy Cut을 통해 판매하는 월간 유료 구독, 기간 패키지, 추가 처리시간(애드온), 그 밖의 유료 디지털 서비스(이하 “유료서비스”)에 적용됩니다.</p>
        <p>결제 화면에 특정 상품의 별도 취소·환불 조건이 표시된 경우 해당 조건이 우선 적용됩니다. 다만, 「전자상거래 등에서의 소비자보호에 관한 법률」, 「콘텐츠산업 진흥법」, 「방문판매 등에 관한 법률」 등 강행 법령에 반하여 이용자의 권리를 제한하지 않습니다.</p>
        <p>사업 또는 영업 활동을 위해 유료서비스를 구매하여 법령상 “소비자”에 해당하지 않는 이용자에게는 법정 청약철회 규정이 적용되지 않을 수 있으며, 이 경우 본 정책과 개별 계약이 허용하는 범위에서 처리합니다.</p>
      </LegalSection>

      <LegalSection title="제2조 용어의 뜻">
        <ul>
          <li>• <strong className="text-white">구독 해지 예약</strong>: 현재 결제기간이 끝난 뒤 자동갱신과 다음 결제를 중단하는 신청입니다.</li>
          <li>• <strong className="text-white">청약철회</strong>: 법정 기간 안에 구매 의사를 철회하여 계약을 소급해 해소하는 것을 말합니다.</li>
          <li>• <strong className="text-white">중도 해지</strong>: 이미 개시된 계약을 결제기간 종료 전 장래를 향해 종료하는 것을 말합니다.</li>
          <li>• <strong className="text-white">환불</strong>: 청약철회, 중도 해지, 과오금 또는 회사의 귀책사유 등에 따라 결제금액의 전부 또는 일부를 원 결제수단으로 반환하는 것을 말합니다.</li>
          <li>• <strong className="text-white">사용대금</strong>: 이용기간, 실제 처리한 원본 영상 길이, 사용한 유료 기능, 제공된 개별 콘텐츠 및 회수되는 할인·혜택을 기준으로 산정한 금액입니다.</li>
        </ul>
      </LegalSection>

      <LegalSection title="제3조 상품별 결제 및 제공 기준">
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>상품</th><th>결제·제공 방식</th><th>기본 처리 원칙</th></tr></thead>
            <tbody>
              <tr><td>이지컷 프로</td><td>매 결제일에 1개월 이용료 자동결제</td><td>해지 예약 시 현재 결제기간 말에 종료</td></tr>
              <tr><td>기간 패키지</td><td>3·6·12개월 이용료를 한 번에 결제하고 처리시간은 매월 부여</td><td>자동갱신하지 않으며 중도 해지 시 제공 혜택이 재산정될 수 있음</td></tr>
              <tr><td>얼리버드 추가시간</td><td>1회 결제하고 승인일부터 90일간 유효</td><td>기본 제공시간과 별도로 계산하며, 만료분은 현금으로 전환되지 않음</td></tr>
            </tbody>
          </table>
        </div>
        <p>사용량은 생성된 쇼츠 길이가 아니라 처리 대상으로 제출한 원본 영상의 전체 길이를 기준으로 계산합니다. 작업이 성공하면 해당 사용량은 확정되며, 결과물을 삭제하거나 내려받지 않아도 복원 또는 현금 환급되지 않습니다.</p>
        <p>유료 권한과 첫 처리시간이 계정에 부여되어 이용 가능해진 때 유료서비스의 공급이 개시됩니다. 개별 AI 영상 제작 서비스는 이용자가 유료 작업을 제출한 때 제공이 시작됩니다.</p>
      </LegalSection>

      <LegalSection title="제4조 구독 해지 예약과 자동갱신 중단">
        <ol className="grid gap-3">
          <li>1. 이용자는 <Link href="/pricing" className={accentLink}>요금제 페이지</Link>의 구독 관리 영역에서 “구독 해지”를 선택하고 확인창에서 최종 해지를 확정할 수 있습니다.</li>
          <li>2. 최종 해지를 확정하면 결제대행사의 자동결제 일정은 즉시 중지됩니다. 이미 결제한 Pro 이용기간과 지급된 처리시간은 각 유효기간까지 유지되지만, 다음 결제와 그에 따른 월 처리시간 지급은 발생하지 않습니다.</li>
          <li>3. 해지 확정만으로 이미 승인된 결제가 취소되거나 남은 유료기간의 이용료가 자동으로 일할 환불되지는 않습니다. 즉시 종료와 환불을 원하는 경우 제7조에 따라 별도로 신청해야 합니다.</li>
          <li>4. 해지 예정 상태에서 “다시 구독하기”를 선택하면 생년월일·사업자번호와 카드 비밀번호 앞 2자리를 확인한 뒤 월 이용료가 즉시 결제됩니다. 승인 즉시 월 처리시간 60분을 지급하고 남아 있는 Pro 이용기간 끝에 1개월을 추가하며, 자동결제 일정을 다시 활성화합니다.</li>
          <li>5. 다시 구독하기는 무료 철회가 아닌 새로운 유료 결제입니다. 이후 자동결제일과 금액은 다시 구독하기 화면과 결제 내역에서 확인할 수 있습니다.</li>
          <li>6. 구독 종료 시 사용하지 않은 기본 처리시간, 무료·프로모션 혜택 및 미사용 기간은 상품별 유효기간에 따라 소멸합니다. 별도로 구매한 추가 처리시간의 취급은 구매 조건과 관계 법령에 따릅니다.</li>
        </ol>
      </LegalSection>

      <LegalSection title="제5조 상품 변경과 결제 실패">
        <p>이지컷 프로에서 기간 패키지로 변경하면 현재 월간 결제기간 종료일로 예약됩니다. 예약 시 결제나 환불은 발생하지 않으며, 종료 후 패키지 결제를 완료해야 새 상품이 적용됩니다.</p>
        <p>스타터·전문가의 3·6·12개월 기간 패키지는 각 상품별로 계정당 한 번만 구매할 수 있습니다. 다른 기간 또는 등급의 패키지는 각각 한 번씩 추가 구매할 수 있으며, 각 구매 건은 승인일부터 독립된 이용기간과 월별 처리시간을 가지고 지급된 처리시간은 합산됩니다. 패키지 이용 중에는 이지컷 프로 월간 구독을 추가할 수 없습니다.</p>
        <p>자동결제가 실패하면 회사는 결제를 재시도할 수 있으며, 미납 상태에서는 새 작업 생성, 추가 처리시간 구매 등 일부 기능을 제한할 수 있습니다. 최종 결제 실패나 해지 효력 발생으로 구독이 끝난 경우 남은 기본 처리시간과 혜택은 소멸할 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="제6조 청약철회와 전액 환불">
        <p>소비자는 원칙적으로 계약내용에 관한 서면을 받은 날부터 7일 이내에 청약철회를 신청할 수 있습니다. 서면보다 유료서비스 공급이 늦게 시작된 경우에는 공급이 시작된 날부터 7일을 계산합니다.</p>
        <p>다음 사항을 모두 충족하면 결제금액 전액을 환불합니다.</p>
        <ul>
          <li>• 법정 청약철회 기간 안에 유효한 신청을 완료했을 것</li>
          <li>• 유료 영상 작업을 제출·완료하지 않았을 것</li>
          <li>• 기본 또는 추가 처리시간을 사용·소비하지 않았을 것</li>
          <li>• 유료 전용 템플릿, 필터, 전자책 다운로드 등 별도 디지털콘텐츠의 제공이 개시되지 않았을 것</li>
          <li>• 회사가 별도로 표시한 청약철회 제한 사유에 해당하지 않을 것</li>
        </ul>
        <p>이용자의 동의 아래 디지털콘텐츠 또는 용역의 제공이 시작된 경우에는 청약철회가 제한될 수 있습니다. 다만, 여러 개의 가분적 콘텐츠나 용역으로 구성된 상품은 아직 제공이 시작되지 않은 부분에 관하여 법령상 청약철회가 인정될 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="제7조 사용 후 중도 해지 및 부분 환불">
        <p>유료서비스 제공이 시작된 뒤 이용자의 단순 변심으로 즉시 종료를 요청하면 청약철회가 제한될 수 있습니다. 다만, 계속거래의 중도 해지 등 관계 법령상 환불 의무가 인정되거나 회사가 예외적으로 승인한 경우에는 아래 산식으로 환불액을 계산합니다.</p>
        <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5 text-center sm:p-6">
          <p className="text-xs font-bold tracking-wide text-neutral-500">중도 해지 환불액</p>
          <p className="mt-2 text-base font-black leading-7 text-white sm:text-lg">실 결제금액 − 사용대금 − 할인·혜택 회수액 − 법령상 공제 가능한 위약금·비용</p>
        </div>
        <ul>
          <li>• 월간 구독 사용대금은 구매 당시의 할인 전 월 정상가, 실제 이용기간 및 사용한 처리시간·유료 기능을 기초로 산정합니다.</li>
          <li>• 기간 패키지는 이미 개시된 이용월에 구매 당시 표시된 월 환산 정상가 또는 상품 정상가를 적용할 수 있습니다. 패키지 결제로 받은 기간 할인과 별도 유료 혜택은 결제 당시 고지된 정상가 범위에서 회수할 수 있습니다.</li>
          <li>• 추가 처리시간은 실제 사용·확정된 시간을 구매 당시의 정상 단가로 계산합니다. 완료된 작업에 배정된 시간은 결과물의 다운로드 또는 삭제 여부와 관계없이 사용한 것으로 봅니다.</li>
          <li>• 이용자의 임의 중도 해지 또는 귀책사유로 인한 해지에는 회사의 통상 손실과 관계 법령이 허용하는 범위에서 위약금 또는 결제·환불 비용을 공제할 수 있습니다. 필요한 경우 위약금은 실 결제금액의 10% 이내에서 산정합니다.</li>
          <li>• 공제액이 실 결제금액 이상이면 환불액은 0원이며, 별도의 손해배상 사유가 없는 한 계산상 초과액을 추가 청구하지 않습니다.</li>
          <li>• 원 미만 금액은 버리며, 법령 또는 소비자분쟁해결기준이 다른 산식을 강제하면 그 기준을 적용합니다.</li>
        </ul>
      </LegalSection>

      <LegalSection title="제8조 청약철회 또는 환불이 제한되는 경우">
        <p>관련 법령이 허용하는 범위에서 다음 사유에는 단순 변심에 따른 청약철회 또는 환불이 제한됩니다.</p>
        <ul>
          <li>• 이용자가 유료 작업을 제출하여 AI 분석·전사·영상 처리 등 개별 제작 용역이 시작된 경우</li>
          <li>• 기본 또는 추가 처리시간이 전부 또는 일부 사용·확정된 경우</li>
          <li>• 생성 결과물이 정상적으로 제공되었으나 취향, 기대 조회수, 편집 선호, AI 결과의 주관적 만족도 등을 이유로 환불을 요청하는 경우</li>
          <li>• 이용자의 잘못된 URL·설정·권리 확인, 금지행위, 기기·네트워크 환경 또는 외부 플랫폼의 제한으로 이용하지 못한 경우</li>
          <li>• 유효기간이나 보관기간이 지나 처리시간 또는 결과물이 만료·삭제된 경우</li>
          <li>• 쿠폰, 이벤트, 보상 또는 프로모션으로 무상 지급된 처리시간·혜택의 현금 환급을 요청하는 경우</li>
          <li>• 회사와 사전 협의 없이 제3자에게 계정 또는 유료 권한을 양도·재판매한 경우</li>
        </ul>
        <p>AI가 생성한 제목·자막·하이라이트에는 오류나 부정확성이 있을 수 있습니다. 기술적으로 정상 완료된 결과의 내용상 선호 차이만으로는 서비스 하자에 해당하지 않습니다.</p>
      </LegalSection>

      <LegalSection title="제9조 표시·광고와 다른 제공 또는 서비스 하자">
        <p>유료서비스가 표시·광고 내용과 다르거나 계약내용과 다르게 이행된 경우, 소비자는 공급받은 날부터 3개월 이내이면서 그 사실을 안 날 또는 알 수 있었던 날부터 30일 이내에 청약철회 등을 신청할 수 있습니다.</p>
        <p>회사의 시스템 오류로 작업이 완료되지 않은 경우 회사는 우선 예약 사용량 반환, 재처리, 대체 제공 또는 이용기간 연장 등 합리적인 방법으로 문제를 바로잡을 수 있습니다. 상당한 기간 안에 정상 제공이 불가능하거나 법령상 환불 사유가 성립하면 해당 결제금액의 전부 또는 제공되지 않은 부분을 환불합니다.</p>
        <p>YouTube, 결제사, 통신망, 클라우드 또는 AI 공급자 등 제3자의 장애나 정책 변경, 천재지변과 같이 회사가 합리적으로 통제할 수 없는 사유는 회사의 귀책사유로 보지 않을 수 있습니다. 이 경우에도 회사 정책에 따라 사용량 반환이나 재시도를 제공할 수 있으나 현금 환불이 자동 발생하는 것은 아닙니다.</p>
      </LegalSection>

      <LegalSection title="제10조 추가 처리시간의 환불 및 만료">
        <p>추가 처리시간은 활성 구독자만 구매할 수 있고, 승인일부터 90일간 유효합니다. 기본 처리시간과 별도로 관리되며 유효기간 만료, 구독 종료 또는 계정 해지에 따라 사용할 수 없게 될 수 있습니다.</p>
        <p>결제일부터 7일 이내이고 추가 처리시간이 전혀 사용되지 않았다면 법령상 청약철회 기준에 따라 전액 환불할 수 있습니다. 일부라도 사용한 경우에는 청약철회가 제한되며, 관계 법령상 필요한 경우에 한해 미사용 부분에서 사용대금과 허용된 비용을 공제하여 환불합니다.</p>
        <p>추가 처리시간은 현금, 포인트 또는 다른 계정의 처리시간으로 교환·양도할 수 없습니다. 환불 승인 시 해당 구매분의 남은 처리시간은 즉시 회수됩니다.</p>
      </LegalSection>

      <LegalSection title="제11조 중복 결제·과오금·결제 도용">
        <p>회사의 책임 있는 사유로 중복 결제 또는 과오금이 발생한 경우 수수료 공제 없이 해당 금액 전액을 환불합니다. 이용자의 입력 또는 귀책사유로 과오금이 발생한 경우에는 법령이 허용하는 합리적인 범위의 반환 비용을 이용자가 부담할 수 있습니다.</p>
        <p>본인이 승인하지 않은 결제라고 주장하는 경우 회사는 계정 접속, 주문, 결제 승인 및 서비스 사용 기록을 확인하고 본인 확인이나 카드사 신고 자료를 요청할 수 있습니다. 조사 중 동일 거래에 대한 카드사 이의제기와 회사 환불 절차를 중복 진행할 수 없으며, 이중 환급이 확인되면 초과 지급액을 회수할 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="제12조 약관 위반과 회사의 계약 해지">
        <p>이용자가 이용약관, 관련 법령 또는 외부 플랫폼 정책을 위반하거나 부정한 방법으로 결제·이용량·환불 제도를 악용한 경우 회사는 작업 취소, 이용 제한, 계정 정지 또는 계약 해지를 할 수 있습니다.</p>
        <p>이용자의 귀책사유로 계약이 종료되면 사용대금, 회수 대상 할인·혜택, 미납금, 회사가 입은 손해 및 법령상 허용되는 비용을 환불액에서 공제할 수 있습니다. 중대한 불법행위, 결제 사기 또는 권리침해에 대해서는 환불 여부와 별도로 손해배상을 청구할 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="제13조 환불 신청 방법">
        <p>환불은 아래 고객센터 이메일로 신청해야 합니다. 구독 해지 예약만으로 환불 신청이 접수되지는 않습니다.</p>
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-5 sm:p-6">
          <p><strong className="inline-block w-24 text-white">이메일</strong><a href="mailto:artiroom176@gmail.com" className={accentLink}>artiroom176@gmail.com</a></p>
          <p><strong className="inline-block w-24 text-white">전화</strong><a href="tel:010-4836-2874" className={accentLink}>010-4836-2874</a></p>
          <p><strong className="inline-block w-24 text-white">운영시간</strong>평일 14:00 ~ 19:00</p>
        </div>
        <p>신청 시 계정 이메일, 결제일, 결제금액, 상품명, 주문번호와 구체적인 사유를 보내야 합니다. 회사는 본인·결제 사실·사용 내역·환불 사유 확인에 필요한 최소한의 자료를 추가로 요청할 수 있습니다.</p>
        <p>신청일은 정상적으로 발송된 전자문서가 회사에 도달한 때를 기준으로 합니다. 다만, 법령상 서면 청약철회는 이용자가 의사표시를 기재한 서면을 발송한 날에 효력이 발생합니다.</p>
      </LegalSection>

      <LegalSection title="제14조 환불 방법과 처리 기간">
        <ol className="grid gap-3">
          <li>1. 환불 사유와 금액이 확정되면 회사는 법정 기한 안에 원 결제수단의 승인 취소 또는 환급을 요청합니다. 청약철회나 해제·해지에 따른 온라인 콘텐츠 대금은 원칙적으로 관련 통지를 받은 날부터 3영업일 이내에 처리합니다.</li>
          <li>2. 카드 결제는 원칙적으로 해당 카드 승인 취소 방식으로 처리하며, 다른 사람의 카드·계좌나 현금으로 변경 지급하지 않습니다.</li>
          <li>3. 원 결제수단으로 반환할 수 없는 경우 회사는 그 사실을 알리고 본인 명의 계좌 등 확인 가능한 대체 수단을 요청할 수 있습니다.</li>
          <li>4. 회사가 승인 취소를 완료한 뒤 실제 카드 한도 복원이나 대금 반영까지 걸리는 기간은 카드사와 결제일에 따라 달라질 수 있습니다.</li>
          <li>5. 환불과 동시에 해당 유료 권한, 남은 처리시간, 다운로드 권한 또는 제공 혜택을 회수할 수 있습니다. 이미 발급된 현금영수증 등 결제 증빙은 환불금액에 맞게 취소·정정됩니다.</li>
        </ol>
      </LegalSection>

      <LegalSection title="제15조 기록, 입증 및 부정 환불 방지">
        <p>회사는 결제, 사용량 예약·확정·반환, 작업 성공·실패, 다운로드, 구독 변경 및 환불 처리 기록을 관련 법령과 <Link href="/privacy" className={accentLink}>개인정보처리방침</Link>이 정한 기간 동안 보관할 수 있습니다.</p>
        <p>계약 체결과 공급 개시, 사용 여부, 청약철회 제한 사유 또는 이용자 귀책 여부에 다툼이 있는 경우 회사는 관련 법령에 따른 입증책임을 부담합니다. 이용자는 사실과 다른 자료 제출, 반복적 결제 취소, 결과물 이용 후 환불 등 부정한 방법으로 환불을 신청해서는 안 됩니다.</p>
      </LegalSection>

      <LegalSection title="제16조 정책 변경, 준거 기준 및 분쟁 해결">
        <p>본 정책은 결제 당시 표시된 버전을 해당 거래에 적용하는 것을 원칙으로 합니다. 법령, 결제 구조 또는 서비스 내용의 변경에 따라 정책을 개정할 수 있으며, 이용자에게 불리한 중대한 변경은 시행 전에 서비스 화면 등을 통해 알립니다.</p>
        <p>본 정책에서 정하지 않은 사항은 <Link href="/terms" className={accentLink}>서비스 이용약관</Link>, 결제 화면에 표시된 개별 조건, 대한민국 관계 법령 및 소비자분쟁해결기준에 따릅니다.</p>
        <p>분쟁이 해결되지 않는 경우 1372 소비자상담센터, 한국소비자원 또는 콘텐츠분쟁조정위원회에 상담·조정을 신청할 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="제17조 사업자 및 환불 담당자 정보">
        <div className="overflow-x-auto">
          <table><tbody>
            <tr><th>상호</th><td>아티룸</td></tr>
            <tr><th>대표</th><td>김동민</td></tr>
            <tr><th>사업자등록번호</th><td>638-04-03590</td></tr>
            <tr><th>통신판매업 신고번호</th><td>2025-서울마포-2971</td></tr>
            <tr><th>주소</th><td>서울특별시 마포구 성산로8길 40</td></tr>
            <tr><th>환불 문의</th><td><a href="mailto:artiroom176@gmail.com" className={accentLink}>artiroom176@gmail.com</a> · <a href="tel:010-4836-2874" className={accentLink}>010-4836-2874</a></td></tr>
          </tbody></table>
        </div>
      </LegalSection>
    </LegalDocument>
  );
}
