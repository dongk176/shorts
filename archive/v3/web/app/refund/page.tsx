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
      ?? "이지컷 유료서비스의 취소·환불 제한과 처리 기준을 안내합니다.",
    path: "/refund",
  });
}

const accentLink = "font-bold text-[#ff8c7c] underline underline-offset-4";

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      eyebrow="Cancellation & Refund Policy"
      title="취소 및 환불 정책"
      description="Easy Cut 유료서비스의 취소, 청약철회, 해지 및 환불 처리 기준입니다."
      effectiveDate="2026년 7월 28일 개정 · 환불정책 v3 신규 주문부터"
      translations={refundTranslations}
    >
      <section
        aria-labelledby="refund-summary"
        className="overflow-hidden rounded-3xl border border-[#ff8c7c]/25 bg-[linear-gradient(135deg,rgba(255,113,94,.12),rgba(160,120,255,.07))] p-5 sm:p-7"
      >
        <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff9b8d]">
          Before you request
        </p>
        <h2
          id="refund-summary"
          className="mt-2 text-xl font-black tracking-tight text-white"
        >
          환불 전 확인해 주세요
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">서비스 제공 개시</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">
              결제 후 유료 권한·사용량이 지급되거나 제공이 시작되면 청약철회와 환불이
              제한될 수 있습니다.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">정상 완료 작업</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">
              정상 완료된 작업은 사용 처리되며, 주관적 불만족만으로 사용량을 복구하거나
              환불하지 않습니다.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <strong className="block text-sm text-white">단순 변심</strong>
            <p className="mt-2 text-xs leading-6 text-neutral-400">
              법정 청약철회 기간이 지난 뒤의 단순 변심에는 임의 환불을 제공하지 않습니다.
            </p>
          </div>
        </div>
        <p className="mt-5 text-xs leading-6 text-neutral-400">
          환불 가능 여부와 금액은 결제 당시의 정책 버전, 서비스 제공 및 사용 기록을
          기준으로 심사합니다.
        </p>
      </section>

      <LegalSection title="제1조 목적 및 적용 범위">
        <p>
          본 정책은 아티룸(이하 “회사”)이 Easy Cut에서 판매하는 월간 구독, X3·X6 사용량
          패키지, 별도 추가 처리시간 및 그 밖의 유료서비스에 적용됩니다.
        </p>
        <p>
          상품, 금액, 제공량, 유효기간, 자동결제 여부, 개별 동의 내용과 결제 당시 표시된
          정책 버전이 해당 주문의 조건이 됩니다. 관계 법령의 강행규정은 본 정책보다
          우선합니다.
        </p>
      </LegalSection>

      <LegalSection title="제2조 상품별 기본 기준">
        <p>
          이지컷 프로는 월간 자동결제 상품입니다. 해지를 확정하면 다음 결제가 중단되며,
          해지 예약만으로 이미 승인된 결제가 취소되거나 환불되지는 않습니다.
        </p>
        <p>
          X3·X6 패키지는 결제 승인 즉시 표시된 전체 처리시간이 지급되는 1회 결제
          상품입니다. 사용량은 지급일부터 12개월 동안 유효하고 자동갱신되지 않으며,
          만료된 잔량은 현금이나 포인트로 전환되지 않습니다.
        </p>
        <p>
          작업에 제출한 원본 영상 길이는 처리 중 예약되고 정상 완료 시 확정 차감됩니다.
          여러 사용량 원장이 있는 경우 회사는 유효기간이 먼저 끝나는 원장부터 차감할 수
          있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제3조 청약철회 및 환불 제한">
        <p>
          청약철회와 환불은 관계 법령이 정한 기간과 요건을 충족하는 경우에만 처리합니다.
          결제 후 유료서비스의 제공이 시작되었거나 사용량이 예약·차감된 경우, 유료 결과·
          기능·파일·가이드가 제공된 경우 또는 이용자 책임으로 정상 이용이 불가능한
          경우에는 관계 법령이 허용하는 범위에서 청약철회나 환불이 제한됩니다.
        </p>
        <p>
          결제일부터 7일 이내의 신청이라도 자동으로 환불되는 것은 아닙니다. 회사는 주문,
          사전 고지와 동의, 권한 지급, 사용량 및 콘텐츠 제공 기록을 확인한 뒤 처리 여부를
          결정합니다.
        </p>
      </LegalSection>

      <LegalSection title="제4조 7일 이후 단순 변심과 중도 해지">
        <p>
          법정 청약철회 기간이 지난 뒤 취향 변화, 이용 필요성 소멸, 다른 서비스 선택 또는
          정상 완료 결과에 대한 주관적 불만족을 이유로 한 임의 환불은 제공하지 않습니다.
        </p>
        <p>
          다만 거래의 성격상 관계 법령에 따른 중도 해지 또는 환급 의무가 적용되는
          경우에는 실제 제공·사용된 부분과 법령상 허용되는 공제액을 반영하여 법정 기준으로
          처리합니다.
        </p>
      </LegalSection>

      <LegalSection title="제5조 정상 완료 결과와 사용 처리">
        <p>
          기술적으로 정상 완료되어 결과물이 제공된 작업은 유료서비스가 제공된 것으로
          봅니다. 편집 취향, 장면·제목·자막 선택, 인물 유사도, 프롬프트 해석, 기대 조회수·
          수익, 이용자 설정, 원본 품질 또는 지원하지 않는 입력 등은 회사의 객관적 하자가
          아닌 한 사용량 복구나 환불 사유가 되지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="제6조 실패 작업과 객관적 하자">
        <p>
          회사 시스템에서 작업이 실패 상태로 종료되면 해당 예약 사용량을 반환합니다.
          결제 후 서비스를 이용할 수 없거나 계약 또는 표시·광고와 명백히 다른 객관적
          하자가 확인된 경우 회사는 재처리, 대체 제공, 사용량 복구 또는 관계 법령상 필요한
          환불 조치를 할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제7조 유효기간과 환불 대상">
        <p>
          X3·X6 및 별도 추가 처리시간은 결제 화면에 표시된 유효기간이 지나면 소멸하며,
          미사용 또는 만료만을 이유로 자동 환불되지 않습니다. 무료·보너스 사용량과 별도
          대가가 없는 혜택은 현금 환불 대상이 아니며, 원 주문이 취소되면 함께 회수할 수
          있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제8조 환불 신청 및 처리">
        <p>
          환불은{" "}
          <a href="mailto:artiroom176@gmail.com" className={accentLink}>
            artiroom176@gmail.com
          </a>
          으로 계정 이메일, 주문번호, 결제일·금액, 상품명과 신청 사유를 보내야 합니다.
          구독 해지, 계정 삭제 또는 일반 문의만으로는 환불 신청이 완료되지 않습니다.
        </p>
        <p>
          회사는 본인, 결제, 제공 및 사용 내역을 확인하기 위한 자료를 요청할 수 있습니다.
          환불이 승인되면 관계 법령이 정한 기한과 방식에 따라 원 결제수단으로 처리하며,
          해당 유료 권한·사용량·다운로드 및 부가 혜택을 회수합니다.
        </p>
      </LegalSection>

      <LegalSection title="제9조 과오금·결제 도용 및 부정 이용">
        <p>
          회사 책임으로 확인된 중복 결제나 과오금은 원 결제수단으로 환급합니다. 승인하지
          않은 결제에 대해서는 계정, 주문, 승인 및 사용 기록을 확인하고 필요한 자료를
          요청할 수 있습니다.
        </p>
        <p>
          허위 자료 제출, 사용 사실 은폐, 환불 제도 악용 또는 카드사 이의제기와 회사
          환불의 중복 진행은 금지됩니다. 이중 환급이나 부당 이득이 확인되면 회수할 수
          있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제10조 기록 및 정책 버전">
        <p>
          회사는 결제, 고지·동의, 정책 버전, 서비스 제공, 사용량, 작업 결과, 환불 심사와
          권한 회수 기록을 관계 법령과 개인정보처리방침이 정한 기간 동안 보관할 수
          있습니다.
        </p>
        <p>
          결제 당시 환불정책 v1 또는 v2가 적용된 주문에는 해당 정책을 적용합니다.{" "}
          <Link href="/refund/versions/1" className={accentLink}>환불정책 v1</Link>
          {" "}·{" "}
          <Link href="/refund/versions/2" className={accentLink}>환불정책 v2</Link>
        </p>
        <p>
          본 정책에서 정하지 않은 사항은 서비스 이용약관, 유료서비스 구매약관, 결제
          화면의 개별 조건 및 대한민국 관계 법령에 따릅니다.
        </p>
      </LegalSection>

      <LegalSection title="제11조 사업자 및 문의">
        <div className="overflow-x-auto">
          <table>
            <tbody>
              <tr><th>상호</th><td>아티룸</td></tr>
              <tr><th>대표</th><td>김동민</td></tr>
              <tr><th>사업자등록번호</th><td>638-04-03590</td></tr>
              <tr><th>통신판매업 신고번호</th><td>2025-서울마포-2971</td></tr>
              <tr><th>주소</th><td>서울특별시 마포구 성산로8길 40</td></tr>
              <tr>
                <th>문의</th>
                <td>
                  <a href="mailto:artiroom176@gmail.com" className={accentLink}>
                    artiroom176@gmail.com
                  </a>
                  {" "}·{" "}
                  <a href="tel:010-4836-2874" className={accentLink}>
                    010-4836-2874
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </LegalSection>
    </LegalDocument>
  );
}
