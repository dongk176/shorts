import Link from "next/link";
import type { MvpState } from "@/lib/contracts";

function date(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function EnterpriseServiceGate({
  access,
}: {
  access: MvpState["enterpriseAccess"];
}) {
  const title = access.reason === "payment_required"
    ? "결제를 완료해 주세요"
    : access.reason === "not_started"
      ? "서비스 시작일 전입니다"
      : "현재 이용기간이 아닙니다";
  const detail = access.reason === "payment_required"
    ? "약관을 확인하고 안내된 순서대로 모든 결제 상품을 완료하면 계약된 기간에 서비스를 이용할 수 있습니다."
    : access.reason === "not_started"
      ? `${date(access.firstStartsAt) || "계약된 시작일"}부터 서비스를 이용할 수 있습니다.`
      : "현재 활성화된 기업 서비스 상품이 없습니다. 이용기간과 결제 상태를 확인해 주세요.";
  return (
    <main className="grid min-h-screen place-items-center bg-[#0f1213] px-5 py-12 text-neutral-100">
      <section className="w-full max-w-xl rounded-[28px] border border-white/10 bg-[#191d1e] p-7 sm:p-10">
        <p className="text-xl font-black tracking-tight">EasyCut</p>
        <span className="mt-8 inline-flex rounded-full bg-sky-300/10 px-3 py-1 text-xs font-black text-sky-200">
          기업 서비스
        </span>
        <h1 className="mt-5 text-3xl font-black tracking-tight">{title}</h1>
        <p className="mt-4 text-sm leading-7 text-neutral-300">{detail}</p>
        {access.paymentPath ? (
          <Link
            href={access.paymentPath}
            className="mt-8 flex min-h-14 items-center justify-center rounded-2xl bg-[#ff715e] px-5 text-base font-black text-white"
          >
            결제 요청 확인
          </Link>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Link href="/support" className="flex min-h-12 items-center justify-center rounded-xl border border-white/10 text-sm font-black text-neutral-200">
            고객지원
          </Link>
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="min-h-12 w-full rounded-xl border border-white/10 text-sm font-black text-neutral-200">
              로그아웃
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
