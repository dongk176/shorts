"use client";

import { useState, useTransition } from "react";
import {
  type FileUploadReleaseMode,
  updateFileUploadReleaseMode,
} from "./file-upload-release-actions";

export type FileUploadReleaseCheck = {
  key: string;
  passed: boolean;
  verifiedAt: string | null;
};

const labels: Record<FileUploadReleaseMode, string> = {
  stopped: "중지",
  admin_test: "어드민 테스트",
  public: "전체 공개",
  emergency_stop: "긴급 전체 중단",
};

const checkLabels: Record<string, string> = {
  admin_end_to_end: "어드민 완주",
  render_parity: "링크·업로드 렌더 일치",
  upload_1gb: "1GB 업로드",
  upload_5gb: "5GB 업로드",
  source_cleanup: "원본 완전 삭제",
  usage_integrity: "사용량 정합성",
  runtime_identity: "웹·워커 릴리스 일치",
  no_proxy_environment: "프록시·YouTube 환경 없음",
  no_stuck_sessions: "막힌 세션·고아 작업 없음",
};

export function AdminFileUploadRelease({
  initialMode,
  environmentEnabled,
  checks,
  activeSessions,
  stuckSessions,
  orphanedReservations,
}: {
  initialMode: FileUploadReleaseMode;
  environmentEnabled: boolean;
  checks: FileUploadReleaseCheck[];
  activeSessions: number;
  stuckSessions: number;
  orphanedReservations: number;
}) {
  const [mode, setMode] = useState(initialMode);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const checksPassed = checks.length === 9 && checks.every((check) => (
    check.passed
    && check.verifiedAt
    && Date.now() - new Date(check.verifiedAt).getTime() <= 24 * 60 * 60 * 1_000
  ));

  const change = (next: FileUploadReleaseMode) => {
    if (pending || next === mode) return;
    if (next === "public" && !checksPassed) {
      setMessage("전체 공개 전 자동 검증 항목을 모두 통과해야 합니다.");
      return;
    }
    startTransition(async () => {
      setMessage("");
      try {
        const result = await updateFileUploadReleaseMode(next);
        setMode(result.mode);
        setMessage(`${labels[result.mode]} 상태로 변경했습니다.`);
      } catch (error) {
        setMessage(error instanceof Error
          ? error.message
          : "파일 업로드 공개 상태를 변경하지 못했습니다.");
      }
    });
  };

  return (
    <section className="mt-7 rounded-2xl border border-white/10 bg-[#151819] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff9585]">File upload release</p>
          <h2 className="mt-2 text-xl font-black text-white">파일 업로드 공개 관리</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
            링크 생성과 같은 렌더 릴리스가 확인된 업로드만 허용합니다. 전체 공개는 최근 24시간 검증을 모두 통과해야 합니다.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-black ${
          mode === "public"
            ? "bg-emerald-300/10 text-emerald-200"
            : mode === "emergency_stop"
              ? "bg-red-300/10 text-red-200"
              : "bg-amber-300/10 text-amber-100"
        }`}>{labels[mode]}</span>
      </div>

      {!environmentEnabled ? (
        <p className="mt-5 rounded-xl border border-red-300/20 bg-red-300/[.07] px-4 py-3 text-sm text-red-100">
          배포 환경의 파일 업로드 강제 중지 설정이 켜져 있습니다.
        </p>
      ) : null}

      <div className="mt-6 grid gap-2 sm:grid-cols-4">
        {(["stopped", "admin_test", "public", "emergency_stop"] as const).map((item) => (
          <button
            key={item}
            type="button"
            disabled={pending || item === mode || (item === "public" && !checksPassed)}
            onClick={() => change(item)}
            className={`min-h-11 rounded-xl border px-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${
              item === "emergency_stop"
                ? "border-red-400/30 text-red-200 hover:bg-red-400/10"
                : item === mode
                  ? "border-[#ff715e]/60 bg-[#ff715e]/15 text-white"
                  : "border-white/10 text-neutral-200 hover:border-white/25 hover:bg-white/[.04]"
            }`}
          >{labels[item]}</button>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-neutral-500">진행 중 세션</p><strong className="mt-1 block text-xl text-white">{activeSessions}</strong></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-neutral-500">막힌 세션</p><strong className="mt-1 block text-xl text-white">{stuckSessions}</strong></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-neutral-500">미정리 사용량</p><strong className="mt-1 block text-xl text-white">{orphanedReservations}</strong></div>
      </div>

      <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {checks.map((check) => (
          <div key={check.key} className="rounded-xl border border-white/10 bg-black/15 px-4 py-3 text-xs">
            <span className={check.passed ? "text-emerald-200" : "text-neutral-500"}>
              {check.passed ? "통과" : "대기"} · {checkLabels[check.key] || check.key}
            </span>
          </div>
        ))}
      </div>
      {message ? <p className="mt-5 text-sm text-neutral-200" role="status">{message}</p> : null}
    </section>
  );
}
