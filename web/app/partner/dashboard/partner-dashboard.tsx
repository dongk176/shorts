"use client";

import Link from "next/link";
import { ReferralTransactionsTable } from "@/components/referral-transactions-table";
import { ReferralSettlementTable } from "@/components/referral-settlement-table";
import { ReferralSettlementRefresh } from "@/components/referral-settlement-refresh";
import { referralMonthPeriod, type ReferralMonthlySettlement, type ReferralSettlementTransaction } from "@/lib/referral-settlement";
import { useState } from "react";

export type PartnerDashboardMetrics = {
  clicks: number;
  uniqueVisitors: number;
  signups: number;
  paidCustomers: number;
  signupConversionRate: number;
  paidConversionRate: number;
};


export type PartnerTransaction = ReferralSettlementTransaction;

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
  settlementMonths, selectedMonth, currentMonth,
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
  settlementMonths: ReferralMonthlySettlement[];
  selectedMonth: string;
  currentMonth: string;
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
  const monthly = settlementMonths.find((row) => row.month === selectedMonth);
  const forecast = settlementMonths.find((row) => row.month === currentMonth);
  const visibleMonths = settlementMonths.filter((row) => row.month <= currentMonth || row.month === selectedMonth);
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
            <p className="mt-2 text-sm text-neutral-500">현재 수익률 {(commissionRateBps / 100).toFixed(2)}% · 조회 기간 {from} ~ {to}</p>
          </div>
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="text-xs font-bold text-neutral-400">실적 월<select name="month" defaultValue={selectedMonth} className="mt-1 block h-10 rounded-xl border border-white/10 bg-[#191c1d] px-3 text-neutral-200">{visibleMonths.map((row) => <option key={row.month} value={row.month}>{row.month}</option>)}</select></label>
            <button className="h-10 rounded-xl bg-[#ff8c7c] px-4 text-sm font-black text-black">조회</button>
            <a href={`/api/partner/commissions.csv?month=${selectedMonth}`} className="grid h-10 place-items-center rounded-xl border border-white/10 px-4 text-sm font-black">CSV</a>
          </form>
        </section>

        {message && <p role="status" className="mt-4 rounded-xl border border-[#ff8c7c]/20 bg-[#ff8c7c]/10 px-4 py-3 text-sm font-bold text-[#ffb4a8]">{message}</p>}

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["고유 방문자", `${metrics.uniqueVisitors.toLocaleString("ko-KR")}명`],
            ["신규 가입", `${metrics.signups.toLocaleString("ko-KR")}명`],
            ["유료 전환", `${metrics.paidCustomers.toLocaleString("ko-KR")}명`],
            ["가입 전환율", `${metrics.signupConversionRate.toFixed(1)}%`],
          ].map(([label, value]) => (
            <article key={label} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
              <p className="text-xs font-bold text-neutral-500">{label}</p>
              <p className="mt-3 text-2xl font-black">{value}</p>
            </article>
          ))}
        </section>

        <ReferralSettlementRefresh />
        <section className="mt-5 rounded-2xl border border-white/10 bg-[#171a1b] p-5">
          <h2 className="text-xl font-black">{selectedMonth} 실적 → {referralMonthPeriod(selectedMonth).scheduledPaymentDate} 지급 예정</h2>
          <p className="mt-2 text-sm text-neutral-400">매월 1일~말일 발생분을 다음 달 10일에 지급합니다. 한국시간 기준이며 확정 매출은 발생 후 7일이 지난 환불 반영 매출입니다.</p>
          <p className="mt-4 text-sm text-neutral-300">{currentMonth} 예상 수익 <strong className="text-white">{money(forecast?.commissionKrw ?? 0)}</strong> → {referralMonthPeriod(currentMonth).scheduledPaymentDate} 지급 예정 · 결제·환불에 따라 변동</p>
          <div className="mt-4"><ReferralSettlementTable rows={monthly ? [{ key: monthly.month, settlement: monthly }] : []} /></div>
        </section>
        <details className="mt-4 rounded-2xl border border-white/10 p-4"><summary className="cursor-pointer font-bold">전체 월별 내역 · 지급 상태</summary><div className="mt-4"><ReferralSettlementTable rows={visibleMonths.map((row) => ({ key: row.month, settlement: row }))} /></div></details>

        <section className="mt-7 overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
          <div className="border-b border-white/10 p-5"><h2 className="text-lg font-black">월별 수익 거래</h2><p className="mt-1 text-xs text-neutral-500">원계약의 월별 금액을 상한으로 계산합니다. 전환 시 단가 인상분은 제외하고, 종료된 회차의 수익은 취소합니다.</p></div>
          <ReferralTransactionsTable transactions={transactions} />
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
