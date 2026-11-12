"use client";

import { useEffect, useState } from "react";

type Project = { id: string; projectNumber: number; videoTitle: string; status: string;
  progress: number; errorMessage?: string; shortId?: string; outputStatus?: string; durationSeconds?: number };
const terminal = new Set(["completed", "failed", "expired", "deleted"]);
const ignoreCount = () => {};

/** Midform results share the home project list; creation uses the normal source form. */
export function MidformCloudWorkspace({ refreshKey = 0, onActiveCountChange = ignoreCount, onEdit }: {
  refreshKey?: number; onActiveCountChange?: (count: number) => void; onEdit?: (shortId: string, projectNumber: number) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/midform", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("미들폼 프로젝트를 불러오지 못했습니다.");
        const result = await response.json() as { projects: Project[] };
        if (alive) { setProjects(result.projects); setError(""); }
      } catch (cause) {
        if (alive && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "프로젝트를 확인해 주세요.");
      }
      if (alive) timer = setTimeout(load, 5000);
    }
    void load();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [refreshKey]);
  useEffect(() => { onActiveCountChange(projects.filter(project => !terminal.has(project.status)).length); }, [projects, onActiveCountChange]);
  if (!projects.length && !error) return null;
  return <div aria-label="미들폼 프로젝트" className="mt-4 grid gap-3 sm:grid-cols-2">
    {error ? <p role="alert" className="text-sm text-neutral-400">{error}</p> : null}
    {projects.map(project => <article key={project.id} className="relative flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.025] p-4 transition hover:border-white/25 hover:bg-white/[.045]">
      <span aria-hidden="true" className="grid aspect-video w-24 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-400/20 to-[#ff715e]/10 text-xl text-violet-200">▶</span>
      <div className="min-w-0 flex-1"><span className="text-[10px] font-bold text-violet-300">미들폼 · 한 편</span>
        <h3 className="mt-1 truncate text-sm font-semibold">{project.videoTitle}</h3>
        {project.shortId && ["ready", "rerendering"].includes(project.outputStatus || "")
          ? <button type="button" className="mt-2 text-xs font-semibold text-neutral-300 after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-[#ff715e]" aria-label={`${project.videoTitle} 편집하기`} onClick={() => {
            if (onEdit) onEdit(project.shortId!, project.projectNumber);
            else window.location.href = `/projects/${project.projectNumber}/edit/${project.shortId}?format=midform`;
          }}>{project.durationSeconds ? `${Math.floor(project.durationSeconds / 60)}:${String(Math.floor(project.durationSeconds % 60)).padStart(2, "0")} · ` : ""}편집하기 ↗</button>
          : <p className="mt-2 text-xs text-neutral-400">{project.status === "failed" ? project.errorMessage || "제작에 실패했습니다." : `제작 중 ${project.progress}%`}</p>}
      </div>
    </article>)}
  </div>;
}
