"use client";

import { ReferralTransactionsTable } from "@/components/referral-transactions-table";
import { ReferralSettlementTable } from "@/components/referral-settlement-table";
import { ReferralSettlementRefresh } from "@/components/referral-settlement-refresh";
import { referralMonthPeriod, type ReferralMonthlySettlement, type ReferralSettlementTransaction } from "@/lib/referral-settlement";
import type { ReferralPartnerSettlementLedger } from "@/lib/referral-settlement-server";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type AdminReferralPartner = {
  id: string;
  creatorName: string;
  slug: string;
  loginId: string;
  commissionRateBps: number;
  status: "active" | "paused" | "terminated";
  recoveryEmail: string | null;
  bankName: string | null;
  accountHolder: string | null;
  accountNumberLast4: string | null;
  createdAt: string;
  terminatedAt: string | null;
  clicks: number;
  uniqueVisitors: number;
  signups: number;
  paidCustomers: number;
  grossSalesKrw: number;
  refundsKrw: number;
};

export type AdminReferralPayout = {
  id: string;
  partnerId: string;
  creatorName: string;
  slug: string;
  periodStart: string;
  periodEnd: string;
  amountKrw: number;
  status: string;
  accountNumberLast4: string | null;
  transferReference: string | null;
  createdAt: string;
  paidAt: string | null;
};

type CreateForm = {
  creatorName: string;
  slug: string;
  loginId: string;
  temporaryPassword: string;
  recoveryEmail: string;
  commissionPercent: string;
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

function defaultPayoutPeriod() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function AdminReferralsDashboard({
  partners,
  payouts, settlementLedgers, initialMonth, currentMonth,
}: {
  partners: AdminReferralPartner[];
  payouts: AdminReferralPayout[];
  settlementLedgers: ReferralPartnerSettlementLedger[];
  initialMonth: string;
  currentMonth: string;
}) {
  const router = useRouter();
  const [settlementMonth, setSettlementMonth] = useState(initialMonth);
  const selectedRows = partners.flatMap((partner) => {
    const row = settlementLedgers.find((ledger) => ledger.partnerId === partner.id)?.months.find((month) => month.month === settlementMonth);
    return row ? [{ partner, row }] : [];
  });
  const historyRows = partners.flatMap((partner) => (settlementLedgers.find((ledger) => ledger.partnerId === partner.id)?.months ?? [])
    .filter((month) => month.month <= currentMonth).map((row) => ({ partner, row })));
  const forecast = settlementLedgers.reduce((sum, ledger) => sum + (ledger.months.find((row) => row.month === currentMonth)?.commissionKrw ?? 0), 0);
  const monthOptions = [...new Set([initialMonth, currentMonth, ...historyRows.map(({ row }) => row.month)])].sort().reverse();
  const [calculation, setCalculation] = useState<{ name: string; month: string; transactions: ReferralSettlementTransaction[] } | null>(null);
  const [loadingCalculation, setLoadingCalculation] = useState(false);
  const showCalculation = async (partner: AdminReferralPartner, month: string) => {
    if (loadingCalculation) return;
    setLoadingCalculation(true);
    try {
      const response = await fetch(`/api/admin/referrals/${partner.id}/payouts?month=${month}`, { credentials: "same-origin", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "계산 내역을 불러오지 못했습니다.");
      setCalculation({ name: partner.creatorName, month, transactions: result.transactions });
    } catch (error) { setMessage(error instanceof Error ? error.message : "조회 실패"); }
    finally { setLoadingCalculation(false); }
  };
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminReferralPartner | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({
    creatorName: "",
    slug: "",
    loginId: "",
    temporaryPassword: "",
    recoveryEmail: "",
    commissionPercent: "20",
  });
  const [editForm, setEditForm] = useState({
    creatorName: "",
    recoveryEmail: "",
    commissionPercent: "20",
    status: "active" as AdminReferralPartner["status"],
  });
  const [payoutPartner, setPayoutPartner] = useState<AdminReferralPartner | null>(null);
  const [resetPartner, setResetPartner] = useState<AdminReferralPartner | null>(null);
  const [resetTemporaryPassword, setResetTemporaryPassword] = useState("");
  const [payoutPeriod, setPayoutPeriod] = useState(defaultPayoutPeriod);
  const [payoutNote, setPayoutNote] = useState("");
  const [availability, setAvailability] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealedAccount, setRevealedAccount] = useState<string | null>(null);


  const checkAvailability = async () => {
    if (!createForm.slug || !createForm.loginId) return;
    const params = new URLSearchParams({ slug: createForm.slug, loginId: createForm.loginId });
    const response = await fetch(`/api/admin/referrals/availability?${params}`, { credentials: "same-origin" });
    const result = await response.json() as {
      slugAvailable?: boolean;
      loginIdAvailable?: boolean;
      detail?: string;
    };
    if (!response.ok) {
      setAvailability(result.detail || "중복 검사를 완료하지 못했습니다.");
      return;
    }
    setAvailability(
      result.slugAvailable && result.loginIdAvailable
        ? "주소와 로그인 아이디를 모두 사용할 수 있습니다."
        : `${result.slugAvailable ? "" : "주소 중복 "} ${result.loginIdAvailable ? "" : "로그인 아이디 중복"}`.trim(),
    );
  };

  const createPartner = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          creatorName: createForm.creatorName,
          slug: createForm.slug,
          loginId: createForm.loginId,
          temporaryPassword: createForm.temporaryPassword,
          recoveryEmail: createForm.recoveryEmail,
          commissionRateBps: Math.round(Number(createForm.commissionPercent) * 100),
        }),
      });
      const result = await response.json() as { detail?: string; url?: string };
      if (!response.ok) throw new Error(result.detail || "파트너를 생성하지 못했습니다.");
      setMessage(`파트너를 생성했습니다. 링크: ${result.url}`);
      setShowCreate(false);
      setCreateForm({
        creatorName: "",
        slug: "",
        loginId: "",
        temporaryPassword: "",
        recoveryEmail: "",
        commissionPercent: "20",
      });
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파트너를 생성하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (partner: AdminReferralPartner) => {
    setEditing(partner);
    setEditForm({
      creatorName: partner.creatorName,
      recoveryEmail: partner.recoveryEmail || "",
      commissionPercent: String(partner.commissionRateBps / 100),
      status: partner.status,
    });
  };

  const updatePartner = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/referrals/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          creatorName: editForm.creatorName,
          recoveryEmail: editForm.recoveryEmail,
          commissionRateBps: Math.round(Number(editForm.commissionPercent) * 100),
          status: editForm.status,
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "파트너 정보를 변경하지 못했습니다.");
      setEditing(null);
      setMessage("파트너 정보를 변경했습니다. 변경된 수익률은 다음 결제부터 적용됩니다.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "파트너 정보를 변경하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetPartner) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/referrals/${resetPartner.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          temporaryPassword: resetTemporaryPassword,
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "비밀번호를 초기화하지 못했습니다.");
      setResetPartner(null);
      setResetTemporaryPassword("");
      setMessage("임시 비밀번호를 설정하고 기존 파트너 세션을 종료했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀번호를 초기화하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const revealAccount = async (partner: AdminReferralPartner) => {
    const response = await fetch(`/api/admin/referrals/${partner.id}/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: "{}",
    });
    const result = await response.json() as {
      detail?: string;
      bankName?: string;
      accountHolder?: string;
      accountNumber?: string;
    };
    if (!response.ok) {
      setMessage(result.detail || "정산 계좌를 확인하지 못했습니다.");
      return;
    }
    setRevealedAccount(`${result.bankName} · ${result.accountHolder} · ${result.accountNumber}`);
  };

  const createPayout = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!payoutPartner) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/referrals/${payoutPartner.id}/payouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          settlementMonth: payoutPeriod.start.slice(0, 7),
          note: payoutNote,
        }),
      });
      const result = await response.json() as { detail?: string; amountKrw?: number };
      if (!response.ok) throw new Error(result.detail || "정산을 생성하지 못했습니다.");
      setMessage(`${payoutPartner.creatorName} 정산 ${money(result.amountKrw || 0)}을 생성했습니다.`);
      setPayoutPartner(null);
      setRevealedAccount(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "정산을 생성하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const updatePayout = async (payout: Pick<AdminReferralPayout, "id" | "amountKrw">, action: "paid" | "canceled") => {
    const transferReference = action === "paid"
      ? window.prompt(`${money(payout.amountKrw)}을 실제로 송금한 경우에만 지급 완료를 기록합니다. 은행 이체 확인값을 입력해 주세요.`)
      : "";
    if (action === "paid" && !transferReference) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/referrals/payouts/${payout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          action,
          confirmedAmountKrw: action === "paid" ? payout.amountKrw : undefined,
          transferReference,
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "정산 상태를 변경하지 못했습니다.");
      setMessage(action === "paid" ? "정산을 지급 완료로 처리했습니다." : "정산을 취소했습니다.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "정산 상태를 변경하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const settlementActions = (partner: AdminReferralPartner, row: ReferralMonthlySettlement) => {
    if (row.status === "draft" && row.payoutId) {
      const payout = { id: row.payoutId, amountKrw: row.payableKrw };
      return <><button disabled={submitting} onClick={() => updatePayout(payout, "paid")} className="rounded-lg bg-emerald-300 px-3 py-2 text-xs font-black text-black disabled:opacity-40">지급 완료</button><button disabled={submitting} onClick={() => updatePayout(payout, "canceled")} className="rounded-lg border border-white/15 px-3 py-2 text-xs">준비 취소</button></>;
    }
    if (row.status === "paid" || row.status === "zero") return null;
    const reason = row.reviewCount ? "계약·환불 확인 후 지급 가능" : !partner.accountNumberLast4 ? "정산 계좌 미등록" : !row.payableNow ? `${row.scheduledPaymentDate}부터 지급 가능` : null;
    return <><button disabled={submitting || Boolean(reason)} onClick={() => {
      setPayoutPartner(partner); setRevealedAccount(null);
      setPayoutPeriod({ start: row.periodStart, end: row.periodEnd });
    }} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-xs font-black text-emerald-200 disabled:opacity-40">지급 준비</button>{reason && <p className="w-full text-xs text-neutral-400">{reason}</p>}</>;
  };

  return (
    <div className="mt-7">
      <ReferralSettlementRefresh />
      <section className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h2 className="text-xl font-black">월별 실적 정산</h2><p className="mt-2 text-sm text-neutral-400">매월 1일~말일 발생분을 다음 달 10일에 지급합니다. 한국시간 기준입니다.</p></div>
          <label className="text-sm font-bold">실적 월<select value={settlementMonth} onChange={(event) => setSettlementMonth(event.target.value)} className="ml-3 rounded-lg border border-white/15 bg-[#191c1d] px-3 py-2">{monthOptions.map((month) => <option key={month} value={month}>{month}</option>)}</select></label>
        </div>
        <p className="mt-4 text-sm">{settlementMonth} 실적 → <strong className="text-emerald-200">{referralMonthPeriod(settlementMonth).scheduledPaymentDate} 지급 예정</strong></p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[["확정 매출", selectedRows.reduce((sum, { row }) => sum + row.confirmedSalesKrw, 0)], ["레퍼럴 수익", selectedRows.reduce((sum, { row }) => sum + row.commissionKrw, 0)], ["미지급 · 송금 준비", selectedRows.reduce((sum, { row }) => sum + (row.status !== "paid" ? row.payableKrw : 0), 0)]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-black/20 p-4"><p className="text-xs text-neutral-400">{label}</p><p className="mt-2 text-xl font-black">{money(Number(value))}</p></div>)}
        </div>
        <p className="mt-4 text-sm text-neutral-400">{currentMonth} 예상 수익 <strong className="text-white">{money(forecast)}</strong> → {referralMonthPeriod(currentMonth).scheduledPaymentDate} 지급 예정 · 결제·환불에 따라 변동</p>
        <p className="mt-2 text-xs text-neutral-500">확정 매출은 회차 발생 후 7일이 지난 환불 반영 매출입니다. 원계약의 월 단가와 결제 당시 수익률을 유지하며, 상품 전환으로 높아진 단가 차액은 레퍼럴에서 제외합니다.</p>
      </section>
      <div className="mt-4"><ReferralSettlementTable showPartner rows={selectedRows.map(({ partner, row }) => ({ key: partner.id, partnerName: partner.creatorName, settlement: row, actions: <>{settlementActions(partner, row)}<button type="button" disabled={loadingCalculation} onClick={() => showCalculation(partner, row.month)} className="rounded-lg border border-white/15 px-3 py-2 text-xs disabled:opacity-40">세부 계산</button></> }))} /></div>
      <details className="mt-4 rounded-2xl border border-white/10 p-4"><summary className="cursor-pointer font-bold">전체 월별 내역 · 지난 미지급 확인</summary><div className="mt-4"><ReferralSettlementTable showPartner rows={historyRows.map(({ partner, row }) => ({ key: `${partner.id}-${row.month}`, partnerName: partner.creatorName, settlement: row, actions: <>{settlementActions(partner, row)}<button type="button" disabled={loadingCalculation} onClick={() => showCalculation(partner, row.month)} className="rounded-lg border border-white/15 px-3 py-2 text-xs disabled:opacity-40">세부 계산</button></> }))} /></div></details>

      {calculation && <section className="mt-5 rounded-2xl border border-white/10 bg-[#171a1b]" aria-label="정산 세부 계산">
        <div className="flex items-center justify-between p-4"><h2 className="font-black">{calculation.name} · {calculation.month} 세부 계산</h2><button type="button" onClick={() => setCalculation(null)} className="rounded-lg border border-white/15 px-3 py-2 text-xs">닫기</button></div>
        <ReferralTransactionsTable transactions={calculation.transactions} />
      </section>}
      <div className="mt-5 flex justify-end">
        <button onClick={() => setShowCreate(true)} className="rounded-xl bg-[#ff8c7c] px-5 py-3 text-sm font-black text-black">레퍼럴 추가</button>
      </div>
      {message && <p role="status" className="mt-4 rounded-xl border border-[#ff8c7c]/20 bg-[#ff8c7c]/10 px-4 py-3 text-sm font-bold text-[#ffb4a8]">{message}</p>}

      <section className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5"><h2 className="text-lg font-black">레퍼럴 파트너</h2><p className="mt-1 text-xs text-neutral-500">파트너 계정과 수익률, 정산 계좌를 관리합니다. 지급액은 위의 월별 정산에서 확인하세요.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-left text-sm">
            <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="px-5 py-3">파트너 / 링크</th><th className="px-4 py-3">상태 / 수익률</th><th className="px-4 py-3">방문 / 가입</th><th className="px-4 py-3">유료 전환</th><th className="px-4 py-3">누적 결제 / 환불</th><th className="px-4 py-3">정산 계좌</th><th className="px-5 py-3 text-right">관리</th></tr></thead>
            <tbody className="divide-y divide-white/[.06]">
              {partners.map((partner) => (
                <tr key={partner.id} className="align-top">
                  <td className="px-5 py-4"><strong>{partner.creatorName}</strong><p className="mt-1 text-xs text-[#ff9b8d]">easycut.co.kr/{partner.slug}</p><p className="mt-1 text-xs text-neutral-600">ID {partner.loginId}</p></td>
                  <td className="px-4 py-4"><span className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-black">{partner.status}</span><p className="mt-2 font-black">{(partner.commissionRateBps / 100).toFixed(2)}%</p></td>
                  <td className="px-4 py-4"><p>고유 {partner.uniqueVisitors.toLocaleString("ko-KR")}</p><p className="mt-1 text-xs text-neutral-500">가입 {partner.signups.toLocaleString("ko-KR")}</p></td>
                  <td className="px-4 py-4"><strong>{partner.paidCustomers.toLocaleString("ko-KR")}명</strong><p className="mt-1 text-xs text-neutral-500">{partner.signups ? (partner.paidCustomers / partner.signups * 100).toFixed(1) : "0.0"}%</p></td>
                  <td className="px-4 py-4"><strong>{money(partner.grossSalesKrw)}</strong><p className="mt-1 text-xs text-rose-300">환불 {money(partner.refundsKrw)}</p></td>
                  <td className="px-4 py-4"><p>{partner.bankName || "미등록"}</p><p className="mt-1 text-xs text-neutral-500">{partner.accountNumberLast4 ? `${partner.accountHolder} · ••••${partner.accountNumberLast4}` : "-"}</p></td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(partner)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-black">설정</button>
                      <button onClick={() => { setResetPartner(partner); setResetTemporaryPassword(""); }} disabled={submitting} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-black">비번 초기화</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!partners.length && <tr><td colSpan={7} className="px-5 py-14 text-center text-neutral-500">등록된 레퍼럴 파트너가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-7 overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5"><h2 className="text-lg font-black">정산 내역</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="px-5 py-3">생성일</th><th className="px-4 py-3">파트너</th><th className="px-4 py-3">기간</th><th className="px-4 py-3">금액</th><th className="px-4 py-3">상태</th><th className="px-5 py-3 text-right">관리</th></tr></thead>
            <tbody className="divide-y divide-white/[.06]">
              {payouts.map((payout) => (
                <tr key={payout.id}><td className="px-5 py-4 text-xs text-neutral-400">{date(payout.createdAt)}</td><td className="px-4 py-4 font-bold">{payout.creatorName}</td><td className="px-4 py-4">{payout.periodStart} ~ {payout.periodEnd}</td><td className="px-4 py-4 font-black">{money(payout.amountKrw)}</td><td className="px-4 py-4">{payout.status === "paid" ? "지급 완료" : payout.status === "canceled" ? "취소" : "지급 대기"}</td><td className="px-5 py-4 text-right">{payout.status === "draft" && <div className="flex justify-end gap-2"><button onClick={() => updatePayout(payout, "paid")} className="rounded-lg bg-emerald-300 px-3 py-2 text-xs font-black text-black">지급 완료</button><button onClick={() => updatePayout(payout, "canceled")} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-black">취소</button></div>}</td></tr>
              ))}
              {!payouts.length && <tr><td colSpan={6} className="px-5 py-14 text-center text-neutral-500">정산 내역이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="referral-create-title">
          <form onSubmit={createPartner} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#191c1d] p-6">
            <div className="flex items-center justify-between"><h2 id="referral-create-title" className="text-xl font-black">레퍼럴 추가</h2><button type="button" onClick={() => setShowCreate(false)}>닫기</button></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ["크리에이터명", "creatorName", "text"],
                ["URL 영문 코드", "slug", "text"],
                ["로그인 아이디", "loginId", "text"],
                ["임시 비밀번호", "temporaryPassword", "password"],
                ["복구 이메일 (선택)", "recoveryEmail", "email"],
                ["수익률 (%)", "commissionPercent", "number"],
              ].map(([label, key, type]) => (
                <label key={key} className="text-xs font-bold text-neutral-400">{label}<input required={!label.includes("선택")} type={type} min={type === "number" ? 0 : undefined} max={type === "number" ? 100 : undefined} step={type === "number" ? "0.01" : undefined} minLength={key === "temporaryPassword" ? 10 : undefined} value={createForm[key as keyof CreateForm]} onChange={(event) => setCreateForm((current) => ({ ...current, [key]: event.target.value }))} onBlur={key === "slug" || key === "loginId" ? checkAvailability : undefined} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 outline-none focus:border-[#ff8c7c]" /></label>
              ))}
            </div>
            {availability && <p className="mt-4 text-sm font-bold text-[#ffb4a8]">{availability}</p>}
            <button disabled={submitting} className="mt-6 h-11 rounded-xl bg-[#ff8c7c] px-5 text-sm font-black text-black disabled:opacity-50">파트너 생성</button>
          </form>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="referral-edit-title">
          <form onSubmit={updatePartner} className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#191c1d] p-6">
            <div className="flex items-center justify-between"><h2 id="referral-edit-title" className="text-xl font-black">파트너 설정</h2><button type="button" onClick={() => setEditing(null)}>닫기</button></div>
            <label className="mt-5 block text-xs font-bold text-neutral-400">크리에이터명<input required value={editForm.creatorName} onChange={(event) => setEditForm((current) => ({ ...current, creatorName: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3" /></label>
            <label className="mt-4 block text-xs font-bold text-neutral-400">복구 이메일<input type="email" value={editForm.recoveryEmail} onChange={(event) => setEditForm((current) => ({ ...current, recoveryEmail: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3" /></label>
            <label className="mt-4 block text-xs font-bold text-neutral-400">수익률 (%)<input required type="number" min="0" max="100" step="0.01" value={editForm.commissionPercent} onChange={(event) => setEditForm((current) => ({ ...current, commissionPercent: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3" /></label>
            <label className="mt-4 block text-xs font-bold text-neutral-400">상태<select value={editForm.status} onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as AdminReferralPartner["status"] }))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#191c1d] px-3"><option value="active">활성</option><option value="paused">일시정지</option><option value="terminated">종료</option></select></label>
            <button disabled={submitting} className="mt-6 h-11 rounded-xl bg-white px-5 text-sm font-black text-black disabled:opacity-50">저장</button>
          </form>
        </div>
      )}

      {payoutPartner && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="referral-payout-title">
          <form onSubmit={createPayout} className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#191c1d] p-6">
            <div className="flex items-center justify-between"><h2 id="referral-payout-title" className="text-xl font-black">{payoutPartner.creatorName} 지급 준비</h2><button type="button" onClick={() => setPayoutPartner(null)}>닫기</button></div>
            <p className="mt-4 text-sm text-neutral-400">{payoutPeriod.start} ~ {payoutPeriod.end} 실적 · {referralMonthPeriod(payoutPeriod.start.slice(0, 7)).scheduledPaymentDate} 지급 예정 · 계좌 ••••{payoutPartner.accountNumberLast4}</p>
            <button type="button" onClick={() => revealAccount(payoutPartner)} className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs font-black">계좌 전체 확인</button>
            {revealedAccount && <p className="mt-3 rounded-xl bg-black/20 p-3 font-mono text-sm">{revealedAccount}</p>}
            <p className="mt-5 text-sm">최신 환불 조정을 반영해 이 실적 월의 송금액을 준비합니다. 자동으로 이체되지 않습니다.</p>
            <label className="mt-4 block text-xs font-bold text-neutral-400">메모<textarea value={payoutNote} onChange={(event) => setPayoutNote(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-white/10 bg-black/20 p-3" /></label>
            <button disabled={submitting} className="mt-6 h-11 rounded-xl bg-emerald-300 px-5 text-sm font-black text-black disabled:opacity-50">지급 준비</button>
          </form>
        </div>
      )}

      {resetPartner && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="partner-reset-title">
          <form onSubmit={resetPassword} className="w-full max-w-md rounded-3xl border border-white/10 bg-[#191c1d] p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 id="partner-reset-title" className="text-xl font-black">임시 비밀번호 설정</h2>
              <button type="button" onClick={() => setResetPartner(null)}>닫기</button>
            </div>
            <p className="mt-3 text-sm text-neutral-400">{resetPartner.creatorName} · {resetPartner.loginId}</p>
            <label className="mt-5 block text-xs font-bold text-neutral-400">
              새 임시 비밀번호
              <input
                required
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                value={resetTemporaryPassword}
                onChange={(event) => setResetTemporaryPassword(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 outline-none focus:border-[#ff8c7c]"
              />
            </label>
            <p className="mt-3 text-xs leading-5 text-amber-200">저장하면 기존 파트너 세션이 모두 종료되고, 다음 로그인에서 비밀번호 변경을 요구합니다.</p>
            <button disabled={submitting} className="mt-5 h-11 rounded-xl bg-white px-5 text-sm font-black text-black disabled:opacity-50">임시 비밀번호 저장</button>
          </form>
        </div>
      )}
    </div>
  );
}
