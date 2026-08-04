import assert from "node:assert/strict";
import test from "node:test";
import {
  appRouteFromFile,
  buildRouteInventory,
  compareRoutes,
  compareTreeInventories,
  extractDeploymentInfo,
  findDisallowedWebReleaseFiles,
  findForbiddenPublishingReferences,
  makeProductionTagName,
  validateRepositoryFacts,
} from "./release-production-policy.mjs";

test("App Router files become stable route names", () => {
  assert.equal(appRouteFromFile("web/app/page.tsx"), "/");
  assert.equal(appRouteFromFile("web/app/(site)/pricing/page.tsx"), "/pricing");
  assert.equal(appRouteFromFile("web/app/api/shorts/[shortId]/route.ts"), "/api/shorts/[shortId]");
  assert.equal(appRouteFromFile("web/components/card.tsx"), null);
  assert.deepEqual(buildRouteInventory([
    "web/app/page.tsx",
    "web/app/page.tsx",
    "web/app/projects/[projectNumber]/page.tsx",
  ]), ["/", "/projects/[projectNumber]"]);
});

test("route comparison rejects every removed route and publishing routes", () => {
  assert.deepEqual(compareRoutes(
    ["/", "/guidebook", "/api/mvp/state"],
    ["/", "/api/mvp/state", "/content-calendar", "/api/youtube/oauth/start"],
  ), {
    missing: ["/guidebook"],
    forbidden: ["/content-calendar", "/api/youtube/oauth/start"],
  });
});

test("web releases reject worker, infrastructure, and migration changes", () => {
  assert.deepEqual(findDisallowedWebReleaseFiles([
    "web/app/page.tsx",
    "worker/render.py",
    "supabase/migrations/202608040001.sql",
    "infra/aws/lib/stack.ts",
    ".github/workflows/deploy-worker.yml",
  ]), [
    "worker/render.py",
    "supabase/migrations/202608040001.sql",
    "infra/aws/lib/stack.ts",
    ".github/workflows/deploy-worker.yml",
  ]);
});

test("publishing navigation and API references cannot hide inside an existing web file", () => {
  assert.deepEqual(findForbiddenPublishingReferences([
    { file: "web/components/site-sidebar.tsx", content: "href=\"/content-calendar\"" },
    { file: "web/app/page.tsx", content: "ordinary home" },
    { file: "docs/production-release.md", content: "/content-calendar" },
  ]), ["web/components/site-sidebar.tsx"]);
});

test("whole-tree comparison catches unlisted or phantom changes", () => {
  const baseline = new Map([["a", "1"], ["b", "2"]]);
  const candidate = new Map([["a", "1"], ["b", "3"], ["c", "4"]]);
  assert.deepEqual(compareTreeInventories(baseline, candidate, ["b", "missing"]), {
    actualChanged: ["b", "c"],
    undeclared: ["c"],
    phantom: ["missing"],
  });
});

test("repository facts reject old, dirty, multi-commit, and unpushed candidates", () => {
  assert.deepEqual(validateRepositoryFacts({
    dirty: true,
    branch: "codex/release",
    baselineIsAncestor: false,
    commitsAhead: 3,
    head: "candidate",
    upstream: "old",
  }), [
    "커밋되지 않은 변경이 있습니다.",
    "현재 브랜치가 운영 기준 커밋에서 시작하지 않았습니다.",
    "운영 기준 위에는 단일 릴리스 커밋만 허용됩니다. 현재 3개입니다.",
    "현재 릴리스 커밋이 원격 브랜치에 푸시되지 않았습니다.",
  ]);
  assert.deepEqual(validateRepositoryFacts({
    dirty: false,
    branch: "codex/release",
    baselineIsAncestor: true,
    commitsAhead: 1,
    head: "candidate",
    upstream: "candidate",
  }), []);
});

test("Vercel output and production tag metadata are normalized", () => {
  assert.deepEqual(extractDeploymentInfo({
    id: "dpl_AbC123",
    url: "shorts-example.vercel.app",
  }), {
    deploymentId: "dpl_AbC123",
    deploymentUrl: "https://shorts-example.vercel.app",
  });
  assert.equal(
    makeProductionTagName(new Date("2026-08-04T01:02:03.000Z"), "abcdef012345"),
    "prod-20260804T010203Z-abcdef01",
  );
});
