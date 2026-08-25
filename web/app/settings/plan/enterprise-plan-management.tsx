import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { AuthProfile } from "@/lib/session";
import {
  enterprisePaymentStatusLabel,
  enterpriseProductStage,
  enterpriseProductStageLabel,
  type EnterpriseManagedProduct,
  type EnterpriseProductStage,
} from "./enterprise-plan-management-model";

function calendarDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function money(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function stageStyle(stage: EnterpriseProductStage) {
  if (stage === "active") return "border-emerald-300/20 bg-emerald-300/[.07] text-emerald-100";
  if (stage === "upcoming") return "border-sky-300/20 bg-sky-300/[.07] text-sky-100";
  if (stage === "ended") return "border-white/[.08] bg-white/[.04] text-neutral-400";
  if (stage === "payment_review") return "border-amber-300/20 bg-amber-300/[.07] text-amber-100";
  if (stage === "payment_expired") return "border-red-300/20 bg-red-300/[.06] text-red-100";
  if (stage === "access_pending") return "border-amber-300/20 bg-amber-300/[.07] text-amber-100";
  return "border-[#ff9585]/25 bg-[#ff715e]/[.08] text-[#ffc2ba]";
}

function stageDescription(product: EnterpriseManagedProduct, stage: EnterpriseProductStage) {
  if (stage === "active") return "현재 이용할 수 있는 기업 상품입니다.";
  if (stage === "upcoming") return `${calendarDate(product.serviceStartDate)}부터 이용할 수 있습니다.`;
  if (stage === "ended") return `${calendarDate(product.serviceEndDate)}에 이용이 종료되었습니다.`;
  if (stage === "payment_review") return "결제 결과를 확인하고 있습니다. 확인이 끝날 때까지 다시 결제하지 마세요.";
  if (stage === "payment_expired") return "결제 기한이 지나 새 결제 요청이 필요합니다.";
  if (stage === "access_pending") return "결제는 완료되었으며 이용 권한 적용 상태를 확인하고 있습니다.";
  if (product.paymentStatus === "paid") return "이 상품의 결제는 완료되었습니다. 같은 요청의 남은 상품까지 모두 결제하면 이용 권한이 적용됩니다.";
  return "결제 요청의 상품을 순서대로 모두 결제하면 이용 권한이 적용됩니다.";
}

function EnterpriseProductCard({ product, today }: {
  product: EnterpriseManagedProduct;
  today: string;
}) {
  const stage = enterpriseProductStage(product, today);
  const canOpenPayment = product.paymentRequestStatus !== "paid"
    && !product.paymentRequestExpired;
  return (
    <article className="rounded-[24px] border border-white/[.09] bg-[#191c1e] p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${stageStyle(stage)}`}>
          {enterpriseProductStageLabel(stage)}
        </span>
        <span className="rounded-full border border-white/[.08] px-3 py-1 text-[11px] font-bold text-neutral-500">
          {enterprisePaymentStatusLabel(product.paymentStatus)}
        </span>
        <span className="rounded-full border border-white/[.08] px-3 py-1 text-[11px] font-bold text-neutral-500">
          결제 순서 {product.sortOrder}번
        </span>
      </div>

      <h2 className="mt-5 text-2xl font-black tracking-tight text-white sm:text-3xl">{product.name}</h2>
      <p className="mt-2 text-sm font-bold text-neutral-500">{product.paymentRequestTitle}</p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
          <dt className="text-xs font-bold text-neutral-500">서비스 이용기간</dt>
          <dd className="mt-2 text-sm font-black text-neutral-200">
            {calendarDate(product.serviceStartDate)} ~ {calendarDate(product.serviceEndDate)}
          </dd>
        </div>
        <div className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
          <dt className="text-xs font-bold text-neutral-500">제공 처리시간</dt>
          <dd className="mt-2 text-sm font-black text-neutral-200">{product.includedMinutes.toLocaleString("ko-KR")}분</dd>
        </div>
        <div className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
          <dt className="text-xs font-bold text-neutral-500">결제금액</dt>
          <dd className="mt-2 text-sm font-black text-neutral-200">
            {money(product.amountKrw)} <span className="text-xs text-neutral-500">({product.vatTreatment === "not_applicable" ? "부가세 해당 없음" : "부가세 포함"})</span>
          </dd>
        </div>
        <div className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
          <dt className="text-xs font-bold text-neutral-500">결제 기한</dt>
          <dd className="mt-2 text-sm font-black text-neutral-200">{calendarDate(product.paymentDueDate)}</dd>
        </div>
      </dl>

      <div className="mt-6 border-t border-white/[.07] pt-5">
        <p className="text-sm leading-7 text-neutral-400">{stageDescription(product, stage)}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {canOpenPayment ? (
            <Link href={`/enterprise-pay/${product.paymentRequestToken}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white transition hover:bg-[#ff806f]">
              결제 요청 확인
            </Link>
          ) : null}
          <Link href="/account/activity" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/[.1] px-5 text-sm font-black text-neutral-300 transition hover:bg-white/[.05]">
            결제·사용 내역
          </Link>
        </div>
      </div>
    </article>
  );
}

export function EnterprisePlanManagement({ user, products, today }: {
  user: AuthProfile;
  products: EnterpriseManagedProduct[];
  today: string;
}) {
  return (
    <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen text-neutral-100">
      <SiteHeader desktopSidebar><AuthControls user={user} next="/settings/plan" /></SiteHeader>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <Link href="/settings" className="text-sm font-bold text-neutral-500 transition hover:text-white">← 설정</Link>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-white">요금제 관리</h1>
        <p className="mt-3 text-sm leading-7 text-neutral-400">기업 계정에 등록된 상품과 결제 상태, 실제 이용기간을 확인할 수 있습니다.</p>

        {products.length > 0 ? (
          <section className="mt-9" aria-labelledby="enterprise-products-title">
            <h2 id="enterprise-products-title" className="mb-3 text-xs font-black tracking-[.16em] text-neutral-500">
              기업 이용 상품
            </h2>
            <div className="grid gap-4">
              {products.map((product) => <EnterpriseProductCard key={product.id} product={product} today={today} />)}
            </div>
          </section>
        ) : (
          <section className="mt-9 rounded-[24px] border border-white/[.09] bg-[#191c1e] p-7 sm:p-8">
            <span className="text-xs font-black tracking-[.14em] text-neutral-500">기업 이용 상품</span>
            <h2 className="mt-4 text-2xl font-black text-white">등록된 기업 이용 상품이 없습니다</h2>
            <p className="mt-3 text-sm leading-7 text-neutral-400">기업 담당자에게 상품 등록 여부를 확인해 주세요.</p>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
