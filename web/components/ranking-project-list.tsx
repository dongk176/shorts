"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/i18n/navigation";
import type { RankingProjectSummary } from "@/lib/ranking-project-list";
import { rankingDirectRemote } from "@/lib/ranking-embed";
import { ProjectDeleteOverlay } from "./project-delete-overlay";
import { RankingThumbnail } from "./ranking-thumbnail";

const statusLabels = {
  draft: "미완료",
  queued: "제작 대기",
  running: "제작 중",
  succeeded: "완료",
  failed: "제작 실패",
} as const;

export function RankingProjectList({ projects }: { projects: RankingProjectSummary[] }) {
  const router = useRouter();
  const [items, setItems] = useState(projects);
  useEffect(() => setItems(projects), [projects]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<RankingProjectSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const visible = items.filter((project) => !removed.includes(project.id));
  const hasActive = visible.some((project) => project.busy || ["queued", "running"].includes(project.status));
  useEffect(() => {
    if (!hasActive) return;
    const controller = new AbortController();
    let polling = false;
    const refresh = async () => {
      if (polling || document.visibilityState !== "visible") return;
      polling = true;
      try {
        const response = await fetch("/api/ranking-shorts", {
          cache: "no-store", credentials: "same-origin",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!controller.signal.aborted && Array.isArray(data.projects)) setItems(data.projects);
      } catch { /* Preserve the current cards during a transient connection failure. */ }
      finally { polling = false; }
    };
    const timer = window.setInterval(() => void refresh(), 5000);
    const onVisible = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasActive]);
  async function remove() {
    if (!deleting || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/ranking-shorts/${deleting.id}`, {
        method: "DELETE", credentials: "same-origin", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "작업을 삭제하지 못했습니다.");
      }
      setRemoved((previous) => [...previous, deleting.id]);
      setDeleting(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "응답이 지연되고 있습니다. 새로고침 후 확인해 주세요.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  if (!visible.length) return null;
  return (
    <section className="mt-8" aria-labelledby="ranking-project-list-title">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="ranking-project-list-title" className="text-lg font-bold text-white">
          랭킹 쇼츠 <span className="ml-2 text-sm font-medium text-neutral-400">{visible.length}</span>
        </h2>
        <Link href="/ranking-shorts" prefetch={false} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-[#dfcba5] hover:bg-white/5">
          새 랭킹 쇼츠 <span className="ml-2" aria-hidden="true">＋</span>
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((project) => {
          const complete = project.status === "succeeded" && project.operationId;
          const title = project.title?.trim() || "제목 없는 랭킹 쇼츠";
          const href = `/ranking-shorts?project=${project.id}`;
          return (
            <article key={project.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[.035] transition hover:border-white/20">
              <Link href={href} prefetch={false} aria-label={`${title} 열기`} className="block aspect-video overflow-hidden bg-black">
                <RankingThumbnail
                  key={`${project.id}:${project.operationId}`}
                  videoUrl={complete ? `/api/ranking-shorts/${project.id}/media/${project.operationId}?result=1` : undefined}
                  remote={project.remoteUrl ? rankingDirectRemote(project.remoteUrl) || undefined : undefined}
                  fit="contain"
                />
              </Link>
              <div className="p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold tracking-wide text-[#dfcba5]">랭킹 쇼츠</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${project.status === "failed" ? "bg-red-400/10 text-red-300" : complete ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-neutral-300"}`}>
                  {statusLabels[project.status]}
                </span>
              </div>
              <h3 className="mt-3 truncate text-lg font-bold text-white">
                <Link href={href} prefetch={false} className="hover:text-[#dfcba5]">{title}</Link>
              </h3>
              <p className="mt-2 text-sm text-neutral-400">
                <time dateTime={project.createdAt}>{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(project.createdAt))}</time>
                {complete && project.duration != null ? ` · ${project.duration.toFixed(1)}초` : null}
              </p>
              {["queued", "running"].includes(project.status) ? (
                <div role="status" className="mt-4 flex items-center gap-2 text-sm text-[#dfcba5]">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                  {project.status === "queued" ? "제작 순서를 기다리고 있어요" : "영상을 만들고 있어요"}
                  <span className="sr-only">완료되면 자동으로 갱신됩니다.</span>
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                {!["queued", "running"].includes(project.status) ? <Link href={href} prefetch={false} aria-label={`${title} ${complete ? "영상 보기" : "작업 열기"}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/15">
                  {complete ? "영상 보기" : "작업 열기"} <span className="ml-2" aria-hidden="true">↗</span>
                </Link> : null}
                {complete ? (
                  <a href={`/api/ranking-shorts/${project.id}/media/${project.operationId}?result=1&download=1`} aria-label={`${title} 다운로드`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-neutral-200 hover:bg-white/5">
                    다운로드 <span className="ml-2" aria-hidden="true">↓</span>
                  </a>
                ) : null}
                <button type="button" disabled={project.busy} aria-label={`${title} 삭제`}
                  title={project.busy ? "진행 중인 작업은 완료 후 삭제할 수 있습니다." : undefined}
                  onClick={() => { setError(""); setDeleting(project); }}
                  className="ml-auto inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-neutral-400 hover:bg-red-400/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40">삭제</button>
              </div>
              </div>
            </article>
          );
        })}
      </div>
      <ProjectDeleteOverlay open={Boolean(deleting)} state={error ? "error" : "confirm"}
        statusLabel="랭킹 쇼츠 삭제" title={error ? "삭제하지 못했습니다" : "이 작업을 삭제할까요?"}
        message={error || `${deleting?.title?.trim() || "제목 없는 랭킹 쇼츠"}\n프로젝트 목록에서 제거되며 영상 링크를 사용할 수 없게 됩니다.`}
        actionLabel={error ? "다시 시도" : "삭제하기"} closeLabel="취소" actionPending={pending}
        onAction={() => void remove()} onClose={() => { if (!pending) setDeleting(null); }} />
    </section>
  );
}
