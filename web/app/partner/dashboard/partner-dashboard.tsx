"use client";

import Link from "next/link";
import { useState } from "react";

export type PartnerDashboardMetrics = {
  clicks: number;
  uniqueVisitors: number;
  signups: number;
  paidCustomers: number;
  signupConversionRate: number;
  paidConversionRate: number;
  grossSalesKrw: number;
  refundsKrw: number;
  netSalesKrw: number;
  periodCommissionKrw: number;
  pendingKrw: number;
  availableKrw: number;
  paidKrw: number;
};

export type PartnerTransaction = {
  id: string;
  memberEmail: string;
  productCode: string;
  approvedAt: string;
  grossAmountKrw: number;
  refundedAmountKrw: number;
  commissionAmountKrw: number;
  commissionRateBps: number;
  availableAt: string;
  isAvailable: boolean;
};

export type PartnerCampaign = {
  campaign: string;
  clicks: number;
  uniqueVisitors: number;
};

export type PartnerPayout = {
  id: string;
  periodStart: string;
  periodEnd: string;
  amountKrw: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
  transferReference: string | null;
};

type PayoutProfile = {
  bankName: string | null;
  accountHolder: string | null;
  accountNumberLast4: string | null;
  updatedAt: string | null;
};

function money(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value)) : "-";
}

function payoutStatus(value: string) {
  return value === "paid" ? "지급 완료" : value === "canceled" ? "취소" : "지급 대기";
}

export function PartnerDashboard({
  creatorName,
  slug,
  status,
  commissionRateBps,
  from,
  to,
  metrics,
  transactions,
  campaigns,
  payouts,
  payoutProfile,
}: {
  creatorName: string;
  slug: string;
  status: "active" | "paused";
  commissionRateBps: number;
  from: string;
  to: string;
  metrics: PartnerDashboardMetrics;
  transactions: PartnerTransaction[];
  campaigns: PartnerCampaign[];
  payouts: PartnerPayout[];
  payoutProfile: PayoutProfile;
}) {
  const referralUrl = `https://www.easycut.co.kr/${slug}`;
  const [message, setMessage] = useState<string | null>(null);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [account, setAccount] = useState({
    bankName: payoutProfile.bankName || "",
    accountHolder: payoutProfile.accountHolder || "",
    accountNumber: "",
    currentPassword: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const copyLink = async () => {
    await navigator.clipboard.writeText(referralUrl);
    setMessage("추천 링크를 복사했습니다.");
  };

  const logout = async () => {
    await fetch("/api/partner/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: "{}",
    });
    window.location.assign("/partner/login");
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) {
      setMessage("새 비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/partner/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          currentPassword: passwords.current,
          newPassword: passwords.next,
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "비밀번호를 변경하지 못했습니다.");
      setPasswords({ current: "", next: "", confirm: "" });
      setMessage("비밀번호를 변경했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀번호를 변경하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const changeAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/partner/payout-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          currentPassword: account.currentPassword,
          bankName: account.bankName,
          accountHolder: account.accountHolder,
          accountNumber: account.accountNumber,
        }),
      });
      const result = await response.json() as { detail?: string; accountNumberLast4?: string };
      if (!response.ok) throw new Error(result.detail || "정산 계좌를 변경하지 못했습니다.");
      setAccount((current) => ({ ...current, accountNumber: "", currentPassword: "" }));
      setMessage(`정산 계좌를 변경했습니다. 끝자리 ${result.accountNumberLast4 || ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "정산 계좌를 변경하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0d0f10] text-neutral-100">
      <header className="border-b border-white/10 bg-[#111415]/95">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[.22em] text-[#ff9585]">Easy Cut Partner</p>
            <h1 className="mt-1 text-xl font-black">{creatorName}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={copyLink} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-black">추천 링크 복사</button>
            <button onClick={logout} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-neutral-300">로그아웃</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-5 py-7 sm:px-8">
        <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-white/10 bg-[#171a1b] p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-black">{referralUrl}</h2>
              {status === "paused" && <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-xs font-black text-amber-200">신규 귀속 일시정지</span>}
            </div>
            <p className="mt-2 text-sm text-neutral-500">현재 수익률 {(commissionRateBps / 100).toFixed(2)}%</p>
          </div>
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="text-xs font-bold text-neutral-500">시작일<input type="date" name="from" defaultValue={from} className="mt-1 block h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-neutral-200" /></label>
            <label className="text-xs font-bold text-neutral-500">종료일<input type="date" name="to" defaultValue={to} className="mt-1 block h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-neutral-200" /></label>
            <button className="h-10 rounded-xl bg-[#ff8c7c] px-4 text-sm font-black text-black">조회</button>
            <a href={`/api/partner/commissions.csv?from=${from}&to=${to}`} className="grid h-10 place-items-center rounded-xl border border-white/10 px-4 text-sm font-black">CSV</a>
          </form>
        </section>

        {message && <p role="status" className="mt-4 rounded-xl border border-[#ff8c7c]/20 bg-[#ff8c7c]/10 px-4 py-3 text-sm font-bold text-[#ffb4a8]">{message}</p>}

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["고유 방문자", `${metrics.uniqueVisitors.toLocaleString("ko-KR")}명`],
            ["신규 가입", `${metrics.signups.toLocaleString("ko-KR")}명`],
            ["유료 전환", `${metrics.paidCustomers.toLocaleString("ko-KR")}명`],
            ["가입 전환율", `${metrics.signupConversionRate.toFixed(1)}%`],
            ["총매출", money(metrics.grossSalesKrw)],
            ["환불", money(metrics.refundsKrw)],
            ["순매출", money(metrics.netSalesKrw)],
            ["기간 수익", money(metrics.periodCommissionKrw)],
          ].map(([label, value]) => (
            <article key={label} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
              <p className="text-xs font-bold text-neutral-500">{label}</p>
              <p className="mt-3 text-2xl font-black">{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ["정산 대기", metrics.pendingKrw, "text-amber-200"],
            ["정산 가능", metrics.availableKrw, metrics.availableKrw < 0 ? "text-rose-300" : "text-emerald-200"],
            ["지급 완료", metrics.paidKrw, "text-sky-200"],
          ].map(([label, value, tone]) => (
            <article key={String(label)} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
              <p className="text-xs font-bold text-neutral-500">{label}</p>
              <p className={`mt-3 text-3xl font-black ${tone}`}>{money(Number(value))}</p>
            </article>
          ))}
        </section>

        <section className="mt-7 overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
          <div className="border-b border-white/10 p-5"><h2 className="text-lg font-black">수익 거래</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="px-5 py-3">결제일</th><th className="px-4 py-3">회원</th><th className="px-4 py-3">상품</th><th className="px-4 py-3">결제 / 환불</th><th className="px-4 py-3">수익률</th><th className="px-5 py-3">수익 상태</th></tr></thead>
              <tbody className="divide-y divide-white/[.06]">
                {transactions.map((item) => {
                  return (
                    <tr key={item.id}>
                      <td className="px-5 py-4 text-xs text-neutral-400">{date(item.approvedAt)}</td>
                      <td className="px-4 py-4 font-bold">{item.memberEmail}</td>
                      <td className="px-4 py-4">{item.productCode}</td>
                      <td className="px-4 py-4"><p>{money(item.grossAmountKrw)}</p><p className="mt-1 text-xs text-rose-300">환불 {money(item.refundedAmountKrw)}</p></td>
                      <td className="px-4 py-4">{(item.commissionRateBps / 100).toFixed(2)}%</td>
                      <td className="px-5 py-4"><p className="font-black text-[#ffb4a8]">{money(item.commissionAmountKrw)}</p><p className="mt-1 text-xs text-neutral-500">{item.isAvailable ? "정산 가능" : `${date(item.availableAt)} 이후`}</p></td>
                    </tr>
                  );
                })}
                {!transactions.length && <tr><td colSpan={6} className="px-5 py-14 text-center text-neutral-500">선택한 기간의 수익 거래가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-7 grid gap-5 xl:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-[#151819] p-5">
            <h2 className="text-lg font-black">캠페인 성과</h2>
            <div className="mt-4 divide-y divide-white/[.06]">
              {campaigns.map((campaign) => (
                <div key={campaign.campaign} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <strong>{campaign.campaign}</strong>
                  <span className="text-neutral-400">클릭 {campaign.clicks.toLocaleString("ko-KR")} · 고유 {campaign.uniqueVisitors.toLocaleString("ko-KR")}</span>
                </div>
              ))}
              {!campaigns.length && <p className="py-8 text-center text-sm text-neutral-500">캠페인 방문이 없습니다.</p>}
            </div>
          </section>
          <section className="rounded-2xl border border-white/10 bg-[#151819] p-5">
            <h2 className="text-lg font-black">정산 내역</h2>
            <div className="mt-4 divide-y divide-white/[.06]">
              {payouts.map((payout) => (
                <div key={payout.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <div><strong>{payout.periodStart} ~ {payout.periodEnd}</strong><p className="mt-1 text-xs text-neutral-500">{payoutStatus(payout.status)} · {date(payout.paidAt || payout.createdAt)}</p></div>
                  <strong>{money(payout.amountKrw)}</strong>
                </div>
              ))}
              {!payouts.length && <p className="py-8 text-center text-sm text-neutral-500">아직 정산 내역이 없습니다.</p>}
            </div>
          </section>
        </div>

        <div className="mt-7 grid gap-5 xl:grid-cols-2">
          <form onSubmit={changePassword} className="rounded-2xl border border-white/10 bg-[#151819] p-5">
            <h2 className="text-lg font-black">비밀번호 변경</h2>
            {[
              ["현재 비밀번호", "current", "current-password"],
              ["새 비밀번호", "next", "new-password"],
              ["새 비밀번호 확인", "confirm", "new-password"],
            ].map(([label, key, autoComplete]) => (
              <label key={key} className="mt-4 block text-xs font-bold text-neutral-500">{label}<input required type="password" minLength={key === "current" ? 1 : 10} autoComplete={autoComplete} value={passwords[key as keyof typeof passwords]} onChange={(event) => setPasswords((current) => ({ ...current, [key]: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-neutral-200 outline-none focus:border-[#ff8c7c]" /></label>
            ))}
            <button disabled={submitting} className="mt-5 h-11 rounded-xl bg-white px-5 text-sm font-black text-black disabled:opacity-50">비밀번호 변경</button>
          </form>

          <form onSubmit={changeAccount} className="rounded-2xl border border-white/10 bg-[#151819] p-5">
            <h2 className="text-lg font-black">정산 계좌</h2>
            {payoutProfile.accountNumberLast4 && <p className="mt-2 text-sm text-neutral-500">현재 {payoutProfile.bankName} · {payoutProfile.accountHolder} · ••••{payoutProfile.accountNumberLast4}</p>}
            {[
              ["은행명", "bankName", "text"],
              ["예금주", "accountHolder", "text"],
              ["새 계좌번호", "accountNumber", "text"],
              ["현재 비밀번호", "currentPassword", "password"],
            ].map(([label, key, type]) => (
              <label key={key} className="mt-4 block text-xs font-bold text-neutral-500">{label}<input required type={type} value={account[key as keyof typeof account]} onChange={(event) => setAccount((current) => ({ ...current, [key]: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-neutral-200 outline-none focus:border-[#ff8c7c]" /></label>
            ))}
            <button disabled={submitting} className="mt-5 h-11 rounded-xl bg-white px-5 text-sm font-black text-black disabled:opacity-50">계좌 변경</button>
          </form>
        </div>
        <p className="mt-8 text-center text-xs text-neutral-600">
          <Link href="/partner/terms" className="underline underline-offset-4">레퍼럴 파트너 운영 약관</Link>
        </p>
      </div>
    </main>
  );
}
