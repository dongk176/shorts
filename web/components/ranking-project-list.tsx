import Link from "@/lib/i18n/navigation";
import type { RankingProjectSummary } from "@/lib/ranking-project-list";

const statusLabels = {
  draft: "미완료",
  queued: "제작 대기",
  running: "제작 중",
  succeeded: "완료",
  failed: "제작 실패",
} as const;

export function RankingProjectList({ projects }: { projects: RankingProjectSummary[] }) {
  if (!projects.length) return null;
  return (
    <section className="mt-8" aria-labelledby="ranking-project-list-title">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="ranking-project-list-title" className="text-lg font-bold text-white">
          랭킹 쇼츠 <span className="ml-2 text-sm font-medium text-neutral-400">{projects.length}</span>
        </h2>
        <Link href="/ranking-shorts" prefetch={false} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-[#dfcba5] hover:bg-white/5">
          새 랭킹 쇼츠 <span className="ml-2" aria-hidden="true">＋</span>
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {projects.map((project) => {
          const complete = project.status === "succeeded" && project.operationId;
          const title = project.title?.trim() || "제목 없는 랭킹 쇼츠";
          const href = `/ranking-shorts?project=${project.id}`;
          return (
            <article key={project.id} className="rounded-2xl border border-white/10 bg-white/[.035] p-5 transition hover:border-white/20">
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
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={href} prefetch={false} aria-label={`${title} ${complete ? "영상 보기" : "작업 열기"}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/15">
                  {complete ? "영상 보기" : "작업 열기"} <span className="ml-2" aria-hidden="true">↗</span>
                </Link>
                {complete ? (
                  <a href={`/api/ranking-shorts/${project.id}/media/${project.operationId}?result=1&download=1`} aria-label={`${title} 다운로드`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-neutral-200 hover:bg-white/5">
                    다운로드 <span className="ml-2" aria-hidden="true">↓</span>
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
