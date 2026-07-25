import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "유료서비스 구매약관 | Easy Cut",
  description: "이지컷 월간 구독, 기간 패키지 및 추가 처리시간 구매 조건을 안내합니다.",
  path: "/purchase-terms",
});

const accentLink = "font-bold text-[#ff8c7c] underline underline-offset-4";

export default function PurchaseTermsPage() {
  return (
    <LegalDocument
      eyebrow="Purchase Terms"
      title="유료서비스 구매약관"
      description="본 약관은 Easy Cut의 월간 구독, 기간 패키지 및 추가 처리시간 구매에 적용되는 결제·제공 조건을 정합니다. 결제 전 상품, 금액, 적용일과 환불 규정을 함께 확인해 주세요."
      effectiveDate="2026년 7월 26일"
    >
      <section aria-labelledby="purchase-summary" className="overflow-hidden rounded-3xl border border-[#ff8c7c]/25 bg-[linear-gradient(135deg,rgba(255,113,94,.12),rgba(160,120,255,.07))] p-5 sm:p-7">
        <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff9b8d]">Before you pay</p>
        <h2 id="purchase-summary" className="mt-2 text-xl font-black tracking-tight text-white">결제 전 확인해 주세요</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">월간 구독</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">매월 같은 결제일에 자동결제되며, 해지 예약 전까지 갱신됩니다.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">기간 패키지</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">3·6·12개월 이용료를 한 번 결제하고, 상품별 처리시간을 매월 부여합니다.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">추가 처리시간</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">일반결제로 구매하며 승인일부터 90일 동안 사용할 수 있습니다.</p>
          </div>
        </div>
        <p className="mt-5 text-xs leading-6 text-neutral-400">관계 법령이 본 약관보다 이용자에게 유리하게 적용되는 경우에는 해당 법령이 우선합니다.</p>
      </section>

      <LegalSection title="제1조 목적 및 적용 범위">
        <p>본 약관은 아티룸(이하 “회사”)이 Easy Cut을 통해 판매하는 월간 유료 구독, 기간 패키지, 상품 변경, 추가 처리시간 및 그 밖의 유료 디지털 서비스(이하 “유료서비스”)의 구매 조건을 정합니다.</p>
        <p><Link href="/terms" className={accentLink}>서비스 이용약관</Link>, <Link href="/refund" className={accentLink}>취소 및 환불 정책</Link>, <Link href="/privacy" className={accentLink}>개인정보처리방침</Link>도 함께 적용됩니다. 결제 확인 화면에 상품별 조건이 별도로 표시된 경우 그 조건을 우선 적용하되, 관계 법령에 따른 이용자의 권리를 제한하지 않습니다.</p>
      </LegalSection>

      <LegalSection title="제2조 판매자 정보">
        <div className="overflow-x-auto">
          <table><tbody>
            <tr><th>상호</th><td>아티룸</td></tr>
            <tr><th>대표</th><td>김동민</td></tr>
            <tr><th>사업자등록번호</th><td>638-04-03590</td></tr>
            <tr><th>통신판매업 신고번호</th><td>2025-서울마포-2971</td></tr>
            <tr><th>주소</th><td>서울특별시 마포구 성산로8길 40</td></tr>
            <tr><th>고객센터</th><td>010-4836-2874 · artiroom176@gmail.com · 평일 14:00~19:00</td></tr>
          </tbody></table>
        </div>
      </LegalSection>

      <LegalSection title="제3조 상품과 결제 방식">
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>상품</th><th>결제 방식</th><th>제공 방식</th></tr></thead>
            <tbody>
              <tr><td>이지컷 프로</td><td>매월 결제일 자동결제</td><td>월 60분과 구독 전용 기능 제공</td></tr>
              <tr><td>기간 패키지</td><td>3·6·12개월 이용료 1회 결제</td><td>상품별 처리시간을 매월 제공하며 자동갱신하지 않음</td></tr>
              <tr><td>얼리버드 추가시간</td><td>구매 시 1회 결제</td><td>승인일부터 90일간 제공하며 기본 처리시간과 별도로 계산</td></tr>
            </tbody>
          </table>
        </div>
        <p>구매 시 결제 확인 화면에 표시되는 상품명, 플랜, 결제 주기, 결제금액, 제공량, 적용일 및 다음 결제일이 해당 주문의 구체적인 계약 내용이 됩니다. 세금은 별도 표시가 없는 한 표시 금액에 포함됩니다.</p>
      </LegalSection>

      <LegalSection title="제4조 주문과 계약 성립">
        <ol className="grid gap-3">
          <li>1. 이용자는 상품을 선택한 뒤 결제 확인 화면에서 결제금액, 적용일, 다음 결제일 및 구매·환불 조건을 확인합니다.</li>
          <li>2. 이용자가 구매약관 및 취소·환불 규정에 동의하고 최종 결제 버튼을 누르면 저장된 결제수단 또는 입력한 결제수단으로 승인 요청이 진행됩니다. 확인창을 열거나 상품을 선택하는 것만으로는 결제가 발생하지 않습니다.</li>
          <li>3. 결제기관의 승인이 완료되고 회사가 주문 완료 사실을 표시하거나 전자문서로 알린 때 계약이 성립합니다. 승인이 실패하거나 결제 상태를 확인할 수 없는 경우 회사는 유료 권한을 제공하지 않고 거래 상태를 확인할 수 있습니다.</li>
          <li>4. 하위 플랜 변경 등 확인 화면에 “변경 예약”으로 표시되는 주문은 예약 시점에 결제되지 않습니다. 현재 기간 종료 후 새 플랜의 결제가 완료되어야 변경이 적용됩니다.</li>
        </ol>
      </LegalSection>

      <LegalSection title="제5조 구독 갱신과 해지">
        <p>월간 구독은 이용자가 해지를 확정할 때까지 결제 확인 화면에 표시된 결제일과 금액을 기준으로 매월 자동갱신됩니다. 각 결제가 승인될 때 월 처리시간 60분이 즉시 지급되고, 이미 남아 있는 Pro 이용기간의 끝에 유료 이용기간 1개월이 추가됩니다.</p>
        <p>월간 구독 해지를 최종 확정하면 결제대행사의 자동결제 일정은 즉시 중지됩니다. 이미 결제한 Pro 이용기간과 지급된 처리시간은 각 유효기간까지 유지되지만, 다음 자동결제와 그에 따른 처리시간 지급은 발생하지 않습니다.</p>
        <p>해지 예정 상태에서 “다시 구독하기”를 선택하면 저장 카드 확인 후 월 이용료가 즉시 결제됩니다. 승인 즉시 월 처리시간 60분을 지급하고 남아 있는 Pro 이용기간 끝에 1개월을 추가하며, 이후 자동결제 일정을 다시 활성화합니다. 이는 해지 예약의 단순 철회가 아니라 새로운 유료 결제입니다.</p>
        <p>기간 패키지는 선택한 3·6·12개월 이용료를 한 번에 결제하며 자동갱신되지 않습니다. 상품이 활성 상태인 동안 설정된 지급일마다 월 처리시간을 부여하며, 해지·환불 등으로 종료되거나 이용기간이 끝난 뒤에는 새 처리시간을 지급하지 않습니다.</p>
        <p>회사가 장래 결제금액이나 중요한 조건을 변경하는 경우 시행 전에 그 내용을 알리고, 관계 법령상 필요한 동의 또는 절차를 거칩니다. 변경된 가격은 이미 결제가 완료된 기간에 소급 적용되지 않습니다.</p>
      </LegalSection>

      <LegalSection title="제6조 상품 변경">
        <p>이지컷 프로 이용 중 기간 패키지를 선택하면 현재 월간 결제기간 종료일로 변경이 예약됩니다. 예약 시 새 결제나 환불은 발생하지 않으며, 현재 기간이 끝난 뒤 요금제 페이지에서 패키지 결제를 완료하면 새 상품이 적용됩니다.</p>
        <p>스타터·전문가의 3·6·12개월 기간 패키지는 각 상품별로 계정당 한 번만 구매할 수 있습니다. 이미 구매한 상품과 다른 기간 또는 등급의 패키지는 각각 한 번씩 추가 구매할 수 있으며, 각 패키지는 결제 승인일부터 독립적인 이용기간을 시작하고 월별 처리시간을 합산해 지급합니다. 패키지 이용 중에는 이지컷 프로 월간 구독을 추가할 수 없습니다. 별도로 구매한 추가 처리시간은 표시된 유효기간까지 유지됩니다.</p>
        <p>기간 패키지를 포함한 모든 카드 결제는 일시불로만 제공되며, 결제 화면에서 할부를 선택할 수 없습니다.</p>
      </LegalSection>

      <LegalSection title="제7조 유료서비스의 제공과 사용">
        <p>결제 승인 후 해당 계정에 유료 권한과 처리시간이 부여되어 이용 가능해진 때 유료서비스의 공급이 개시됩니다. 이용량은 생성된 쇼츠의 길이가 아니라 처리 대상으로 제출한 원본 영상의 전체 길이를 기준으로 계산합니다.</p>
        <p>실시간 인기 페이지의 기본 급상승 목록은 결제 전에도 시험할 수 있습니다. 활성 이용권 전용 필터를 선택한 뒤 회사 서버가 필터 조건에 맞는 결과를 정상 제공하면 해당 유료 기능의 사용이 시작된 것으로 기록합니다. 기본 목록 열람, 비회원·무료회원이 잠긴 필터를 누른 행위, 오류로 결과가 제공되지 않은 요청은 유료 기능 사용으로 기록하지 않습니다.</p>
        <p>유료 인기 필터의 사용 기록에는 사용 시각, 적용한 인기 기준·카테고리·언어·길이·재사용 조건, 결과 수, 당시 권한을 제공한 구독과 주문 식별자가 포함될 수 있으며, 이용 내역 확인과 청약철회·환불 요건 검증에 사용됩니다.</p>
        <p>서비스는 3분 이상 60분 이하의 롱폼 원본 영상에서 쇼츠 후보를 만드는 기능입니다. YouTube Shorts 등 3분 미만의 숏폼 영상을 입력해 다시 쇼츠로 만드는 기능은 지원하지 않으며, 이용자는 결제와 작업 제출 전에 원본 영상의 길이와 지원 여부를 확인해야 합니다.</p>
        <p>기간 패키지는 첫 월 처리시간을 결제 승인 즉시 지급하고, 이후 활성 이용기간 중 매월 설정된 지급일에 같은 상품의 월 처리시간을 추가합니다. 복수의 패키지를 구매한 경우 각 구매 건의 처리시간이 독립적으로 지급되어 합산되며, 각 패키지가 종료된 뒤에는 해당 구매 건의 추가 지급이 중단됩니다.</p>
        <p>추가 처리시간은 기본 제공시간과 별도로 차감되며 승인일부터 90일간 유효합니다. 유료 권한, 처리시간, 결과물의 보관기간과 기능 범위는 구매한 상품 및 요금제의 표시 내용에 따릅니다.</p>
        <p>기본·추가 처리시간은 Easy Cut 안에서 원본 영상 처리 가능량을 측정하는 서비스 이용 한도입니다. 이전 가능한 금전적 가치를 저장한 수단이 아니고 제3자의 재화·용역 결제에 사용할 수 없으며, 다른 계정으로 양도하거나 현금·포인트로 환전할 수 없으므로 「전자금융거래법」상 선불전자지급수단에 해당하지 않습니다.</p>
        <p>처리시간이 선불전자지급수단에 해당하지 않는다는 점은 이용자의 법정 청약철회, 계약 해제·해지, 과오금 반환 또는 관계 법령과 <Link href="/refund" className={accentLink}>취소 및 환불 정책</Link>에 따른 환불 권리를 제한하지 않습니다.</p>
        <p>AI 생성 결과에는 오류나 결과 편차가 있을 수 있으므로 이용자는 게시 전 정확성과 권리 관계를 확인해야 합니다. 다만, 이 조는 표시·광고와 다른 제공, 서비스 하자 또는 관계 법령상 환불 권리를 배제하지 않습니다.</p>
      </LegalSection>

      <LegalSection title="제8조 청약철회·취소 및 환불">
        <p>청약철회, 구독 해지, 중도 해지, 부분 환불, 과오금 및 환불 신청 방법은 <Link href="/refund" className={accentLink}>취소 및 환불 정책</Link>에 따릅니다.</p>
        <p>소비자는 원칙적으로 계약내용에 관한 서면을 받은 날 또는 유료서비스 공급이 시작된 날 중 늦은 날부터 7일 이내에 청약철회를 신청할 수 있습니다. 다만 이용자의 동의를 받아 디지털콘텐츠 또는 개별 용역의 제공이 시작된 경우 등 관계 법령이 정한 사유에는 청약철회가 제한될 수 있습니다.</p>
        <p>여러 개의 가분적 콘텐츠나 용역으로 구성된 상품은 아직 제공이 시작되지 않은 부분에 관하여 법령상 청약철회가 인정될 수 있습니다. 표시·광고와 다르게 제공되었거나 회사의 귀책사유로 정상 제공되지 않은 경우에는 관계 법령과 취소 및 환불 정책에 따라 처리합니다.</p>
        <p>유료 인기 필터 결과가 정상 제공된 기록이 있으면 ‘7일 이내 미사용 전액환불’ 요건에는 해당하지 않을 수 있습니다. 다만 단순 클릭만으로 별도 위약금을 부과하지 않으며, 계약체결일 또는 이용 가능일부터 7일 이내의 중도해지는 취소 및 환불 정책에 따라 중도해지 위약금 없이 경과 이용대금만 정산합니다.</p>
      </LegalSection>

      <LegalSection title="제9조 결제 정보와 과오금">
        <p>회사는 결제를 위해 더페이원 등 결제대행사에 필요한 정보를 전달합니다. 카드번호, 유효기간, 생년월일·사업자번호 및 카드 비밀번호 앞 2자리는 회사 데이터베이스에 저장하지 않습니다. 다음 결제에서 이용할 수 있도록 결제대행사가 발급한 결제수단 토큰과 암호화한 휴대전화 번호 등 최소 정보만 저장할 수 있습니다.</p>
        <p>중복 결제나 과오금이 확인되면 관계 법령과 취소 및 환불 정책에 따라 원 결제수단으로 취소 또는 환급합니다. 결제 실패나 미납 상태에서는 유료 권한의 제공 또는 일부 기능 이용이 제한될 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="제10조 약관 변경, 분쟁 해결 및 문의">
        <p>회사는 관계 법령을 위반하지 않는 범위에서 본 약관을 변경할 수 있습니다. 이용자에게 불리한 중요한 변경은 시행 전에 서비스 화면 또는 전자문서로 안내합니다.</p>
        <p>본 약관은 대한민국 법령에 따라 해석됩니다. 분쟁이 발생하면 당사자 간 협의를 통해 해결하며, 해결되지 않는 경우 관계 법령이 정한 절차와 관할 법원에 따릅니다.</p>
        <p>구매 및 환불 문의: <a href="mailto:artiroom176@gmail.com" className={accentLink}>artiroom176@gmail.com</a> · <a href="tel:010-4836-2874" className={accentLink}>010-4836-2874</a> · 평일 14:00~19:00</p>
      </LegalSection>
    </LegalDocument>
  );
}
