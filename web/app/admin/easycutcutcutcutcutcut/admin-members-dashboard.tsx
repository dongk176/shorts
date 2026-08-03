"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ADMIN_USAGE_GRANT_MAX_MINUTES,
  ADMIN_USAGE_GRANT_VALIDITY_DAYS,
} from "@/lib/admin-usage-grant";
import { usageMinutes } from "@/lib/admin-member-usage";
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
  projectCount: number;
  shortCount: number;
  usageLimitSeconds: number;
  usageConsumedSeconds: number;
  usageReservedSeconds: number;
  usageRemainingSeconds: number;
  referralPartnerId: string | null;
  referralCreatorName: string | null;
  referralSlug: string | null;
};

type AdminMemberSearchResult = {
  id: string;
  email: string;
  displayName: string | null;
  usageRemainingSeconds: number;
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
  totalCount,
  initialHasMore,
  initialNextOffset,
  referralOptions,
  initialFilters,
}: {
  members: AdminMember[];
  totalCount: number;
  initialHasMore: boolean;
  initialNextOffset: number;
  referralOptions: Array<{ id: string; creatorName: string; slug: string }>;
  initialFilters: {
    query: string;
    memberType: string;
    memberPlan: string;
    memberActivity: string;
    memberReferrer: string;
  };
}) {
  const router = useRouter();
  const [loadedMembers, setLoadedMembers] = useState(members);
  const [hasMoreMembers, setHasMoreMembers] = useState(initialHasMore);
  const [nextMemberOffset, setNextMemberOffset] = useState(initialNextOffset);
  const [loadingMoreMembers, setLoadingMoreMembers] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminMember | null>(null);
  const [targetStatus, setTargetStatus] = useState<AdminSubscriptionStatus>("active");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [referralEditing, setReferralEditing] = useState<AdminMember | null>(null);
  const [targetReferralPartnerId, setTargetReferralPartnerId] = useState("");
  const [referralReason, setReferralReason] = useState("");
  const [usageGrantOpen, setUsageGrantOpen] = useState(false);
  const [usageSearchQuery, setUsageSearchQuery] = useState("");
  const [usageSearching, setUsageSearching] = useState(false);
  const [usageSearchAttempted, setUsageSearchAttempted] = useState(false);
  const [usageSearchResults, setUsageSearchResults] = useState<AdminMemberSearchResult[]>([]);
  const [usageGrantMember, setUsageGrantMember] = useState<AdminMemberSearchResult | null>(null);
  const [usageGrantMinutes, setUsageGrantMinutes] = useState("60");
  const [usageGrantReason, setUsageGrantReason] = useState("");
  const usageGrantRequestId = useRef<string | null>(null);

  useEffect(() => {
    setLoadedMembers(members);
    setHasMoreMembers(initialHasMore);
    setNextMemberOffset(initialNextOffset);
    setLoadMoreError(null);
  }, [initialHasMore, initialNextOffset, members]);

  const loadMoreMembers = async () => {
    if (loadingMoreMembers || !hasMoreMembers) return;
    setLoadingMoreMembers(true);
    setLoadMoreError(null);
    try {
      const params = new URLSearchParams({
        offset: String(nextMemberOffset),
        memberType: initialFilters.memberType,
        memberPlan: initialFilters.memberPlan,
        memberActivity: initialFilters.memberActivity,
        memberReferrer: initialFilters.memberReferrer,
      });
      if (initialFilters.query) params.set("q", initialFilters.query);
      const response = await fetch(`/api/admin/members?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = await response.json() as {
        members?: AdminMember[];
        hasMore?: boolean;
        nextOffset?: number;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(result.detail || "회원을 더 불러오지 못했습니다.");
      }
      const appendedMembers = result.members || [];
      setLoadedMembers((current) => {
        const knownIds = new Set(current.map((member) => member.id));
        return current.concat(appendedMembers.filter((member) => !knownIds.has(member.id)));
      });
      setHasMoreMembers(Boolean(result.hasMore));
      setNextMemberOffset(Number(result.nextOffset || nextMemberOffset));
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : "회원을 더 불러오지 못했습니다.");
    } finally {
      setLoadingMoreMembers(false);
    }
  };

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

  const openReferralEditor = (member: AdminMember) => {
    setReferralEditing(member);
    setTargetReferralPartnerId(member.referralPartnerId || "");
    setReferralReason("");
    setMessage(null);
  };

  const submitReferralChange = async () => {
    if (!referralEditing || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/referrals/attributions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          userId: referralEditing.id,
          partnerId: targetReferralPartnerId || null,
          reason: referralReason,
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "추천인을 변경하지 못했습니다.");
      setReferralEditing(null);
      setMessage(`${referralEditing.email} 회원의 추천인을 변경했습니다. 과거 수익은 소급 변경되지 않습니다.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "추천인을 변경하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const openUsageGrant = () => {
    setUsageGrantOpen(true);
    setUsageSearchQuery("");
    setUsageSearchAttempted(false);
    setUsageSearchResults([]);
    setUsageGrantMember(null);
    setUsageGrantMinutes("60");
    setUsageGrantReason("");
    usageGrantRequestId.current = null;
    setMessage(null);
  };

  const closeUsageGrant = () => {
    if (submitting) return;
    setUsageGrantOpen(false);
    setMessage(null);
  };

  const searchUsageMembers = async () => {
    const query = usageSearchQuery.trim();
    if (query.length < 2 || usageSearching) return;
    setUsageSearching(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/members/search?q=${encodeURIComponent(query)}`,
        { credentials: "same-origin" },
      );
      const result = await response.json() as {
        results?: AdminMemberSearchResult[];
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(result.detail || "회원 검색에 실패했습니다.");
      }
      setUsageSearchAttempted(true);
      setUsageSearchResults(result.results || []);
      setUsageGrantMember(null);
      usageGrantRequestId.current = null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "회원 검색에 실패했습니다.");
    } finally {
      setUsageSearching(false);
    }
  };

  const selectUsageGrantMember = (member: AdminMemberSearchResult) => {
    setUsageGrantMember(member);
    usageGrantRequestId.current = null;
  };

  const submitUsageGrant = async () => {
    if (!usageGrantMember || submitting) return;
    const minutes = Number(usageGrantMinutes);
    if (!Number.isSafeInteger(minutes)
      || minutes < 1
      || minutes > ADMIN_USAGE_GRANT_MAX_MINUTES) {
      setMessage(`사용량은 1분부터 ${ADMIN_USAGE_GRANT_MAX_MINUTES.toLocaleString("ko-KR")}분까지 입력해 주세요.`);
      return;
    }
    if (!window.confirm(
      `${usageGrantMember.email} 회원에게 사용량 ${minutes.toLocaleString("ko-KR")}분을 지급하시겠습니까?`,
    )) return;

    setSubmitting(true);
    setMessage(null);
    usageGrantRequestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/admin/members/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: usageGrantRequestId.current,
          userId: usageGrantMember.id,
          minutes,
          reason: usageGrantReason,
        }),
      });
      const result = await response.json() as {
        detail?: string;
        alreadyProcessed?: boolean;
      };
      if (!response.ok) {
        throw new Error(result.detail || "사용량을 추가하지 못했습니다.");
      }
      setUsageGrantOpen(false);
      setMessage(
        `${usageGrantMember.email} 회원에게 사용량 ${minutes.toLocaleString("ko-KR")}분을 `
        + `${result.alreadyProcessed ? "이미 지급했습니다." : "지급했습니다."}`,
      );
      usageGrantRequestId.current = null;
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사용량을 추가하지 못했습니다.");
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
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black">회원</h2>
                <span className="rounded-full border border-[#ff8c7c]/25 bg-[#ff8c7c]/10 px-2.5 py-1 text-xs font-black text-[#ffb4a8]">
                  필터 결과 총 {totalCount.toLocaleString("ko-KR")}명
                </span>
                <button
                  type="button"
                  onClick={openUsageGrant}
                  className="rounded-lg bg-[#ff806f] px-3 py-2 text-xs font-black text-white transition hover:bg-[#ff6f5c]"
                >
                  사용량 추가
                </button>
              </div>
              <p className="mt-1 text-xs text-neutral-500">100명씩 불러오며 구독 상태와 자동결제 상태를 함께 관리합니다.</p>
            </div>
            <form className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:grid-cols-[220px_150px_150px_150px_180px_auto]" method="get">
              <input type="hidden" name="tab" value="members" />
              <input
                name="q"
                defaultValue={initialFilters.query}
                placeholder="이메일·이름·회원 ID"
                className="h-10 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
              />
              <select
                name="memberType"
                defaultValue={initialFilters.memberType}
                aria-label="회원 결제 상태"
                className="h-10 rounded-xl border border-white/10 bg-[#151819] px-3 text-sm outline-none focus:border-[#ff8c7c]"
              >
                <option value="all">전체 회원</option>
                <option value="free">무료 회원</option>
                <option value="paid_active">활성 유료</option>
                <option value="paid_attention">결제 확인 필요</option>
                <option value="paid_inactive">종료 유료</option>
              </select>
              <select
                name="memberPlan"
                defaultValue={initialFilters.memberPlan}
                aria-label="회원 상품군"
                className="h-10 rounded-xl border border-white/10 bg-[#151819] px-3 text-sm outline-none focus:border-[#ff8c7c]"
              >
                <option value="all">전체 상품</option>
                <option value="monthly">월간 자동결제</option>
                <option value="starter">스타터 패키지</option>
                <option value="expert">전문가 패키지</option>
              </select>
              <select
                name="memberActivity"
                defaultValue={initialFilters.memberActivity}
                aria-label="회원 생성 활동"
                className="h-10 rounded-xl border border-white/10 bg-[#151819] px-3 text-sm outline-none focus:border-[#ff8c7c]"
              >
                <option value="all">전체 활동</option>
                <option value="with_projects">프로젝트 생성</option>
                <option value="with_shorts">쇼츠 생성</option>
                <option value="no_projects">미생성 회원</option>
              </select>
              <select
                name="memberReferrer"
                defaultValue={initialFilters.memberReferrer}
                aria-label="추천인"
                className="h-10 rounded-xl border border-white/10 bg-[#151819] px-3 text-sm outline-none focus:border-[#ff8c7c]"
              >
                <option value="all">전체 추천인</option>
                <option value="referred">추천인 있음</option>
                <option value="none">추천인 없음</option>
                {referralOptions.map((partner) => (
                  <option key={partner.id} value={partner.id}>{partner.creatorName} · {partner.slug}</option>
                ))}
              </select>
              <button className="h-10 rounded-xl bg-white px-4 text-sm font-black text-black transition hover:bg-neutral-200">조회</button>
            </form>
          </div>
        </div>

        {message && <p role="status" className="border-b border-white/10 bg-[#ff8c7c]/10 px-5 py-3 text-sm font-bold text-[#ffb4a8]">{message}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1660px] text-left text-sm">
            <thead className="bg-black/20 text-xs text-neutral-500">
              <tr>
                <th className="px-5 py-3">회원</th>
                <th className="px-4 py-3">사용량</th>
                <th className="px-4 py-3">가입 / 최근 로그인</th>
                <th className="px-4 py-3">플랜</th>
                <th className="px-4 py-3">생성 수</th>
                <th className="px-4 py-3">추천인</th>
                <th className="px-4 py-3">구독 상태</th>
                <th className="px-4 py-3">현재 이용기간</th>
                <th className="px-4 py-3">결제수단</th>
                <th className="px-4 py-3">자동결제</th>
                <th className="px-5 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[.06]">
              {loadedMembers.map((member) => (
                <tr key={member.id} className="align-top hover:bg-white/[.02]">
                  <td className="px-5 py-4">
                    <p className="max-w-64 truncate font-bold text-neutral-100">{member.email}</p>
                    <p className="mt-1 text-xs text-neutral-500">{member.displayName || "이름 없음"}</p>
                    <p className="mt-1 font-mono text-[10px] text-neutral-700">{member.id}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 tabular-nums">
                    <p className={`font-black ${
                      member.usageRemainingSeconds > 0 ? "text-emerald-200" : "text-neutral-500"
                    }`}>
                      잔여 {usageMinutes(member.usageRemainingSeconds)}분
                    </p>
                    <p className="mt-1 text-xs text-neutral-400">
                      사용 {usageMinutes(member.usageConsumedSeconds)}분
                      {" · "}
                      예약 {usageMinutes(member.usageReservedSeconds)}분
                    </p>
                    <p className="mt-1 text-[11px] text-neutral-600">
                      총 {usageMinutes(member.usageLimitSeconds)}분
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-xs text-neutral-400">
                    <p>가입 {date(member.createdAt)}</p>
                    <p className="mt-1">로그인 {date(member.lastSignInAt)}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-black">{planLabel(member.planCode)}</p>
                    <p className="mt-1 text-xs text-neutral-500">{cycleLabel(member.planCode, member.billingCycle)}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <p className="font-black text-neutral-100">프로젝트 {member.projectCount.toLocaleString("ko-KR")}개</p>
                    <p className="mt-1 text-xs font-bold text-[#ff9b8d]">쇼츠 {member.shortCount.toLocaleString("ko-KR")}개</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-bold">{member.referralCreatorName || "없음"}</p>
                    <p className="mt-1 text-xs text-neutral-500">{member.referralSlug ? `/${member.referralSlug}` : "자동 귀속 없음"}</p>
                    <button
                      type="button"
                      onClick={() => openReferralEditor(member)}
                      className="mt-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-black"
                    >
                      추천인 변경
                    </button>
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
              {!loadedMembers.length && (
                <tr><td colSpan={11} className="px-5 py-16 text-center text-neutral-500">조건에 맞는 회원이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {(hasMoreMembers || loadMoreError) && (
          <div className="border-t border-white/10 px-5 py-4 text-center">
            {loadMoreError && (
              <p role="alert" className="mb-3 text-sm font-bold text-[#ff9b8d]">
                {loadMoreError}
              </p>
            )}
            {hasMoreMembers && (
              <button
                type="button"
                disabled={loadingMoreMembers}
                onClick={() => void loadMoreMembers()}
                className="min-h-11 rounded-xl border border-white/15 bg-white/[.04] px-6 text-sm font-black text-white transition hover:bg-white/[.08] disabled:cursor-wait disabled:opacity-50"
              >
                {loadingMoreMembers ? "불러오는 중…" : "더보기"}
              </button>
            )}
          </div>
        )}
      </section>

      {usageGrantOpen && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="member-usage-grant-title"
        >
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#191c1d] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.18em] text-[#ff9585]">
                  Member usage grant
                </p>
                <h3 id="member-usage-grant-title" className="mt-2 text-xl font-black">
                  사용량 추가
                </h3>
                <p className="mt-2 text-sm text-neutral-400">
                  이메일이나 이름으로 회원을 검색한 뒤 지급할 사용량을 입력하세요.
                </p>
              </div>
              <button
                type="button"
                onClick={closeUsageGrant}
                className="rounded-lg px-3 py-2 text-neutral-400 hover:bg-white/[.06]"
              >
                닫기
              </button>
            </div>

            {message && (
              <p
                role="status"
                className="mt-4 rounded-xl border border-[#ff8c7c]/20 bg-[#ff8c7c]/10 px-4 py-3 text-sm font-bold text-[#ffb4a8]"
              >
                {message}
              </p>
            )}

            <form
              className="mt-5 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void searchUsageMembers();
              }}
            >
              <input
                value={usageSearchQuery}
                onChange={(event) => {
                  setUsageSearchQuery(event.target.value);
                  setUsageSearchAttempted(false);
                  setUsageSearchResults([]);
                  setUsageGrantMember(null);
                  usageGrantRequestId.current = null;
                }}
                minLength={2}
                maxLength={100}
                placeholder="이메일 또는 이름을 2자 이상 입력"
                aria-label="사용량을 지급할 회원 검색"
                className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
              />
              <button
                type="submit"
                disabled={usageSearching || usageSearchQuery.trim().length < 2}
                className="h-11 rounded-xl bg-white px-5 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {usageSearching ? "검색 중..." : "검색"}
              </button>
            </form>

            {usageSearchResults.length > 0 && (
              <div className="mt-3 max-h-60 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-black/15 p-2">
                {usageSearchResults.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => selectUsageGrantMember(member)}
                    aria-pressed={usageGrantMember?.id === member.id}
                    className={`flex w-full items-center justify-between gap-4 rounded-xl border p-3 text-left transition ${
                      usageGrantMember?.id === member.id
                        ? "border-[#ff8c7c]/70 bg-[#ff8c7c]/10"
                        : "border-transparent hover:border-white/10 hover:bg-white/[.04]"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-neutral-100">
                        {member.displayName || "이름 없음"}
                      </span>
                      <span className="mt-1 block truncate text-xs text-neutral-500">
                        {member.email}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-bold text-emerald-200">
                      잔여 {usageMinutes(member.usageRemainingSeconds)}분
                    </span>
                  </button>
                ))}
              </div>
            )}
            {!usageSearching
              && usageSearchAttempted
              && usageSearchResults.length === 0 && (
              <p className="mt-4 rounded-xl bg-black/20 px-4 py-5 text-center text-sm text-neutral-500">
                검색 결과가 없습니다.
              </p>
            )}

            {usageGrantMember && (
              <div className="mt-5 rounded-2xl border border-[#ff8c7c]/20 bg-[#ff8c7c]/[.06] p-4">
                <p className="text-xs font-bold text-[#ffb4a8]">선택한 회원</p>
                <p className="mt-2 font-black">{usageGrantMember.displayName || "이름 없음"}</p>
                <p className="mt-1 text-sm text-neutral-400">{usageGrantMember.email}</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-bold">
                    지급 사용량 (분)
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={ADMIN_USAGE_GRANT_MAX_MINUTES}
                      step={1}
                      value={usageGrantMinutes}
                      onChange={(event) => {
                        setUsageGrantMinutes(event.target.value);
                        usageGrantRequestId.current = null;
                      }}
                      className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-lg font-black outline-none focus:border-[#ff8c7c]"
                    />
                  </label>
                  <label className="block text-sm font-bold">
                    지급 사유 (선택)
                    <input
                      value={usageGrantReason}
                      onChange={(event) => {
                        setUsageGrantReason(event.target.value);
                        usageGrantRequestId.current = null;
                      }}
                      maxLength={500}
                      placeholder="고객 보상, 운영 보정 등"
                      className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
                    />
                  </label>
                </div>
                <p className="mt-3 text-xs leading-5 text-neutral-500">
                  지급분은 즉시 사용할 수 있고 지급일로부터 {ADMIN_USAGE_GRANT_VALIDITY_DAYS}일 후 만료됩니다.
                  관리자 감사 로그에 회원, 수량, 사유가 기록됩니다.
                </p>
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={closeUsageGrant}
                className="h-12 flex-1 rounded-xl border border-white/10 font-bold"
              >
                취소
              </button>
              <button
                type="button"
                disabled={!usageGrantMember || submitting}
                onClick={() => void submitUsageGrant()}
                className="h-12 flex-1 rounded-xl bg-[#ff806f] font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "지급 중..." : "사용량 지급"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {referralEditing && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="member-referral-title">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#191c1d] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.18em] text-[#ff9585]">Referral attribution</p>
                <h3 id="member-referral-title" className="mt-2 text-xl font-black">추천인 예외 변경</h3>
              </div>
              <button type="button" onClick={() => setReferralEditing(null)} className="rounded-lg px-3 py-2 text-neutral-400 hover:bg-white/[.06]">닫기</button>
            </div>
            <p className="mt-4 text-sm text-neutral-400">{referralEditing.email}</p>
            <label className="mt-5 block text-xs font-bold text-neutral-400">
              추천인
              <select
                value={targetReferralPartnerId}
                onChange={(event) => setTargetReferralPartnerId(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#191c1d] px-3 outline-none"
              >
                <option value="">추천인 없음</option>
                {referralOptions.map((partner) => (
                  <option key={partner.id} value={partner.id}>{partner.creatorName} · {partner.slug}</option>
                ))}
              </select>
            </label>
            <label className="mt-4 block text-xs font-bold text-neutral-400">
              변경 사유
              <textarea
                required
                minLength={2}
                maxLength={500}
                value={referralReason}
                onChange={(event) => setReferralReason(event.target.value)}
                className="mt-2 min-h-24 w-full rounded-xl border border-white/10 bg-black/20 p-3 outline-none"
              />
            </label>
            <p className="mt-3 text-xs leading-5 text-amber-200">변경 시점 이후 결제에만 새 추천인이 적용되며 과거 수익 원장은 변경되지 않습니다.</p>
            <button
              type="button"
              disabled={submitting || referralReason.trim().length < 2}
              onClick={submitReferralChange}
              className="mt-5 h-11 rounded-xl bg-white px-5 text-sm font-black text-black disabled:opacity-50"
            >
              추천인 변경
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
