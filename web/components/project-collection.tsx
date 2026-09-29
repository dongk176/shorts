"use client";

import { ProjectCard } from "@/components/project-card";
import type { ProjectListItem } from "@/lib/contracts";
import { useUiText } from "@/lib/i18n/use-ui-text";

// Keep the API cursor order intact; only group the loaded cards for display.
export function ProjectCollection({ projects, authenticated }: {
  projects: ProjectListItem[];
  authenticated: boolean;
}) {
  const ui = useUiText();
  const ownProjects = projects.filter((project) => !project.isExample);
  const examples = projects.filter((project) => project.isExample);
  const grid = (items: ProjectListItem[]) => (
    <div className="project-collection-grid grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((project) => <ProjectCard key={project.id} job={project} />)}
    </div>
  );

  return <>
    {ownProjects.length > 0 ? grid(ownProjects) : authenticated ? (
      <p className="mb-5 rounded-xl border border-dashed border-white/15 px-4 py-5 text-sm text-neutral-400">
        {ui("아직 만든 프로젝트가 없어요")}
      </p>
    ) : null}
    {examples.length > 0 && (authenticated && ownProjects.length > 0 ? (
      <details className="project-examples-disclosure">
        <summary>{ui("예시 작업 둘러보기")} <span>({examples.length})</span></summary>
        {grid(examples)}
      </details>
    ) : grid(examples))}
  </>;
}
