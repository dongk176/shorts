"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminSubscriptionStatus } from "@/lib/admin-subscription";

export type AdminMember = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  subscriptionId: string | null;
  planCode: string | null;
  billingCycle: string | null;
  subscriptionStatus: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextChargeAt: string | null;
  providerScheduleStatus: string | null;
  billingReviewStatus: string | null;
  billingReviewReason: string | null;
  paymentProvider: string | null;
  cardIssuer: string | null;
  cardNumberMasked: string | null;
};

const statusLabels: Record<string, string> = {
  pending: "결제 대기",
  trialing: "체험",
  active: "활성",
  past_due: "연체",
  canceled: "취소",
  expired: "만료",
  manual_review: "확인 필요",
  paused: "중지",
  none: "-",
};

const planLabels: Record<string, string> = {
  easycut_pro_v2: "이지컷 프로",
  starter_3m: "스타터 3개월",
  starter_6m: "스타터 6개월",
  starter_12m: "스타터 12개월",
  expert_3m: "전문가 3개월",
  expert_6m: "전문가 6개월",
  expert_12m: "전문가 12개월",
};

function planLabel(planCode: string | null) {
  return planCode ? planLabels[planCode] || planCode.toUpperCase() : "FREE";
}

function cycleLabel(planCode: string | null, cycle: string | null) {
  if (planCode?.startsWith("starter_") || planCode?.startsWith("expert_")) return "단건 패키지";
  if (cycle === "monthly") return "월간 자동결제";
  return cycle === "yearly" ? "기존 연간 상품" : "-";
}

function label(value: string | null) {
  return value ? statusLabels[value] || value : "구독 없음";
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value)) : "-";
}

function statusTone(status: string | null) {
  if (status === "active") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  if (status === "past_due" || status === "manual_review") return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (status === "canceled" || status === "expired") return "border-white/10 bg-white/[.04] text-neutral-400";
  return "border-sky-300/20 bg-sky-300/10 text-sky-100";
}

export function AdminMembersDashboard({
  members,
  initialQuery,
}: {
  members: AdminMember[];
  initialQuery: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminMember | null>(null);
  const [targetStatus, setTargetStatus] = useState<AdminSubscriptionStatus>("active");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openEditor = (member: AdminMember) => {
    setEditing(member);
    setTargetStatus(member.subscriptionStatus === "active" ? "past_due" : "active");
    setReason("");
    setMessage(null);
  };

  const submitChange = async () => {
    if (!editing?.subscriptionId || submitting) return;
    const statusText = label(targetStatus);
    if (!window.confirm(`${editing.email} 회원의 구독 상태를 '${statusText}' 상태로 변경하시겠습니까?`)) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/members/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          userId: editing.id,
          subscriptionId: editing.subscriptionId,
          targetStatus,
          reason,
        }),
      });
      const result = await response.json() as {
        detail?: string;
        requiresManualReview?: boolean;
        periodReset?: boolean;
      };
      if (!response.ok) throw new Error(result.detail || "구독 상태 변경에 실패했습니다.");
      setMessage([
        `${editing.email} 회원의 구독 상태를 '${statusText}' 상태로 변경했습니다.`,
        result.periodReset ? "새 이용기간도 오늘부터 다시 설정했습니다." : null,
        result.requiresManualReview ? "자동결제 수단은 별도 확인이 필요합니다." : null,
      ].filter(Boolean).join(" "));
      setEditing(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "구독 상태 변경에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-7">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">회원</h2>
              <p className="mt-1 text-xs text-neutral-500">최근 활동 회원 100명 · 구독 상태와 자동결제 상태를 함께 관리합니다.</p>
            </div>
            <form className="flex gap-2" method="get">
              <input type="hidden" name="tab" value="members" />
              <input
                name="q"
                defaultValue={initialQuery}
                placeholder="이메일·이름·회원 ID"
                className="h-10 w-64 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
              />
              <button className="h-10 rounded-xl bg-white px-4 text-sm font-black text-black transition hover:bg-neutral-200">조회</button>
            </form>
          </div>
        </div>

        {message && <p role="status" className="border-b border-white/10 bg-[#ff8c7c]/10 px-5 py-3 text-sm font-bold text-[#ffb4a8]">{message}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] text-left text-sm">
            <thead className="bg-black/20 text-xs text-neutral-500">
              <tr>
                <th className="px-5 py-3">회원</th>
                <th className="px-4 py-3">가입 / 최근 로그인</th>
                <th className="px-4 py-3">플랜</th>
                <th className="px-4 py-3">구독 상태</th>
                <th className="px-4 py-3">현재 이용기간</th>
                <th className="px-4 py-3">결제수단</th>
                <th className="px-4 py-3">자동결제</th>
                <th className="px-5 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[.06]">
              {members.map((member) => (
                <tr key={member.id} className="align-top hover:bg-white/[.02]">
                  <td className="px-5 py-4">
                    <p className="max-w-64 truncate font-bold text-neutral-100">{member.email}</p>
                    <p className="mt-1 text-xs text-neutral-500">{member.displayName || "이름 없음"}</p>
                    <p className="mt-1 font-mono text-[10px] text-neutral-700">{member.id}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-xs text-neutral-400">
                    <p>가입 {date(member.createdAt)}</p>
                    <p className="mt-1">로그인 {date(member.lastSignInAt)}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-black">{planLabel(member.planCode)}</p>
                    <p className="mt-1 text-xs text-neutral-500">{cycleLabel(member.planCode, member.billingCycle)}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${statusTone(member.subscriptionStatus)}`}>
                      {label(member.subscriptionStatus)}
                    </span>
                    {member.billingReviewStatus === "manual_review" && (
                      <p className="mt-2 max-w-44 text-xs text-amber-300" title={member.billingReviewReason || ""}>
                        결제 확인 필요
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-xs text-neutral-400">
                    <p>{date(member.currentPeriodStart)}</p>
                    <p className="mt-1">~ {date(member.currentPeriodEnd)}</p>
                    <p className="mt-1 text-neutral-600">다음 결제 {date(member.nextChargeAt)}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-bold">{member.cardIssuer || "-"}</p>
                    <p className="mt-1 font-mono text-xs text-neutral-500">{member.cardNumberMasked || "등록 카드 없음"}</p>
                    <p className="mt-1 text-xs text-neutral-600">{member.paymentProvider || "-"}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(member.providerScheduleStatus)}`}>
                      {label(member.providerScheduleStatus)}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      disabled={!member.subscriptionId}
                      onClick={() => openEditor(member)}
                      className="rounded-lg border border-[#ff8c7c]/40 px-3 py-2 text-xs font-black text-[#ff9b8d] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-neutral-700"
                    >
                      {member.subscriptionId ? "상태 변경" : "구독 없음"}
                    </button>
                  </td>
                </tr>
              ))}
              {!members.length && (
                <tr><td colSpan={8} className="px-5 py-16 text-center text-neutral-500">조건에 맞는 회원이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="member-status-title">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#191c1d] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.18em] text-[#ff9585]">Member subscription</p>
                <h3 id="member-status-title" className="mt-2 text-xl font-black">구독 상태 변경</h3>
              </div>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-neutral-400 hover:bg-white/[.06]">닫기</button>
            </div>

            <dl className="mt-5 grid grid-cols-[100px_1fr] gap-2 rounded-2xl bg-black/20 p-4 text-sm">
              <dt className="text-neutral-500">회원</dt><dd className="font-bold">{editing.email}</dd>
              <dt className="text-neutral-500">현재 상품</dt><dd className="font-bold">{planLabel(editing.planCode)} · {cycleLabel(editing.planCode, editing.billingCycle)}</dd>
              <dt className="text-neutral-500">현재 상태</dt><dd className="font-bold">{label(editing.subscriptionStatus)}</dd>
              <dt className="text-neutral-500">자동결제</dt><dd className="font-bold">{label(editing.providerScheduleStatus)}</dd>
            </dl>

            <label className="mt-5 block text-sm font-bold">
              변경할 상태
              <select
                value={targetStatus}
                onChange={(event) => setTargetStatus(event.target.value as AdminSubscriptionStatus)}
                className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#151819] px-4 outline-none focus:border-[#ff8c7c]"
              >
                <option value="active">활성</option>
                <option value="past_due">연체</option>
                <option value="canceled">취소</option>
                <option value="expired">만료</option>
              </select>
            </label>
            <label className="mt-4 block text-sm font-bold">
              변경 사유
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                rows={4}
                placeholder="결제 확인 완료, 고객 요청, 운영 보정 등 구체적인 사유"
                className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-4 outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
              />
            </label>

            <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[.07] p-4 text-xs leading-5 text-amber-100/80">
              <p>
                {targetStatus === "active"
                  ? editing.billingCycle === "monthly"
                    ? "활성으로 바꾸면 월간 더페이원 카드의 자동결제를 다시 사용 상태로 전환합니다. 이용기간이 이미 끝났다면 오늘부터 새 결제기간과 기본 처리시간을 부여하지만 즉시 카드 승인은 발생하지 않습니다."
                    : "활성으로 바꾸면 패키지 이용 권한을 다시 엽니다. 기간 패키지는 자동결제를 사용하지 않습니다."
                  : targetStatus === "past_due"
                    ? "연체로 바꾸면 월간 자동결제를 중지하고 기본 처리시간 사용을 막습니다. 추가 처리시간은 만료 전까지 보존됩니다."
                    : "취소·만료로 바꾸면 월간 자동결제를 중지하고 해당 구독의 남은 기본·추가 처리시간을 회수합니다."}
              </p>
              <p className="mt-2 font-black text-amber-100">구독 상태 변경은 카드 환불을 실행하지 않습니다. 환불은 결제 탭에서 별도로 처리해야 합니다.</p>
            </div>

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setEditing(null)} className="h-12 flex-1 rounded-xl border border-white/10 font-bold">취소</button>
              <button
                type="button"
                disabled={submitting || targetStatus === editing.subscriptionStatus || reason.trim().length < 2}
                onClick={() => void submitChange()}
                className="h-12 flex-1 rounded-xl bg-[#ff806f] font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "변경 중..." : "상태 변경"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
