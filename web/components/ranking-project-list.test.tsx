import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
const menuState = vi.hoisted(() => ({ open: false }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => actual.useState(menuState.open && initial === null ? "project" : initial) };
});
vi.mock("@/lib/i18n/navigation", () => ({ default: ({ prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => { void prefetch; return <a {...props} />; } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./project-delete-overlay", () => ({ ProjectDeleteOverlay: () => null }));
import { RankingProjectList } from "./ranking-project-list";
const project = { id: "project", title: "내 영상", createdAt: "2026-10-24T00:00:00Z", status: "succeeded" as const, operationId: "render", duration: 3.02, remoteUrl: null, busy: false };
describe("ranking project cards", () => {
  beforeEach(() => { menuState.open = false; });
  it("keeps actions collapsed until the card menu is opened", () => {
    const html = renderToStaticMarkup(<RankingProjectList projects={[project]} />);
    expect(html).toContain('aria-label="내 영상 메뉴" aria-expanded="false"');
    expect(html).not.toContain('download=1');
    expect(html).not.toContain('aria-label="내 영상 삭제"');
  });
  it("opens the saved ranking and downloads the matching completed operation", () => {
    menuState.open = true;
    const html = renderToStaticMarkup(<RankingProjectList projects={[project]} />);
    expect(html).toContain('/ranking-shorts?project=project');
    expect(html).toContain('/api/ranking-shorts/project/media/render?result=1&amp;download=1');
    expect(html).toContain("3.0초");
    expect(html).toContain("완료");
  });
  it.each(["draft", "queued", "running", "failed"] as const)("does not offer unfinished downloads (%s)", (status) => {
    menuState.open = true;
    const html = renderToStaticMarkup(<RankingProjectList projects={[{ ...project, status }]} />);
    expect(html).not.toContain("download=1");
    if (["queued", "running"].includes(status)) {
      expect(html).not.toContain("작업 열기");
      expect(html).toContain('role="status"');
    } else expect(html).toContain("작업 열기");
  });
  it("renders nothing for empty lists and safely escapes titles", () => {
    expect(renderToStaticMarkup(<RankingProjectList projects={[]} />)).toBe("");
    const html = renderToStaticMarkup(<RankingProjectList projects={[{ ...project, title: "<script>alert(1)</script>" }]} />);
    expect(html).not.toContain("<script>");
  });
  it("disables deletion while any operation is in flight", () => {
    menuState.open = true;
    const html = renderToStaticMarkup(<RankingProjectList projects={[{ ...project, busy: true }]} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="내 영상 삭제"/);
  });
});
