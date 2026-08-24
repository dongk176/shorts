import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "유료서비스 구매약관 | Easy Cut",
  description: "이지컷 프로 월간 구독과 X3·X6 사용량 패키지의 결제·제공 조건을 안내합니다.",
  path: "/purchase-terms",
});

const accentLink = "font-bold text-[#ff8c7c] underline underline-offset-4";

export default function PurchaseTermsPage() {
  return (
    <LegalDocument
      eyebrow="Purchase Terms"
      title="유료서비스 구매약관"
      description="Easy Cut의 월간 구독과 X3·X6 사용량 패키지에 적용되는 결제·제공 조건입니다. 결제 전 제공량, 유효기간, AI 결과의 특성과 환불 기준을 확인해 주세요."
      effectiveDate="2026년 7월 27일 개정 · 구매약관 v3"
    >
      <section
        aria-labelledby="purchase-summary"
        className="overflow-hidden rounded-3xl border border-[#ff8c7c]/25 bg-[linear-gradient(135deg,rgba(255,113,94,.12),rgba(160,120,255,.07))] p-5 sm:p-7"
      >
        <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff9b8d]">
          Before you pay
        </p>
        <h2
          id="purchase-summary"
          className="mt-2 text-xl font-black tracking-tight text-white"
        >
          결제 전 확인해 주세요
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">이지컷 프로</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">
              매월 자동결제되며 결제 주기마다 60분이 지급됩니다. 해지하면 다음 결제부터
              중단됩니다.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">X3·X6 사용량 패키지</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">
              1회 결제 상품입니다. 월별 배정 없이 표시된 전체 처리시간이 결제 완료 즉시
              지급됩니다.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">AI 결과와 사용 처리</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">
              정상 완료된 작업은 사용 처리됩니다. 취향이나 기대 차이는 사용량 복구 사유가
              아닙니다.
            </p>
          </div>
        </div>
        <p className="mt-5 text-xs leading-6 text-neutral-400">
          X3·X6는 기간이 아니라 사용량 배수를 뜻합니다. 패키지 사용량의 유효기간은
          지급일부터 12개월이며 자동결제되지 않습니다.
        </p>
      </section>

      <LegalSection title="제1조 목적 및 적용 범위">
        <p>
          본 약관은 아티룸(이하 “회사”)이 Easy Cut을 통해 판매하는 이지컷 프로 월간
          구독, 스타터·전문가 X3·X6 사용량 패키지, 별도 추가 처리시간 및 그 밖의 유료
          디지털 서비스(이하 “유료서비스”)의 구매 조건을 정합니다.
        </p>
        <p>
          <Link href="/terms" className={accentLink}>서비스 이용약관</Link>,{" "}
          <Link href="/refund" className={accentLink}>취소 및 환불 정책</Link>,{" "}
          <Link href="/privacy" className={accentLink}>개인정보처리방침</Link>도 함께
          적용됩니다. 결제 화면에 상품별 조건이 별도로 표시된 경우 그 조건을 우선 적용하되,
          관계 법령에 따른 이용자의 권리를 제한하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="제2조 판매자 정보">
        <div className="overflow-x-auto">
          <table>
            <tbody>
              <tr><th>상호</th><td>아티룸</td></tr>
              <tr><th>대표</th><td>김동민</td></tr>
              <tr><th>사업자등록번호</th><td>638-04-03590</td></tr>
              <tr><th>통신판매업 신고번호</th><td>2025-서울마포-2971</td></tr>
              <tr><th>주소</th><td>서울특별시 마포구 성산로8길 40</td></tr>
              <tr>
                <th>고객센터</th>
                <td>010-4836-2874 · easycut@easycut.co.kr · 평일 14:00~19:00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection title="제3조 상품과 결제 방식">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr><th>상품</th><th>결제 방식</th><th>제공 방식</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>이지컷 프로</td>
                <td>매월 결제일 자동결제</td>
                <td>결제 주기마다 60분과 구독 전용 기능 제공</td>
              </tr>
              <tr>
                <td>스타터·전문가 X3·X6</td>
                <td>구매 시 1회 결제</td>
                <td>표시된 전체 처리시간을 즉시 지급하고 12개월간 제공</td>
              </tr>
              <tr>
                <td>별도 추가 처리시간</td>
                <td>구매 시 1회 결제</td>
                <td>결제 화면에 표시된 제공량과 유효기간에 따라 제공</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          X3와 X6는 개월 수가 아니라 각 기준 상품 대비 사용량 배수를 뜻합니다. 사용량
          패키지에는 월별 지급, 월별 사용 제한 또는 자동갱신이 없습니다.
        </p>
        <p>
          상품명, 총 처리시간, 결제금액, 할인, 예상 제작량, 유효기간, 제공 기능과
          환불정책 버전은 결제 확인 화면에 표시된 내용이 해당 주문의 구체적인 계약 내용이
          됩니다. 세금은 별도 표시가 없는 한 표시 금액에 포함됩니다.
        </p>
      </LegalSection>

      <LegalSection title="제4조 주문과 계약 성립">
        <ol className="grid gap-3">
          <li>
            1. 이용자는 상품을 선택한 뒤 결제 확인 화면에서 상품명, 결제금액, 총
            처리시간, 유효기간, 자동결제 여부와 구매·환불 조건을 확인합니다.
          </li>
          <li>
            2. 이용자가 구매약관과 취소·환불 정책에 동의하고 최종 결제 버튼을 누르면
            입력하거나 등록한 결제수단으로 승인 요청이 진행됩니다. 상품 선택이나 결제창
            열기만으로는 결제가 발생하지 않습니다.
          </li>
          <li>
            3. 결제기관의 승인이 완료되고 회사가 주문 완료 사실을 화면 또는 전자문서로
            알린 때 계약이 성립합니다. 승인 실패 또는 결제 상태 미확인 시에는 유료 권한과
            사용량을 제공하지 않습니다.
          </li>
          <li>
            4. 회사는 결제 완료 후 주문번호, 상품명, 결제금액, 공급 내용, 적용 약관과
            환불정책 버전을 확인할 수 있는 전자문서를 제공합니다.
          </li>
        </ol>
      </LegalSection>

      <LegalSection title="제5조 이지컷 프로의 갱신과 해지">
        <p>
          이지컷 프로는 이용자가 해지를 확정할 때까지 결제 화면에 표시된 결제일과 금액을
          기준으로 매월 자동갱신됩니다. 결제가 승인될 때마다 월 처리시간 60분과 해당
          결제기간의 유료 권한이 제공됩니다.
        </p>
        <p>
          구독 해지를 확정하면 다음 자동결제가 중단됩니다. 이미 결제한 현재 결제기간은
          원칙적으로 종료일까지 유지되며, 해지 예약만으로 현재 결제가 자동 환불되지는
          않습니다. 즉시 종료와 환불은 취소 및 환불 정책과 관계 법령에 따라 별도로
          처리합니다.
        </p>
        <p>
          회사가 장래 결제금액이나 중요한 조건을 변경하는 경우 시행 전에 알리고 관계
          법령상 필요한 동의 절차를 거칩니다. 변경된 가격은 이미 결제된 기간에 소급
          적용하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="제6조 X3·X6 사용량 패키지">
        <p>
          사용량 패키지는 한 번 결제하는 비자동갱신 상품입니다. 결제 승인 즉시 결제
          화면에 표시된 전체 처리시간을 해당 계정에 지급하며, 지급일부터 12개월 동안
          사용할 수 있습니다.
        </p>
        <p>
          패키지 사용량은 월별로 나누어 지급되지 않고 특정 월에 사용해야 하는 의무도
          없습니다. 유효기간 안에서 이용자가 필요한 시점에 사용할 수 있으며, 유효기간이
          지나면 관계 법령상 별도 반환 의무가 인정되는 경우를 제외하고 남은 사용량과
          부가 혜택은 소멸합니다.
        </p>
        <p>
          여러 사용량 주문을 보유한 경우 회사는 유효기간이 먼저 끝나는 주문부터 사용량을
          차감할 수 있습니다. 주문별 지급량, 사용량, 복구량, 잔량과 유효기간은 독립된
          원장으로 관리합니다.
        </p>
        <p>
          사용량 패키지는 Easy Cut 안에서만 사용할 수 있는 서비스 이용 한도이며, 다른
          계정으로 양도하거나 제3자의 재화·용역 결제에 사용하거나 현금·포인트로 환전할 수
          없습니다.
        </p>
      </LegalSection>

      <LegalSection title="제7조 유료서비스의 제공과 사용 처리">
        <p>
          결제 승인 후 해당 계정에 유료 권한 또는 처리시간이 부여되어 이용 가능해진 때
          유료서비스의 공급이 개시됩니다. 사용량은 생성된 쇼츠의 길이가 아니라 처리를 위해
          제출한 원본 영상의 전체 길이를 기준으로 예약·차감합니다.
        </p>
        <p>
          작업이 기술적으로 정상 완료되어 결과물이 제공되면 해당 작업에 예약된 사용량을
          확정 차감합니다. 결과의 편집 취향, 기대한 조회수, 인물 유사도, 장면 선택 또는
          프롬프트 해석 차이 같은 주관적 불만족은 사용량 복구나 사용분 환불 사유가 아닙니다.
        </p>
        <p>
          회사 시스템 오류로 결과물이 생성되지 않거나 작업이 실패 상태로 종료되면 해당
          작업의 예약 사용량을 반환합니다. 중복 차감이나 반환 누락이 확인되면 사용 기록을
          정정합니다.
        </p>
        <p>
          이용자는 결제 전에 <Link href="/projects" className={accentLink}>예시 작업</Link>과
          지원 범위를 확인할 수 있습니다. AI 결과는 원본, 음질, 언어, 설정과 모델 특성에
          따라 예시와 달라질 수 있습니다. 다만 약속한 기능·해상도가 제공되지 않거나
          표시·광고 및 계약 내용과 명백히 다르게 이행된 객관적 하자는 별도로 처리합니다.
        </p>
        <p>
          프로젝트와 결과물은 상품에 표시된 기간 동안 보관합니다. 보관기간이 끝나거나
          이용자가 삭제한 결과물은 복구할 수 없으므로 필요한 파일은 미리 내려받아야 합니다.
        </p>
      </LegalSection>

      <LegalSection title="제8조 청약철회·해지 및 환불">
        <p>
          구체적인 청약철회, 구독 해지, 사용량 패키지 중도 해지, 사용분 공제, 회사 귀책,
          과오금과 신청 방법은{" "}
          <Link href="/refund" className={accentLink}>취소 및 환불 정책</Link>에 따릅니다.
        </p>
        <p>
          법정 기간 안에 전혀 사용하지 않은 주문은 관계 법령에 따라 전액 청약철회가
          가능합니다. 일부 사용한 가분적 용역 또는 디지털콘텐츠는 이미 제공된 사용분을
          제외하고 아직 제공이 시작되지 않은 부분에 법정 청약철회가 인정될 수 있습니다.
        </p>
        <p>
          법정 기간이 지난 단순 변심에는 회사가 임의로 환불을 제공하지 않는 것을 원칙으로
          합니다. 다만 사용기간, 금액과 거래의 실질상 계속거래 해지 규정 또는 그 밖의
          강행규정이 적용되는 경우에는 미사용 부분에서 실제 제공대금과 법령상 허용되는
          위약금을 공제한 금액을 환급합니다.
        </p>
        <p>
          정상 완료 작업에 대한 주관적 불만족은 이미 사용한 사용량의 복구·환불 사유가
          아닙니다. 결제 전 예시 확인과 개별 동의는 이러한 서비스 특성을 확인하기 위한
          절차이며, 법정 청약철회·해제·해지 또는 객관적 하자에 관한 권리를 포기시키는
          절차가 아닙니다.
        </p>
        <p>
          결제 당시 구매약관 v2 또는 환불정책 v1·v2가 표시·기록된 주문에는 당시 정책을
          적용합니다.{" "}
          <Link href="/purchase-terms/versions/2" className={accentLink}>
            구매약관 v2
          </Link>{" "}
          ·{" "}
          <Link href="/refund/versions/1" className={accentLink}>환불정책 v1</Link>
          {" "}·{" "}
          <Link href="/refund/versions/2" className={accentLink}>환불정책 v2</Link>
        </p>
      </LegalSection>

      <LegalSection title="제9조 결제 정보와 과오금">
        <p>
          회사는 결제를 위해 더페이원 등 결제대행사에 필요한 정보를 전달합니다. 카드번호,
          유효기간, 생년월일·사업자번호 및 카드 비밀번호 앞 2자리는 회사 데이터베이스에
          저장하지 않습니다. 정기결제에 필요한 결제수단 토큰과 암호화한 연락처 등 최소
          정보만 저장할 수 있습니다.
        </p>
        <p>
          중복 결제나 과오금이 확인되면 관계 법령과 취소 및 환불 정책에 따라 원
          결제수단으로 취소 또는 환급합니다. 결제 실패나 미납 상태에서는 유료 권한 또는
          사용량을 제공하지 않거나 이용을 제한할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제10조 약관 변경, 분쟁 해결 및 문의">
        <p>
          회사는 관계 법령을 위반하지 않는 범위에서 본 약관을 변경할 수 있습니다.
          이용자에게 불리한 중요한 변경은 시행 전에 서비스 화면 또는 전자문서로
          안내하며, 변경된 약관을 기존 주문에 불리하게 소급 적용하지 않습니다.
        </p>
        <p>
          본 약관은 대한민국 법령에 따라 해석됩니다. 분쟁은 당사자 간 협의를 통해
          해결하며, 해결되지 않는 경우 관계 법령이 정한 분쟁조정 절차와 관할 법원에
          따릅니다.
        </p>
        <p>
          구매 및 환불 문의:{" "}
          <a href="mailto:easycut@easycut.co.kr" className={accentLink}>
            easycut@easycut.co.kr
          </a>{" "}
          ·{" "}
          <a href="tel:010-4836-2874" className={accentLink}>010-4836-2874</a>
          {" "}· 평일 14:00~19:00
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
