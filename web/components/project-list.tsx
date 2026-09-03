"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectCard } from "@/components/project-card";
import type { ProjectListPage } from "@/lib/contracts";

export function ProjectList({
  authenticated,
  initialPage,
}: {
  authenticated: boolean;
  initialPage: ProjectListPage;
}) {
  const [projects, setProjects] = useState(initialPage.projects);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const loadMore = useCallback(async () => {
    if (!authenticated || !hasMore || !nextCursor || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`/api/projects?cursor=${encodeURIComponent(nextCursor)}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const page = await response.json() as ProjectListPage & { detail?: string };
      if (!response.ok || !Array.isArray(page.projects)) {
        throw new Error(page.detail || "프로젝트를 더 불러오지 못했습니다.");
      }
      setProjects((current) => {
        const knownIds = new Set(current.map((project) => project.id));
        return [...current, ...page.projects.filter((project) => !knownIds.has(project.id))];
      });
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "프로젝트를 더 불러오지 못했습니다.");
      } else {
        setError("프로젝트 목록 응답이 늦어 중단했습니다. 다시 시도해 주세요.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (controllerRef.current === controller) controllerRef.current = null;
      inFlight.current = false;
      setLoading(false);
    }
  }, [authenticated, hasMore, nextCursor]);

  useEffect(() => {
    if (!authenticated || !hasMore || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [authenticated, hasMore, loadMore]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  if (!projects.length) return null;

  return (
    <section className="mt-10" aria-labelledby="project-list-title">
      <div className="mb-5 flex items-center gap-2">
        <h2 id="project-list-title" className="text-lg font-extrabold text-white">
          {authenticated ? "전체 프로젝트" : "예시 작업"}
        </h2>
        <span className="text-sm text-neutral-500">({initialPage.totalCount})</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => <ProjectCard key={project.id} job={project} />)}
      </div>
      {authenticated && (hasMore || error) ? (
        <div ref={sentinelRef} className="mt-8 flex min-h-16 flex-col items-center justify-center gap-3 text-center">
          {error ? <p role="alert" className="text-sm font-bold text-[#ff9b8d]">{error}</p> : null}
          {error ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="min-h-11 rounded-xl border border-white/15 bg-white/[.04] px-6 text-sm font-extrabold text-white hover:bg-white/[.08]"
            >
              다시 시도
            </button>
          ) : loading ? <p className="text-sm text-neutral-500">프로젝트를 더 불러오는 중…</p> : null}
        </div>
      ) : null}
    </section>
  );
}
