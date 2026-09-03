import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (callback: unknown) => callback,
}));

import { decodeProjectCursor, PROJECT_LIST_PAGE_SIZE } from "./project-list";

const loaderSource = readFileSync(new URL("./project-list.ts", import.meta.url), "utf8");
const listSource = readFileSync(new URL("../components/project-list.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/projects/page.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/projects/route.ts", import.meta.url), "utf8");

describe("lightweight project pagination", () => {
  it("uses opaque validated keyset cursors", () => {
    const cursor = Buffer.from(JSON.stringify({
      v: 1,
      isExample: false,
      createdAt: "2026-09-03T00:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    })).toString("base64url");
    expect(decodeProjectCursor(cursor)).toEqual({
      v: 1,
      isExample: false,
      createdAt: "2026-09-03T00:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(() => decodeProjectCursor("not-a-cursor")).toThrow(
      "프로젝트 목록 위치가 올바르지 않습니다.",
    );
  });

  it("bounds the initial query and omits editor-heavy fields", () => {
    expect(PROJECT_LIST_PAGE_SIZE).toBe(12);
    expect(loaderSource).toContain("limit ${PROJECT_LIST_PAGE_SIZE + 1}");
    expect(loaderSource).toContain("order by is_example desc,created_at desc,id desc");
    expect(loaderSource).toContain("job.user_id=${userId}");
    expect(loaderSource).not.toContain("subtitle_segments");
    expect(loaderSource).not.toContain("editor_document");
    expect(loaderSource).not.toContain("comment_overlays");
    expect(pageSource).not.toContain("getAllProjects");
  });

  it("loads more near the viewport with request and item deduplication", () => {
    expect(listSource).toContain("IntersectionObserver");
    expect(listSource).toContain('rootMargin: "600px 0px"');
    expect(listSource).toContain("inFlight.current");
    expect(listSource).toContain("knownIds.has(project.id)");
    expect(routeSource).toContain("await getAuthenticatedUser()");
    expect(routeSource).toContain('"Cache-Control": "private, no-store"');
  });
});
