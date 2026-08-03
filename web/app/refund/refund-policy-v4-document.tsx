import type { LegalTranslation } from "@/components/legal-document";
import { LegalDocument, LegalSection } from "@/components/legal-document";

const accentLink = "font-bold text-[#ff8c7c] underline underline-offset-4";

export const refundPolicyV4Translations: { en: LegalTranslation; ja: LegalTranslation } = {
  en: {
    eyebrow: "Cancellation & Refund Policy",
    title: "Cancellation & Refund Policy",
    description: "This policy explains cancellation and refund review for Easy Cut paid passes and digital services.",
    sections: [
      { title: "1. General policy", paragraphs: ["Easy Cut is a digital service that immediately incurs high-cost AI and cloud-computing work for video analysis, speech recognition, content generation, and rendering. Once processing or supply begins, cancellation and refunds are generally unavailable."] },
      { title: "2. When use begins", paragraphs: ["Use begins when a video job, render, AI analysis, speech recognition, subtitle generation, or comment generation is requested; paid computation begins; time or credits are reserved or deducted; or a result becomes available for preview, editing, export, or download."] },
      { title: "3. Non-refundable cases", paragraphs: ["Refunds are unavailable after any paid feature or allowance is used, computation begins, or a result is supplied. They are also unavailable for cancellation after processing begins, subjective dissatisfaction with AI output, incorrect inputs or settings, access or rights restrictions, device or network issues, user deletion, Terms violations, promotional benefits, later discounts, or a simple change of mind.", "Stopping a job, leaving the page, or choosing not to download a supplied result does not reverse AI or cloud costs already incurred."] },
      { title: "4. AI output", paragraphs: ["AI output varies with input and model behavior. If the service processes normally and supplies a result, dissatisfaction with wording, accuracy, style, mood, editing preferences, or input quality does not by itself qualify for a refund."] },
      { title: "5. Technical issues", paragraphs: ["For technical issues, we first reprocess the job, restore deducted time or credits, or provide an equivalent service. We review a monetary refund only for duplicate payment, failure to grant a paid entitlement, or a company-system failure that cannot be remedied by reprocessing or restoring usage."] },
      { title: "6. Subscription cancellation and promotions", paragraphs: ["Cancelling a recurring plan stops future renewal but does not automatically refund the current paid period after use or digital supply begins. Free trials, bonuses, coupons, promotions, and event allowances have no cash value and are not refundable or transferable."] },
      { title: "7. How to request review", paragraphs: ["If you believe you qualify under this policy, email artiroom176@gmail.com within seven days of payment. Include your account email, payment date and amount, transaction or order number, a detailed reason, and supporting material.", "Submitting a request does not guarantee approval. We review payment and service records, including computation start, usage deductions, result supply, editing, export, and download activity. Missing information may delay or pause review."] },
      { title: "8. Records and business information", paragraphs: ["We may retain payment, usage reservation and deduction, job processing, result supply, editing, export, download, and refund-review records for service operation and dispute handling.", "Business: Artiroom · Representative: Kim Dong-min · Business registration no. 638-04-03590 · Mail-order business report no. 2025-Seoul Mapo-2971 · Address: 40, Seongsan-ro 8-gil, Mapo-gu, Seoul · Contact: artiroom176@gmail.com / +82-10-4836-2874"] },
    ],
  },
  ja: {
    eyebrow: "Cancellation & Refund Policy",
    title: "キャンセル・返金ポリシー",
    description: "Easy Cutの利用券および有料デジタルサービスに関するキャンセル・返金審査基準を説明します。",
    sections: [
      { title: "1. 基本方針", paragraphs: ["Easy Cutは、動画分析、音声認識、AIコンテンツ生成、動画レンダリングに高コストのAI・クラウド演算を直ちに使用するデジタルサービスです。処理または提供開始後は、原則としてキャンセル・返金できません。"] },
      { title: "2. 利用開始基準", paragraphs: ["動画生成、レンダリング、AI分析、音声認識、字幕・コメント生成を依頼した時、演算が開始した時、時間・クレジットが予約または差し引かれた時、結果がプレビュー・編集・書き出し・ダウンロード可能になった時に利用開始とみなします。"] },
      { title: "3. 返金できない場合", paragraphs: ["有料機能・利用枠を一度でも使用した場合、演算または結果提供が開始した場合は返金できません。処理開始後の中止、AI結果への主観的不満、誤入力・設定、権利・アクセス制限、端末・通信環境、利用者による削除、規約違反、無償特典、後日の割引、単純な心変わりも対象外です。", "処理後にページを離れたり、提供済みの結果をダウンロードしなかったりしても、すでに発生したAI・クラウド費用は取り消されません。"] },
      { title: "4. AIの結果", paragraphs: ["AI結果は入力とモデルの処理によって異なります。正常に処理・提供された場合、表現、正確性、スタイル、雰囲気、編集上の好み、入力品質への不満だけでは返金対象になりません。"] },
      { title: "5. 技術的な問題", paragraphs: ["技術的問題には、再処理、差し引かれた時間・クレジットの復元、または同等サービスの再提供を優先します。重複決済、利用権未付与、再処理・利用量復元でも解決できない当社システム障害に限り金銭返金を審査します。"] },
      { title: "6. 定期決済の解約と特典", paragraphs: ["定期決済の解約は次回更新を停止するもので、利用またはデジタル提供開始後の当月料金を自動返金するものではありません。無料体験、ボーナス、クーポン、プロモーション、イベント利用枠には現金価値がなく、返金・譲渡できません。"] },
      { title: "7. 返金審査の申請方法", paragraphs: ["本ポリシー上の対象に該当すると考える場合は、決済日から7日以内にartiroom176@gmail.comへご連絡ください。アカウントメール、決済日・金額、取引・注文番号、具体的理由、確認資料を記載してください。", "申請だけで返金が承認されるものではありません。演算開始、利用量差引き、結果提供、編集、書き出し、ダウンロード等の記録を確認します。不足情報がある場合は審査を保留できます。"] },
      { title: "8. 記録と事業者情報", paragraphs: ["サービス運営と紛争対応のため、決済、利用量予約・差引き、処理、結果提供、編集、書き出し、ダウンロード、返金審査の記録を保管する場合があります。", "商号：アティルーム · 代表：キム・ドンミン · 事業者登録番号：638-04-03590 · 通信販売業届出番号：2025-ソウル麻浦-2971 · 住所：ソウル特別市麻浦区城山路8ギル40 · 連絡先：artiroom176@gmail.com / +82-10-4836-2874"] },
    ],
  },
};

export function RefundPolicyV4Document() {
  return (
    <LegalDocument
      eyebrow="Cancellation & Refund Policy"
      title="취소 및 환불 정책"
      description="Easy Cut 이용권과 유료 디지털 서비스의 취소 및 환불 검토 기준입니다."
      effectiveDate="2026년 8월 3일"
      translations={refundPolicyV4Translations}
    >
      <LegalSection title="제1조 기본 환불 정책">
        <p>본 정책은 아티룸(이하 “회사”)이 운영하는 Easy Cut에서 이루어진 이용권 및 디지털 서비스 구매에 적용됩니다.</p>
        <p className="font-semibold text-neutral-100">Easy Cut은 영상 분석, 음성 인식, AI 콘텐츠 생성 및 영상 렌더링 과정에서 고가의 AI·클라우드 연산이 즉시 수행되는 디지털 서비스입니다.</p>
        <p>작업 처리가 시작되는 순간부터 실제 비용이 발생하고 디지털콘텐츠가 즉시 제공되므로, 서비스를 이용하거나 작업이 시작된 이후에는 일반적으로 취소 및 환불이 불가능합니다. 이용권을 구매하기 전에 상품 구성, 제공되는 이용 시간 및 서비스 내용을 충분히 확인해 주세요.</p>
      </LegalSection>

      <LegalSection title="제2조 서비스 이용 개시 기준">
        <p>다음 중 하나라도 발생한 경우 서비스를 사용한 것으로 봅니다.</p>
        <ol className="grid gap-2">
          <li>1. 영상 생성 또는 편집 영상 렌더링을 요청한 경우</li>
          <li>2. AI 분석, 음성 인식, 자막 생성 또는 댓글 생성을 요청한 경우</li>
          <li>3. AI 또는 클라우드 연산이 시작된 경우</li>
          <li>4. 이용 시간, 이용권 또는 크레딧이 일부라도 예약되거나 차감된 경우</li>
          <li>5. 생성 결과가 미리보기 또는 편집 가능한 상태로 제공된 경우</li>
          <li>6. 생성 결과가 다운로드 가능한 상태로 제공된 경우</li>
          <li>7. 생성된 영상이나 콘텐츠를 다운로드하거나 외부로 내보낸 경우</li>
        </ol>
      </LegalSection>

      <LegalSection title="제3조 환불이 불가능한 경우">
        <p>다음에 해당하는 경우 취소 및 환불이 불가능합니다.</p>
        <ol className="grid gap-2">
          <li>1. 구매한 이용권이나 유료 기능을 한 번이라도 사용한 경우</li>
          <li>2. 이용 시간 또는 크레딧이 일부라도 예약되거나 차감된 경우</li>
          <li>3. AI 분석, 자막·댓글 생성 또는 영상 렌더링이 시작된 경우</li>
          <li>4. 생성된 결과물을 확인, 편집, 저장 또는 다운로드한 경우</li>
          <li>5. 생성된 영상이나 콘텐츠가 다운로드 가능한 상태로 제공된 경우</li>
          <li>6. 작업이 시작된 후 사용자가 작업을 취소하거나 페이지를 이탈한 경우</li>
          <li>7. AI 결과물의 표현, 정확성, 스타일 또는 주관적인 품질이 기대와 다른 경우</li>
          <li>8. 사용자가 잘못된 URL, 영상, 이미지, 텍스트 또는 편집 설정을 입력한 경우</li>
          <li>9. 비공개 영상, DRM, 저작권, 지역·연령 제한 또는 접근 권한 문제로 작업이 제한된 경우</li>
          <li>10. 사용자의 기기, 브라우저, 네트워크 환경 또는 조작 실수로 서비스를 정상적으로 이용하지 못한 경우</li>
          <li>11. 사용자가 생성된 결과물이나 프로젝트를 직접 삭제한 경우</li>
          <li>12. 서비스 이용약관 위반 또는 부정 이용으로 계정이 제한된 경우</li>
          <li>13. 무료 또는 프로모션으로 지급된 이용 시간과 크레딧</li>
          <li>14. 결제 이후 진행된 가격 인하, 할인 또는 프로모션과의 차액</li>
          <li>15. 이용권을 구매한 이후 단순히 마음이 바뀐 경우</li>
        </ol>
        <p>작업이 시작되면 사용자가 중간에 취소하거나 생성된 결과물을 실제로 다운로드하지 않았더라도 이미 AI·클라우드 연산 비용이 발생했으므로 환불되지 않습니다.</p>
      </LegalSection>

      <LegalSection title="제4조 AI 결과물에 대한 환불 제한">
        <p>AI를 이용한 영상 분석, 자막, 댓글, 제목 및 기타 콘텐츠 생성 결과는 입력 자료와 AI 모델의 처리 결과에 따라 달라질 수 있습니다.</p>
        <p>서비스가 정상적으로 처리되고 결과물이 제공된 경우 결과물의 표현·정확성·스타일·분위기, 직접 수정 필요성, 편집 설정 또는 템플릿 선호, 원본 자료의 품질, 같은 입력에 대한 결과 차이를 사유로 환불할 수 없습니다.</p>
      </LegalSection>

      <LegalSection title="제5조 기술적인 문제">
        <p>기술적인 문제가 발생하면 현금 환불보다 실패한 작업의 재처리, 차감된 이용 시간 또는 크레딧 복구, 동일하거나 이에 상응하는 서비스 재제공을 우선하여 지원합니다.</p>
        <p>중복 결제, 결제 후 이용권 미지급 또는 회사 시스템 문제로 서비스를 제공하지 못했으며 재처리와 이용권 복구도 불가능한 경우에만 환불을 검토합니다.</p>
        <p>단순한 처리 지연이나 일시적인 장애가 발생했지만 이후 정상적으로 결과물이 제공된 경우에는 환불되지 않습니다.</p>
      </LegalSection>

      <LegalSection title="제6조 구독 취소 및 무료·프로모션 혜택">
        <p>정기결제를 취소하면 다음 결제부터 추가 요금이 청구되지 않습니다. 이미 결제된 이용 기간에 서비스를 사용했거나 디지털콘텐츠 제공이 시작된 경우 현재 결제 건은 환불되지 않습니다. 정기결제 취소와 이미 결제된 금액에 대한 환불 요청은 서로 다른 절차입니다.</p>
        <p>무료 체험, 보너스, 쿠폰, 프로모션 또는 이벤트를 통해 지급된 이용 시간과 크레딧은 현금 가치가 없으며 환불하거나 다른 계정으로 이전할 수 없습니다. 이후 가격 인하나 혜택 변경을 이유로 기존 결제금액의 차액을 환불하지 않습니다.</p>
      </LegalSection>

      <LegalSection title="제7조 환불 요청 방법">
        <p>본 정책에 따라 환불 대상에 해당한다고 판단되는 경우, <strong className="text-white">결제일로부터 7일 이내</strong>에 아래 이메일로 환불 검토를 요청해 주세요.</p>
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-5 sm:p-6">
          <p><strong className="inline-block w-24 text-white">이메일</strong><a href="mailto:artiroom176@gmail.com" className={accentLink}>artiroom176@gmail.com</a></p>
          <p><strong className="inline-block w-24 text-white">필수 정보</strong>가입 이메일, 결제 일시·금액, 거래·주문번호, 구체적인 환불 사유, 확인 자료</p>
        </div>
        <p>환불 요청을 접수하는 것만으로 환불이 승인되는 것은 아닙니다. 회사는 AI 연산 시작, 이용 시간 예약·차감, 결과물 생성·제공·편집·다운로드 등 결제 및 서비스 이용 기록을 확인하여 환불 가능 여부를 검토합니다.</p>
        <p>필수 정보가 누락되었거나 결제 및 서비스 이용 내역을 확인할 수 없는 경우 추가 자료를 요청하거나 환불 검토를 보류할 수 있습니다. 검토 결과는 요청에 사용한 이메일로 안내합니다.</p>
      </LegalSection>

      <LegalSection title="제8조 기록 및 사업자 정보">
        <p>회사는 결제, 이용량 예약·차감, 작업 처리, 결과물 제공, 편집, 다운로드 및 환불 검토 기록을 서비스 운영과 분쟁 대응에 필요한 기간 동안 보관할 수 있습니다.</p>
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

      <LegalSection title="결제 전 필수 동의">
        <p><strong className="text-white">유료 AI 연산 및 환불 제한 동의</strong></p>
        <p>영상 생성, AI 분석, 자막·댓글 생성 또는 렌더링을 요청하면 고가의 AI·클라우드 연산이 즉시 시작될 수 있습니다. 유료 기능을 한 번이라도 실행하거나 결과물이 제공된 이후에는 단순 변심에 따른 취소 및 환불이 불가능함을 확인하고 동의합니다.</p>
      </LegalSection>

      <LegalSection title="작업 시작 전 안내">
        <p>작업을 시작하면 이용 시간이 차감되며 고가의 AI·클라우드 연산이 시작됩니다. 작업 시작 이후에는 작업을 취소하거나 결과물을 사용하지 않더라도 환불되지 않습니다.</p>
      </LegalSection>
    </LegalDocument>
  );
}
