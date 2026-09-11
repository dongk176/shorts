"use client";
import { useEffect, useState } from "react";
type State = {
  enabled: boolean;
  expanded?: boolean;
  reads?: boolean;
  legacyCleanupEnabled?: boolean;
  project?: string;
  accounting?: { ready: boolean; accountingReadyFrom: string | null };
  usage?: {
    bucket: string;
    purpose: string;
    units: number;
    attempts: number;
    openingUnits: number;
    meteredUnits: number;
  }[];
  runs?: {
    lane: string;
    scheduledAt: string;
    status: string;
    pageCount: number;
    failedPages: number;
  }[];
  pending?: {
    catalogCount: number;
    pendingCount: number;
    urgentCount: number;
    unavailableCount: number;
  };
  backfill?: {
    ready: boolean;
    pendingRuns: number;
    missingVideos: number;
    missingDays: number;
    incorrectFirstDiscovery: number;
    expiredMetadata: number;
  };
  remaining?: { search: number; general: number; background: number };
};
const purposes: Record<string, string> = {
  analysis: "제작 전 확인",
  trending: "인기 급상승",
  views: "조회수 상위",
  reusable: "재사용 허용",
  free: "무료 소재",
  refresh: "정보 재확인",
};
export function AdminYoutubeDiscovery() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetch("/api/admin/youtube-discovery", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (result) => {
          if (!result.ok) throw new Error();
          return result.json() as Promise<State>;
        })
        .then((result) => {
          setState(result);
          setError(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        });
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);
  return (
    <section className="my-6 rounded-2xl border border-white/15 p-5">
      <h2 className="text-lg font-bold">YouTube 수집·사용 한도</h2>
      {error ? (
        <p role="alert">현재 상태 미확인 — 조회에 실패했습니다.</p>
      ) : !state ? (
        <p>확인 중…</p>
      ) : !state.enabled ? (
        <p className="mt-2">새 수집 구조 꺼짐 · 기존 일일 수집 유지</p>
      ) : (
        <>
          <p className="mt-2 text-sm">
            {state.project} ·{" "}
            {state.expanded
              ? "확대 주기 사용 중"
              : "기존 일일 주기 · 확대 조건 미충족 또는 꺼짐"}{" "}
            · 새 목록 {state.reads ? "켜짐" : "꺼짐"}
          </p>
          <p className="mt-2 text-sm">
            오늘 남은 예산: 검색 {state.remaining?.search}회 · 일반{" "}
            {state.remaining?.general}유닛 · 백그라운드{" "}
            {state.remaining?.background}유닛
          </p>
          {!state.accounting?.ready && <p className="mt-2 text-sm">이전 사용량 확인 중 · 추가 수집 중지</p>}
          <p className="mt-1 text-xs text-neutral-400">
            사용량 날짜는 미국 태평양 시간 기준입니다. 실패한 요청 시도도
            포함합니다.
          </p>
          <p className="mt-3 text-sm">
            누적 {state.pending?.catalogCount.toLocaleString()}개 · 재확인 대기{" "}
            {state.pending?.pendingCount.toLocaleString()}개 · 25일 경과{" "}
            {state.pending?.urgentCount.toLocaleString()}개 · 정보 없음{" "}
            {state.pending?.unavailableCount.toLocaleString()}개
          </p>
          <p className="mt-3 text-sm">
            기존 원본 정리:{" "}
            {state.legacyCleanupEnabled
              ? "켜짐 · 대조 통과 후 정리"
              : "잠금 · 기존 원본 유지"}
          </p>
          <p className="mt-3 text-sm">
            기존 데이터 대조:{" "}
            {state.backfill?.ready
              ? "통과"
              : `대기 ${state.backfill?.pendingRuns ?? "미확인"}회 · 영상 누락 ${state.backfill?.missingVideos ?? "미확인"}개 · 날짜 누락 ${state.backfill?.missingDays ?? "미확인"}개 · 최초 발견일 오류 ${state.backfill?.incorrectFirstDiscovery ?? "미확인"}개 · 만료 정보 ${state.backfill?.expiredMetadata ?? "미확인"}개`}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>용도</th>
                  <th>할당량</th>
                  <th>요청 시도</th>
                  <th>시작 사용량</th>
                  <th>계측 사용량</th>
                  <th>합계</th>
                </tr>
              </thead>
              <tbody>
                {state.usage?.map((row) => (
                  <tr key={`${row.bucket}-${row.purpose}`}>
                    <td className="py-2">{purposes[row.purpose]}</td>
                    <td>{row.bucket === "search" ? "검색" : "일반"}</td>
                    <td>{row.attempts}</td>
                    <td>{row.openingUnits}</td>
                    <td>{row.meteredUnits}</td>
                    <td>{row.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer">최근 수집 결과</summary>
            <ul className="mt-2 space-y-2 text-xs">
              {state.runs?.map((run, index) => (
                <li key={index}>
                  {new Date(run.scheduledAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}{" "}
                  · {purposes[run.lane]} ·{" "}
                  {
                    (
                      {
                        success: "성공",
                        partial: "일부 실패",
                        failed: "실패",
                        running: "진행 중",
                      } as Record<string, string>
                    )[run.status]
                  }{" "}
                  · {run.pageCount}페이지 · 실패 {run.failedPages}회
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
