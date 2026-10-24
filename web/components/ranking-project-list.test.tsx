import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
vi.mock("@/lib/i18n/navigation", () => ({ default: ({ prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => { void prefetch; return <a {...props} />; } }));
import { RankingProjectList } from "./ranking-project-list";
const project = { id: "project", title: "내 영상", createdAt: "2026-10-24T00:00:00Z", status: "succeeded" as const, operationId: "render", duration: 3.02 };
describe("ranking project cards", () => {
  it("opens the saved ranking and downloads the matching completed operation", () => {
    const html = renderToStaticMarkup(<RankingProjectList projects={[project]} />);
    expect(html).toContain('/ranking-shorts?project=project');
    expect(html).toContain('/api/ranking-shorts/project/media/render?result=1&amp;download=1');
    expect(html).toContain("3.0초");
    expect(html).toContain("완료");
  });
  it.each(["draft", "queued", "running", "failed"] as const)("does not offer unfinished downloads (%s)", (status) => {
    const html = renderToStaticMarkup(<RankingProjectList projects={[{ ...project, status }]} />);
    expect(html).not.toContain("download=1");
    expect(html).toContain("작업 열기");
  });
  it("renders nothing for empty lists and safely escapes titles", () => {
    expect(renderToStaticMarkup(<RankingProjectList projects={[]} />)).toBe("");
    const html = renderToStaticMarkup(<RankingProjectList projects={[{ ...project, title: "<script>alert(1)</script>" }]} />);
    expect(html).not.toContain("<script>");
  });
});
