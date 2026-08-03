import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTECTED_APP_ROUTES,
  validateManifestRoutes,
  validateTrackedFiles,
} from "./verify-production-release.mjs";

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
