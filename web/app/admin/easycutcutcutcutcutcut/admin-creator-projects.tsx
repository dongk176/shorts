"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { AdminCreatorProjectShare } from "@/lib/creator-project-shares";
import {
  issueCreatorProjectShare,
  revokeCreatorProjectShare,
} from "./creator-project-actions";

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return "0.0%";
  return `${(numerator / denominator * 100).toFixed(1)}%`;
}

const statusCopy = {
  active: { label: "활성", className: "bg-emerald-300/10 text-emerald-200" },
  expired: { label: "만료", className: "bg-neutral-300/10 text-neutral-300" },
  revoked: { label: "취소", className: "bg-red-300/10 text-red-200" },
  unavailable: { label: "사용 불가", className: "bg-amber-300/10 text-amber-100" },
} as const;

export function AdminCreatorProjects({
  shares,
}: {
  shares: AdminCreatorProjectShare[];
}) {
  const router = useRouter();
  const [projectNumber, setProjectNumber] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [generatedLink, setGeneratedLink] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);

  const issue = async (input: {
    projectNumber: number;
    recipientName: string;
    rightsConfirmed: boolean;
  }, key: string) => {
    setPendingKey(key);
    setMessage("");
    try {
      const result = await issueCreatorProjectShare(input);
      setGeneratedLink({
        url: `${window.location.origin}${result.path}`,
        expiresAt: result.expiresAt,
      });
      setMessage("전용 링크를 발급했습니다. 이 화면을 닫기 전에 링크를 복사해 주세요.");
      router.refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "전용 링크를 발급하지 못했습니다.");
      return false;
    } finally {
      setPendingKey(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const number = Number(projectNumber);
    if (!Number.isSafeInteger(number) || number <= 0) {
      setMessage("올바른 프로젝트 번호를 입력해 주세요.");
      return;
    }
    const succeeded = await issue({
      projectNumber: number,
      recipientName,
      rightsConfirmed,
    }, "new");
    if (succeeded) {
      setProjectNumber("");
      setRecipientName("");
      setRightsConfirmed(false);
    }
  };

  const copyLink = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink.url);
      setMessage("전용 링크를 복사했습니다.");
    } catch {
      setMessage("자동 복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.");
    }
  };

  const revoke = async (share: AdminCreatorProjectShare) => {
    if (!window.confirm(`${share.recipientName}님의 전용 링크를 즉시 만료할까요?`)) return;
    setPendingKey(`revoke:${share.id}`);
    setMessage("");
    try {
      await revokeCreatorProjectShare(share.id);
      setMessage("전용 링크를 만료했습니다.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "링크를 만료하지 못했습니다.");
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5 sm:p-7">
        <div>
          <p className="text-xs font-black uppercase tracking-[.17em] text-[#ff9b8d]">Creator outreach</p>
          <h2 className="mt-2 text-xl font-black text-white">크리에이터 전용 프로젝트 발급</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
            기존 방식으로 완성하고 검수한 내 프로젝트만 7일짜리 읽기 전용 링크로 승격합니다.
          </p>
        </div>

        <form className="mt-7 grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_auto] lg:items-end" onSubmit={submit}>
          <label className="grid gap-2 text-xs font-bold text-neutral-300">
            프로젝트 번호
            <input
              inputMode="numeric"
              value={projectNumber}
              onChange={(event) => setProjectNumber(event.target.value.replace(/\D/g, ""))}
              required
              className="h-12 rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8f7f]/60"
              placeholder="예: 123"
            />
          </label>
          <label className="grid gap-2 text-xs font-bold text-neutral-300">
            크리에이터 이름
            <input
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              minLength={1}
              maxLength={100}
              required
              className="h-12 rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8f7f]/60"
              placeholder="전용 페이지에 표시할 이름"
            />
          </label>
          <button
            type="submit"
            disabled={pendingKey !== null || !rightsConfirmed}
            className="h-12 rounded-xl bg-[#ff715e] px-6 text-sm font-black text-white transition hover:bg-[#ff806f] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {pendingKey === "new" ? "발급 중..." : "전용 링크 발급"}
          </button>
          <label className="flex items-start gap-3 text-xs leading-5 text-neutral-400 lg:col-span-3">
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => setRightsConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#ff715e]"
            />
            이 프로젝트의 영상을 크리에이터에게 공개 링크로 제공할 권한 또는 허락을 확인했습니다.
          </label>
        </form>

        {generatedLink ? (
          <div className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-300/[.055] p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                readOnly
                value={generatedLink.url}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="발급된 크리에이터 전용 링크"
                className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-emerald-100 outline-none"
              />
              <button type="button" onClick={() => void copyLink()} className="h-11 rounded-xl bg-white px-5 text-xs font-black text-black">
                링크 복사
              </button>
              <a href={generatedLink.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center rounded-xl border border-white/15 px-5 text-xs font-black text-white">
                새 탭에서 확인
              </a>
            </div>
            <p className="mt-3 text-xs text-emerald-100/70">{date(generatedLink.expiresAt)} 만료 · 새로고침 후에는 보안상 원문 링크를 다시 표시하지 않습니다.</p>
          </div>
        ) : null}
        {message ? <p className="mt-5 text-sm text-neutral-200" role="status">{message}</p> : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5 sm:p-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-white">크리에이터 프로젝트 목록</h2>
            <p className="mt-2 text-sm text-neutral-400">최근 발급 순 · 최대 200개</p>
          </div>
          <span className="text-sm font-bold text-neutral-500">{shares.length.toLocaleString("ko-KR")}개</span>
        </div>

        {shares.length ? (
          <div className="mt-6 grid gap-4">
            {shares.map((share) => {
              const status = statusCopy[share.status];
              return (
                <article key={share.id} className="rounded-2xl border border-white/10 bg-black/15 p-5">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${status.className}`}>{status.label}</span>
                        <span className="text-xs font-black text-[#ff9b8d]">프로젝트 /{share.projectNumber}</span>
                      </div>
                      <h3 className="mt-3 truncate text-base font-black text-white">{share.recipientName}님 · {share.videoTitle}</h3>
                      <p className="mt-2 text-xs text-neutral-500">발급 {date(share.issuedAt)} · 만료 {date(share.expiresAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pendingKey !== null}
                        onClick={() => void issue({
                          projectNumber: share.projectNumber,
                          recipientName: share.recipientName,
                          rightsConfirmed: true,
                        }, `reissue:${share.id}`)}
                        className="min-h-10 rounded-xl border border-white/15 px-4 text-xs font-black text-white transition hover:bg-white/[.06] disabled:opacity-45"
                      >
                        {pendingKey === `reissue:${share.id}` ? "재발급 중..." : "링크 재발급"}
                      </button>
                      {share.status === "active" ? (
                        <button
                          type="button"
                          disabled={pendingKey !== null}
                          onClick={() => void revoke(share)}
                          className="min-h-10 rounded-xl border border-red-300/20 px-4 text-xs font-black text-red-200 transition hover:bg-red-300/[.06] disabled:opacity-45"
                        >
                          {pendingKey === `revoke:${share.id}` ? "만료 중..." : "즉시 만료"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                    <Metric label="총 방문" value={`${share.totalViews.toLocaleString("ko-KR")}회`} />
                    <Metric label="순 방문자" value={`${share.uniqueVisitors.toLocaleString("ko-KR")}명`} />
                    <Metric label="CTA 클릭" value={`${share.totalCtaClicks.toLocaleString("ko-KR")}회`} />
                    <Metric label="CTA 방문자" value={`${share.uniqueCtaVisitors.toLocaleString("ko-KR")}명`} />
                    <Metric label="신규 가입" value={`${share.signupConversions.toLocaleString("ko-KR")}명`} accent />
                    <Metric label="방문→가입" value={percent(share.signupConversions, share.uniqueVisitors)} />
                    <Metric label="CTA→가입" value={percent(share.signupConversions, share.uniqueCtaVisitors)} />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center text-sm text-neutral-500">
            아직 발급한 크리에이터 전용 프로젝트가 없습니다.
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-3">
      <p className="text-[11px] font-bold text-neutral-500">{label}</p>
      <strong className={`mt-1 block text-sm font-black ${accent ? "text-emerald-300" : "text-neutral-100"}`}>{value}</strong>
    </div>
  );
}
