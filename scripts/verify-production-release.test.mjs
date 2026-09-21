import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE,
  PROTECTED_APP_ROUTES,
  compareManifestRoutes,
  parseArgs,
  validateManifestRoutes,
  validateTrackedFiles,
} from "./verify-production-release.mjs";

test("production release guard requires an exact baseline manifest", () => {
  assert.throws(
    () => parseArgs(["--base", "abc123"]),
    /--baseline-manifest/,
  );
  assert.equal(
    parseArgs([
      "--base",
      "abc123",
      "--baseline-manifest",
      "/tmp/production-manifest.json",
    ]).baselineManifest,
    "/tmp/production-manifest.json",
  );
});

test("Meta administrator release allows only its nine reviewed routes", () => {
  const additions = ["/route", "/connections/[connectionId]/route", "/deauthorize/route", "/media/[capability]/route", "/oauth/callback/route", "/oauth/start/route", "/posts/route", "/posts/[postId]/check/route", "/preview/[shortId]/route"].map(suffix => `/api/social/[platform]${suffix}`);
  assert.deepEqual(ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE.filter(route => route.startsWith("/api/social/[platform]")), additions);
  assert.deepEqual(compareManifestRoutes([...PROTECTED_APP_ROUTES, ...additions, "/api/social/[platform]/public/route", "/api/youtube/oauth/start/route"], PROTECTED_APP_ROUTES, ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE), {
    added: ["/api/social/[platform]/public/route", "/api/youtube/oauth/start/route"], removed: [],
  });
});

test("production release guard rejects the isolated content calendar", () => {
  assert.deepEqual(
    validateTrackedFiles(["web/app/content-calendar/page.tsx"]),
    ["web/app/content-calendar/"],
  );
  assert.deepEqual(
    validateTrackedFiles(["web/app/page.tsx", "web/app/projects/page.tsx"]),
    [],
  );
});

test("production release guard requires protected routes and forbids publishing routes", () => {
  assert.ok(PROTECTED_APP_ROUTES.includes("/templates/page"));
  assert.deepEqual(validateManifestRoutes(PROTECTED_APP_ROUTES), {
    missingProtected: [],
    includedForbidden: [],
  });
  const invalid = validateManifestRoutes([
    ...PROTECTED_APP_ROUTES.slice(1),
    "/content-calendar/page",
  ]);
  assert.deepEqual(invalid.missingProtected, ["/page"]);
  assert.deepEqual(invalid.includedForbidden, ["/content-calendar/page"]);
});

test("production release guard rejects any unexpected route addition or removal", () => {
  assert.ok(ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE.includes(
    "/api/internal/job-admission-preflight/route",
  ));
  assert.ok(ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE.includes(
    "/purchase-terms/versions/7/page",
  ));
  assert.ok(ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE.includes(
    "/api/enterprise-pay/[token]/billing/items/[itemId]/charge/route",
  ));
  assert.ok(ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE.includes(
    "/api/projects/route",
  ));
  assert.ok(ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE.includes(
    "/api/admin/overview/route",
  ));
  assert.ok(ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE.includes(
    "/api/admin/billing/supporting-data/route",
  ));
  assert.deepEqual(
    compareManifestRoutes(PROTECTED_APP_ROUTES, [...PROTECTED_APP_ROUTES]),
    { added: [], removed: [] },
  );
  assert.deepEqual(
    compareManifestRoutes(
      [...PROTECTED_APP_ROUTES.slice(1), "/content-calendar/page"],
      PROTECTED_APP_ROUTES,
    ),
    { added: ["/content-calendar/page"], removed: [PROTECTED_APP_ROUTES[0]] },
  );
  assert.deepEqual(
    compareManifestRoutes(
      [...PROTECTED_APP_ROUTES, ...ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE],
      PROTECTED_APP_ROUTES,
      ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE,
    ),
    { added: [], removed: [] },
  );
  assert.deepEqual(
    compareManifestRoutes(
      [...PROTECTED_APP_ROUTES, "/api/unexpected/route"],
      PROTECTED_APP_ROUTES,
      ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE,
    ),
    { added: ["/api/unexpected/route"], removed: [] },
  );
});

test("custom backgrounds add only the collection and private asset routes", () => {
  const additions = ["/api/background-assets/route", "/api/background-assets/[assetId]/route"];
  assert.deepEqual(ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE.filter((route) => route.startsWith("/api/background-assets")), additions);
  assert.deepEqual(compareManifestRoutes(
    [...PROTECTED_APP_ROUTES, ...additions], PROTECTED_APP_ROUTES, additions,
  ), { added: [], removed: [] });
  assert.deepEqual(compareManifestRoutes(
    [...PROTECTED_APP_ROUTES, ...additions, "/api/background-assets/public/route"],
    PROTECTED_APP_ROUTES, ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE,
  ), { added: ["/api/background-assets/public/route"], removed: [] });
});

test("discovery rollout permits its five exact routes and keeps publishing blocked", () => {
  const additions = [
    "/api/admin/youtube-discovery/route",
    "/api/admin/youtube-discovery/backfill/route",
    "/api/cron/youtube-discovery/route",
    "/api/youtube/popular/calendar/route",
    "/api/youtube/popular/status/route",
  ];
  assert.deepEqual(compareManifestRoutes(
    [...PROTECTED_APP_ROUTES, ...additions], PROTECTED_APP_ROUTES,
    ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE,
  ), { added: [], removed: [] });
  assert.deepEqual(compareManifestRoutes(
    [...PROTECTED_APP_ROUTES, "/api/youtube/oauth/route", "/api/admin/youtube-discovery/delete/route"],
    PROTECTED_APP_ROUTES, ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE,
  ), { added: ["/api/admin/youtube-discovery/delete/route", "/api/youtube/oauth/route"], removed: [] });
});
