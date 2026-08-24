import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/202608230005_project_soft_delete.sql", import.meta.url),
  "utf8",
);

const userFacingShortRoutes = [
  "../app/api/shorts/[shortId]/access/route.ts",
  "../app/api/shorts/[shortId]/apply-edit/route.ts",
  "../app/api/shorts/[shortId]/download/route.ts",
  "../app/api/shorts/[shortId]/edit-source/route.ts",
  "../app/api/shorts/[shortId]/edit-timeline/route.ts",
  "../app/api/shorts/[shortId]/editor-channel-asset/route.ts",
  "../app/api/shorts/[shortId]/regenerate-comments/route.ts",
  "../app/api/shorts/[shortId]/rerender/route.ts",
  "../app/api/shorts/[shortId]/route.ts",
];

function userFacingVideoJobQueries(source: string) {
  return [...source.matchAll(
    /(?:join|from) shorts_mvp\.video_jobs (j|job)\b[\s\S]*?`/g,
  )].map((match) => ({ alias: match[1], query: match[0] }));
}

describe("project soft-delete schema contract", () => {
  it("adds only the UI visibility timestamp and does not rewrite history", () => {
    expect(migration).toContain("alter table shorts_mvp.video_jobs");
    expect(migration).toContain("add column if not exists user_deleted_at timestamptz");
    expect(migration).not.toMatch(/\bupdate\b|\bdelete\s+from\b|\binsert\s+into\b|\btruncate\b/i);
    expect(migration).not.toContain("shorts_mvp.generated_shorts");
    expect(migration).not.toContain("shorts_mvp.usage_events");
    expect(migration).not.toContain("shorts_mvp.site_metrics");
  });

  it.each(userFacingShortRoutes)(
    "blocks every user-facing short query after its parent project is deleted: %s",
    (routePath) => {
      const source = readFileSync(new URL(routePath, import.meta.url), "utf8");
      const queries = userFacingVideoJobQueries(source);

      expect(queries.length).toBeGreaterThan(0);
      for (const { alias, query } of queries) {
        expect(query).toContain(`${alias}.user_deleted_at is null`);
      }
    },
  );

  it("invalidates public creator-share reads while preserving admin analytics", () => {
    const source = readFileSync(
      new URL("./creator-project-shares.ts", import.meta.url),
      "utf8",
    );
    const publicShareFunctions = [
      "loadCreatorProjectShare",
      "findActiveShare",
      "findCreatorShareMedia",
    ];

    for (const [index, functionName] of publicShareFunctions.entries()) {
      const start = source.indexOf(`function ${functionName}`);
      const fallbackStart = source.indexOf(`function ${functionName}`, 0);
      const resolvedStart = start >= 0 ? start : fallbackStart;
      expect(resolvedStart, functionName).toBeGreaterThanOrEqual(0);
      const nextName = publicShareFunctions[index + 1];
      const nextStart = nextName ? source.indexOf(`function ${nextName}`, resolvedStart + 1) : -1;
      const body = source.slice(resolvedStart, nextStart >= 0 ? nextStart : undefined);
      expect(body, functionName).toContain("job.user_deleted_at is null");
    }
  });
});
