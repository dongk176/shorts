import Link from "next/link";
import type {
  SupportInquiryCategory,
  SupportInquiryRefundReason,
} from "@/lib/support-inquiry";

export type AdminInquiryStatus =
  | "new"
  | "in_progress"
  | "waiting_on_customer"
  | "resolved"
  | "closed";

export type AdminCustomerInquiry = {
  id: string;
  category: SupportInquiryCategory;
  status: AdminInquiryStatus;
  contactEmail: string;
  message: string;
  locale: "ko" | "en" | "ja";
  pagePath: string | null;
  inquiryKind: "general" | "refund_request";
  refundReasonCode: SupportInquiryRefundReason | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  memberEmail: string | null;
  memberDisplayName: string | null;
  billingOrderId: string | null;
  orderId: string | null;
  productCode: string | null;
  orderAmountKrw: number | null;
  orderRefundedAmountKrw: number | null;
  orderStatus: string | null;
};

export type AdminInquiryMetrics = {
  totalCount: number;
  newCount: number;
  inProgressCount: number;
  waitingCount: number;
  refundRequestCount: number;
};

const categoryLabels: Record<SupportInquiryCategory, string> = {
  service_usage: "서비스 이용",
  billing_refund: "결제·환불",
  technical_issue: "오류 신고",
  other: "기타",
};

const statusLabels: Record<AdminInquiryStatus, string> = {
  new: "신규",
  in_progress: "처리 중",
  waiting_on_customer: "고객 답변 대기",
  resolved: "해결",
  closed: "종료",
};

const statusClasses: Record<AdminInquiryStatus, string> = {
  new: "border-rose-300/20 bg-rose-300/10 text-rose-200",
  in_progress: "border-sky-300/20 bg-sky-300/10 text-sky-200",
  waiting_on_customer: "border-amber-300/20 bg-amber-300/10 text-amber-200",
  resolved: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
  closed: "border-white/10 bg-white/[.04] text-neutral-400",
};

const refundReasonLabels: Record<SupportInquiryRefundReason, string> = {
  unused_or_changed_mind: "사용 전·단순 변심",
  duplicate_payment: "중복 결제",
  service_issue: "서비스 이용 문제",
  billing_error: "결제 금액·청구 오류",
  other: "기타",
};

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function money(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function referenceCode(id: string) {
  return `EC-${id.slice(0, 8).toUpperCase()}`;
}

export function AdminInquiriesDashboard({
  inquiries,
  metrics,
  initialFilters,
}: {
  inquiries: AdminCustomerInquiry[];
  metrics: AdminInquiryMetrics;
  initialFilters: {
    query: string;
    status: string;
    category: string;
    kind: string;
  };
}) {
  return (
    <div className="mt-7 grid gap-7">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="문의 요약">
        {[
          ["전체 문의", metrics.totalCount],
          ["신규", metrics.newCount],
          ["처리 중", metrics.inProgressCount],
          ["고객 답변 대기", metrics.waitingCount],
          ["환불 요청", metrics.refundRequestCount],
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
            <p className="text-xs font-bold text-neutral-500">{label}</p>
            <p className="mt-3 text-2xl font-black tracking-tight text-white">
              {Number(value).toLocaleString("ko-KR")}건
            </p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">고객 문의</h2>
              <p className="mt-1 text-xs text-neutral-500">
                조건에 맞는 전체 {inquiries.length.toLocaleString("ko-KR")}건
              </p>
            </div>
            <form className="flex flex-wrap gap-2" method="get">
              <input type="hidden" name="tab" value="inquiries" />
              <input
                name="q"
                defaultValue={initialFilters.query}
                placeholder="이메일·이름·문의·주문번호"
                className="h-10 w-64 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
              />
              <select
                name="inquiryStatus"
                defaultValue={initialFilters.status}
                aria-label="문의 상태"
                className="h-10 rounded-xl border border-white/10 bg-[#191c1d] px-3 text-sm"
              >
                <option value="all">모든 상태</option>
                <option value="new">신규</option>
                <option value="in_progress">처리 중</option>
                <option value="waiting_on_customer">고객 답변 대기</option>
                <option value="resolved">해결</option>
                <option value="closed">종료</option>
              </select>
              <select
                name="inquiryCategory"
                defaultValue={initialFilters.category}
                aria-label="문의 유형"
                className="h-10 rounded-xl border border-white/10 bg-[#191c1d] px-3 text-sm"
              >
                <option value="all">모든 유형</option>
                <option value="service_usage">서비스 이용</option>
                <option value="billing_refund">결제·환불</option>
                <option value="technical_issue">오류 신고</option>
                <option value="other">기타</option>
              </select>
              <select
                name="inquiryKind"
                defaultValue={initialFilters.kind}
                aria-label="접수 종류"
                className="h-10 rounded-xl border border-white/10 bg-[#191c1d] px-3 text-sm"
              >
                <option value="all">일반·환불 전체</option>
                <option value="general">일반 문의</option>
                <option value="refund_request">환불 요청</option>
              </select>
              <button className="h-10 rounded-xl bg-white px-4 text-sm font-black text-black transition hover:bg-neutral-200">
                조회
              </button>
            </form>
          </div>
        </div>

        <div className="divide-y divide-white/[.06]">
          {inquiries.map((inquiry) => (
            <article key={inquiry.id} className="p-5 transition hover:bg-white/[.02]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClasses[inquiry.status]}`}>
                      {statusLabels[inquiry.status]}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-xs font-bold text-neutral-300">
                      {categoryLabels[inquiry.category]}
                    </span>
                    {inquiry.inquiryKind === "refund_request" && (
                      <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 text-xs font-black text-violet-200">
                        환불 요청
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-neutral-500">
                    {date(inquiry.createdAt)} · 접수번호 {referenceCode(inquiry.id)}
                  </p>
                </div>
                <p className="text-xs text-neutral-600">
                  최근 갱신 {date(inquiry.updatedAt)}
                </p>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 rounded-2xl border border-white/[.07] bg-black/20 p-4">
                  <p className="text-xs font-bold text-neutral-500">문의 내용</p>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-neutral-100">
                    {inquiry.message}
                  </p>
                </div>

                <dl className="grid content-start gap-3 text-sm">
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">답변 이메일</dt>
                    <dd className="mt-1 break-all font-bold text-white">{inquiry.contactEmail}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">회원</dt>
                    <dd className="mt-1 text-neutral-300">
                      {inquiry.memberEmail ? (
                        <>
                          <Link
                            href={`/admin/easycutcutcutcutcutcut?tab=members&q=${encodeURIComponent(inquiry.memberEmail)}`}
                            className="font-bold text-[#ffac9f] underline decoration-white/20 underline-offset-4 hover:text-white"
                          >
                            {inquiry.memberDisplayName || inquiry.memberEmail}
                          </Link>
                          {inquiry.memberDisplayName && (
                            <p className="mt-1 break-all text-xs text-neutral-500">{inquiry.memberEmail}</p>
                          )}
                        </>
                      ) : (
                        <span className="text-neutral-500">비회원 또는 탈퇴 회원</span>
                      )}
                    </dd>
                  </div>
                  {inquiry.refundReasonCode && (
                    <div>
                      <dt className="text-xs font-bold text-neutral-500">환불 요청 사유</dt>
                      <dd className="mt-1 font-semibold text-neutral-200">
                        {refundReasonLabels[inquiry.refundReasonCode]}
                      </dd>
                    </div>
                  )}
                  {inquiry.orderId && (
                    <div>
                      <dt className="text-xs font-bold text-neutral-500">연결된 결제</dt>
                      <dd className="mt-1 text-neutral-300">
                        <Link
                          href={`/admin/easycutcutcutcutcutcut?tab=billing&q=${encodeURIComponent(inquiry.orderId)}`}
                          className="break-all font-bold text-[#ffac9f] underline decoration-white/20 underline-offset-4 hover:text-white"
                        >
                          {inquiry.orderId}
                        </Link>
                        {inquiry.orderAmountKrw !== null && (
                          <p className="mt-1 text-xs text-neutral-500">
                            {inquiry.productCode || "상품 정보 없음"} · 결제 {money(inquiry.orderAmountKrw)}
                            {inquiry.orderRefundedAmountKrw
                              ? ` · 환불 ${money(inquiry.orderRefundedAmountKrw)}`
                              : ""}
                            {inquiry.orderStatus ? ` · ${inquiry.orderStatus}` : ""}
                          </p>
                        )}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">접수 환경</dt>
                    <dd className="mt-1 break-all text-neutral-400">
                      {inquiry.locale.toUpperCase()}
                      {inquiry.pagePath ? ` · ${inquiry.pagePath}` : ""}
                    </dd>
                  </div>
                  {inquiry.resolvedAt && (
                    <div>
                      <dt className="text-xs font-bold text-neutral-500">처리 완료 시각</dt>
                      <dd className="mt-1 text-neutral-400">{date(inquiry.resolvedAt)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </article>
          ))}
          {!inquiries.length && (
            <p className="px-5 py-16 text-center text-sm text-neutral-500">
              조건에 맞는 문의가 없습니다.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
