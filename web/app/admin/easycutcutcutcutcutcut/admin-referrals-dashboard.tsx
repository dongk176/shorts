"use client";

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
  commissionKrw: number;
  pendingKrw: number;
  availableKrw: number;
  paidKrw: number;
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
  payouts,
}: {
  partners: AdminReferralPartner[];
  payouts: AdminReferralPayout[];
}) {
  const router = useRouter();
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

  const totals = partners.reduce((acc, partner) => ({
    signups: acc.signups + partner.signups,
    gross: acc.gross + partner.grossSalesKrw,
    commission: acc.commission + partner.commissionKrw,
    available: acc.available + partner.availableKrw,
  }), { signups: 0, gross: 0, commission: 0, available: 0 });

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
          periodStart: payoutPeriod.start,
          periodEnd: payoutPeriod.end,
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

  const updatePayout = async (payout: AdminReferralPayout, action: "paid" | "canceled") => {
    const transferReference = action === "paid"
      ? window.prompt("은행 이체 확인값 또는 메모를 입력해 주세요.")
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

  return (
    <div className="mt-7">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["파트너", `${partners.length.toLocaleString("ko-KR")}명`],
          ["추천 가입", `${totals.signups.toLocaleString("ko-KR")}명`],
          ["추천 매출", money(totals.gross)],
          ["정산 가능", money(totals.available)],
        ].map(([label, value]) => (
          <article key={label} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
            <p className="text-xs font-bold text-neutral-500">{label}</p>
            <p className="mt-3 text-2xl font-black">{value}</p>
          </article>
        ))}
      </section>

      <div className="mt-5 flex justify-end">
        <button onClick={() => setShowCreate(true)} className="rounded-xl bg-[#ff8c7c] px-5 py-3 text-sm font-black text-black">레퍼럴 추가</button>
      </div>
      {message && <p role="status" className="mt-4 rounded-xl border border-[#ff8c7c]/20 bg-[#ff8c7c]/10 px-4 py-3 text-sm font-bold text-[#ffb4a8]">{message}</p>}

      <section className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5"><h2 className="text-lg font-black">레퍼럴 파트너</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-left text-sm">
            <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="px-5 py-3">파트너 / 링크</th><th className="px-4 py-3">상태 / 수익률</th><th className="px-4 py-3">방문 / 가입</th><th className="px-4 py-3">유료 전환</th><th className="px-4 py-3">매출 / 환불</th><th className="px-4 py-3">수익</th><th className="px-4 py-3">정산 계좌</th><th className="px-5 py-3 text-right">관리</th></tr></thead>
            <tbody className="divide-y divide-white/[.06]">
              {partners.map((partner) => (
                <tr key={partner.id} className="align-top">
                  <td className="px-5 py-4"><strong>{partner.creatorName}</strong><p className="mt-1 text-xs text-[#ff9b8d]">easycut.co.kr/{partner.slug}</p><p className="mt-1 text-xs text-neutral-600">ID {partner.loginId}</p></td>
                  <td className="px-4 py-4"><span className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-black">{partner.status}</span><p className="mt-2 font-black">{(partner.commissionRateBps / 100).toFixed(2)}%</p></td>
                  <td className="px-4 py-4"><p>고유 {partner.uniqueVisitors.toLocaleString("ko-KR")}</p><p className="mt-1 text-xs text-neutral-500">가입 {partner.signups.toLocaleString("ko-KR")}</p></td>
                  <td className="px-4 py-4"><strong>{partner.paidCustomers.toLocaleString("ko-KR")}명</strong><p className="mt-1 text-xs text-neutral-500">{partner.signups ? (partner.paidCustomers / partner.signups * 100).toFixed(1) : "0.0"}%</p></td>
                  <td className="px-4 py-4"><strong>{money(partner.grossSalesKrw)}</strong><p className="mt-1 text-xs text-rose-300">환불 {money(partner.refundsKrw)}</p></td>
                  <td className="px-4 py-4"><strong>{money(partner.commissionKrw)}</strong><p className="mt-1 text-xs text-amber-200">대기 {money(partner.pendingKrw)}</p><p className={`mt-1 text-xs ${partner.availableKrw < 0 ? "text-rose-300" : "text-emerald-200"}`}>가능 {money(partner.availableKrw)}</p></td>
                  <td className="px-4 py-4"><p>{partner.bankName || "미등록"}</p><p className="mt-1 text-xs text-neutral-500">{partner.accountNumberLast4 ? `${partner.accountHolder} · ••••${partner.accountNumberLast4}` : "-"}</p></td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(partner)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-black">설정</button>
                      <button onClick={() => { setResetPartner(partner); setResetTemporaryPassword(""); }} disabled={submitting} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-black">비번 초기화</button>
                      <button onClick={() => { setPayoutPartner(partner); setRevealedAccount(null); }} disabled={!partner.accountNumberLast4 || partner.availableKrw <= 0} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-xs font-black text-emerald-200 disabled:opacity-30">정산</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!partners.length && <tr><td colSpan={8} className="px-5 py-14 text-center text-neutral-500">등록된 레퍼럴 파트너가 없습니다.</td></tr>}
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
            <div className="flex items-center justify-between"><h2 id="referral-payout-title" className="text-xl font-black">{payoutPartner.creatorName} 정산 생성</h2><button type="button" onClick={() => setPayoutPartner(null)}>닫기</button></div>
            <p className="mt-4 text-sm text-neutral-400">현재 정산 가능 {money(payoutPartner.availableKrw)} · 계좌 ••••{payoutPartner.accountNumberLast4}</p>
            <button type="button" onClick={() => revealAccount(payoutPartner)} className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs font-black">계좌 전체 확인</button>
            {revealedAccount && <p className="mt-3 rounded-xl bg-black/20 p-3 font-mono text-sm">{revealedAccount}</p>}
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-neutral-400">시작일<input required type="date" value={payoutPeriod.start} onChange={(event) => setPayoutPeriod((current) => ({ ...current, start: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3" /></label><label className="text-xs font-bold text-neutral-400">종료일<input required type="date" value={payoutPeriod.end} onChange={(event) => setPayoutPeriod((current) => ({ ...current, end: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3" /></label></div>
            <label className="mt-4 block text-xs font-bold text-neutral-400">메모<textarea value={payoutNote} onChange={(event) => setPayoutNote(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-white/10 bg-black/20 p-3" /></label>
            <button disabled={submitting} className="mt-6 h-11 rounded-xl bg-emerald-300 px-5 text-sm font-black text-black disabled:opacity-50">정산 생성</button>
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
