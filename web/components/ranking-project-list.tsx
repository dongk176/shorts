"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";
import { useNavigationLocale } from "@/lib/i18n/provider";
import { formatLocale } from "@/lib/i18n/config";
import { rankingSounds, type RankingSound } from "@/lib/ranking-audio";
import { useEffect, useRef, useState } from "react";
import { useUsageState } from "./usage-provider";
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

export function RankingProjectList({ projects, embedded = false, onOpen }: { projects: RankingProjectSummary[]; embedded?: boolean; onOpen?: (project: RankingProjectSummary) => void }) {
  const ui = useUiText();
  const locale = useNavigationLocale();
  const router = useRouter();
  const { refreshUsage } = useUsageState();
  const usageRefresh = useRef(refreshUsage);
  usageRefresh.current = refreshUsage;
  const wasActive = useRef(false);
  const [items, setItems] = useState(projects);
  useEffect(() => setItems(projects), [projects]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<RankingProjectSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(`[data-ranking-menu="${menu}"]`)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [menu]);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const visible = items.filter((project) => !removed.includes(project.id) && (!embedded || project.status !== "draft"));
  const hasActive = visible.some((project) => project.busy || ["queued", "running"].includes(project.status));
  useEffect(() => {
    if (wasActive.current && !hasActive) void usageRefresh.current();
    wasActive.current = hasActive;
  }, [hasActive]);
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
  const [soundProject,setSoundProject]=useState<RankingProjectSummary|null>(null);
  const [replacementSound,setReplacementSound]=useState<RankingSound|null>("lip-bass");
  const soundDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(!soundProject)return;const el=soundDialog.current;const focus=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";el?.showModal();return()=>{el?.close();document.body.style.overflow=overflow;focus?.focus();};},[soundProject]);
  const retryRequest = useRef<{operation:string;requestId:string;sound?:RankingSound|null}|null>(null);
  async function retryRender(project: RankingProjectSummary, transitionSound?: RankingSound|null) {
    if (inFlight.current || !project.operationId) return;
    inFlight.current = true; setPending(true); setError("");
    if (retryRequest.current?.operation !== project.operationId || retryRequest.current.sound !== transitionSound) retryRequest.current={operation:project.operationId,requestId:crypto.randomUUID(),sound:transitionSound};
    try {
      const response=await fetch(`/api/ranking-shorts/${project.id}/render`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:retryRequest.current.requestId,retryOperationId:project.operationId,...(transitionSound!==undefined?{transitionSound}: {})}),signal:AbortSignal.timeout(300000)});
      const data=await response.json(); if(!response.ok)throw new Error(data.error || "제작을 다시 시작하지 못했습니다.");
      setItems(previous=>previous.map(p=>p.id===project.id?{...p,status:"running",busy:true,operationId:data.operationId}:p));setMenu(null);setSoundProject(null);void usageRefresh.current();
    } catch(cause) {setError(cause instanceof Error?cause.message:"다시 시도해 주세요.");}
    finally {inFlight.current=false;setPending(false);}
  }
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
    <section className="mt-8" aria-labelledby={embedded ? undefined : "ranking-project-list-title"} aria-label={embedded ? ui("제작한 랭킹 쇼츠") : undefined}>
      {!embedded && <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="ranking-project-list-title" className="text-lg font-bold text-white">
          {ui("랭킹 쇼츠")} <span className="ml-2 text-sm font-medium text-neutral-400">{visible.length}</span>
        </h2>
        <Link href="/ranking-shorts" prefetch={false} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-[#dfcba5] hover:bg-white/5">
          {ui("새 랭킹 쇼츠")} <span className="ml-2" aria-hidden="true">＋</span>
        </Link>
      </div>}
      <div className="project-collection-grid grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((project) => {
          const complete = project.status === "succeeded" && project.operationId;
          const title = project.title?.trim() || ui("제목 없는 랭킹 쇼츠");
          const href = `/ranking-shorts?project=${project.id}`;
          return (
            <article key={project.id} data-ranking-project={project.id} className="project-card relative overflow-hidden rounded-2xl border border-white/10 bg-white/[.035] transition hover:border-white/20">
              <Link href={href} onClick={onOpen ? (event) => { event.preventDefault(); onOpen(project); } : undefined} prefetch={false} aria-label={`${title} 열기`} className="block aspect-video overflow-hidden bg-black">
                <RankingThumbnail
                  key={`${project.id}:${project.operationId}`}
                  videoUrl={complete ? `/api/ranking-shorts/${project.id}/media/${project.operationId}?result=1` : undefined}
                  remote={project.remoteUrl ? rankingDirectRemote(project.remoteUrl) || undefined : undefined}
                  fit="contain"
                />
              </Link>
              <div className="p-4">
              <h3 data-i18n-skip={Boolean(project.title?.trim()) || undefined} className="truncate text-sm font-bold text-white">
                <Link href={href} onClick={onOpen ? (event) => { event.preventDefault(); onOpen(project); } : undefined} prefetch={false} className="hover:text-[#dfcba5]">{title}</Link>
              </h3>
              <p className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-400">
                <span className={complete ? "text-emerald-400" : project.status === "failed" ? "text-red-300" : "text-neutral-300"}>● {ui(statusLabels[project.status])}</span>
                <time dateTime={project.createdAt}>{new Intl.DateTimeFormat(formatLocale(locale), { year: "numeric", month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(project.createdAt))}</time>
                {complete && project.duration != null ? ` · ${project.duration.toFixed(1)}${locale === "ko" ? "초" : locale === "ja" ? "秒" : "s"}` : null}
              </p>
              {["queued", "running"].includes(project.status) ? (
                <div role="status" className="mt-4 flex items-center gap-2 text-sm text-[#dfcba5]">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                  {project.progressMessage || (project.status === "queued" ? "제작 순서를 기다리고 있어요" : "영상을 만들고 있어요")}
                  <span className="sr-only">완료되면 자동으로 갱신됩니다.</span>
                </div>
              ) : null}
              {project.status === "failed" && project.operationId ? <button type="button" disabled={pending || project.busy} onClick={()=>void retryRender(project)} className="mt-3 min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-50" aria-label={`${title} 다시 만들기`}>{pending?"제작 준비 중…":"다시 만들기"}</button>:null}
              <button data-ranking-menu={project.id} type="button" aria-label={`${title} 메뉴`} aria-expanded={menu === project.id} onClick={() => setMenu(menu === project.id ? null : project.id)} className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-black/80 text-white">•••</button>
              {menu === project.id && <div data-ranking-menu={project.id} className="absolute right-2 top-14 z-10 flex flex-col gap-1 rounded-xl border border-white/20 bg-neutral-900 p-2 shadow-xl" onKeyDown={(event) => { if (event.key === "Escape") setMenu(null); }}>
                {!["queued", "running"].includes(project.status) ? <Link href={href} onClick={onOpen ? (event) => { event.preventDefault(); onOpen(project); } : undefined} prefetch={false} aria-label={`${title} ${complete ? "영상 보기" : "작업 열기"}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/15">
                  {complete ? "영상 보기" : "작업 열기"} <span className="ml-2" aria-hidden="true">↗</span>
                </Link> : null}
                {complete ? (
                  <a href={`/api/ranking-shorts/${project.id}/media/${project.operationId}?result=1&download=1`} aria-label={`${title} 다운로드`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-neutral-200 hover:bg-white/5">
                    다운로드 <span className="ml-2" aria-hidden="true">↓</span>
                  </a>
                ) : null}
                {complete ? <button type="button" disabled={pending || project.busy} onClick={()=>{setMenu(null);setError("");setSoundProject(project);}} className="min-h-11 rounded-xl px-4 text-sm text-white hover:bg-white/10">효과음 바꿔 만들기</button>:null}
                <button type="button" disabled={project.busy} aria-label={`${title} 삭제`}
                  title={project.busy ? "진행 중인 작업은 완료 후 삭제할 수 있습니다." : undefined}
                  onClick={() => { setError(""); setDeleting(project); }}
                  className="ml-auto inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-neutral-400 hover:bg-red-400/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40">삭제</button>
              </div>}
              </div>
            </article>
          );
        })}
      </div>
      {soundProject ? <dialog ref={soundDialog} className="m-auto w-[min(420px,calc(100vw-32px))] rounded-2xl border border-white/15 bg-neutral-900 p-6 text-white backdrop:bg-black/70" onCancel={(e)=>{if(pending)e.preventDefault();else setSoundProject(null);}} onClick={e=>{if(e.target===e.currentTarget&&!pending)setSoundProject(null);}} aria-label="효과음 바꿔 만들기">
        <h2 className="text-lg font-bold">효과음 바꿔 만들기</h2><p className="mt-2 text-sm text-neutral-400">장면과 제목은 그대로 두고, 효과음만 바꿔요.</p>
        <label className="mt-5 block text-sm">효과음<select aria-label="바꿀 효과음" disabled={pending} value={replacementSound||"none"} onChange={e=>setReplacementSound(e.target.value==="none"?null:e.target.value as RankingSound)} className="mt-2 block min-h-11 w-full rounded-lg border border-white/20 bg-neutral-800 px-3"><option value="none">없음</option>{rankingSounds.map(sound=><option key={sound.id} value={sound.id}>{sound.label}</option>)}</select></label>
        {error?<p role="alert" className="mt-3 text-sm text-red-300">{error}</p>:null}
        <p className="mt-3 text-xs text-neutral-400">영상 1개당 3분 차감</p><div className="mt-5 flex gap-3"><button type="button" disabled={pending} onClick={()=>setSoundProject(null)} className="min-h-11 flex-1 rounded-lg border border-white/20">취소</button><button type="button" disabled={pending} onClick={()=>void retryRender(soundProject,replacementSound)} className="min-h-11 flex-1 rounded-lg bg-violet-600 font-bold disabled:opacity-50">{pending?"준비 중…":"다시 만들기"}</button></div>
      </dialog>:null}
      <ProjectDeleteOverlay open={Boolean(deleting)} state={error ? "error" : "confirm"}
        statusLabel={ui("랭킹 쇼츠 삭제")} title={ui(error ? "삭제하지 못했습니다" : "이 작업을 삭제할까요?")}
        message={error || `${deleting?.title?.trim() || ui("제목 없는 랭킹 쇼츠")}\n${ui("프로젝트 목록에서 제거되며 영상 링크를 사용할 수 없게 됩니다.")}`}
        actionLabel={ui(error ? "다시 시도" : "삭제하기")} closeLabel={ui("취소")} actionPending={pending}
        onAction={() => void remove()} onClose={() => { if (!pending) setDeleting(null); }} />
    </section>
  );
}
