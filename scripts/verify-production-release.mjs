#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PROTECTED_APP_ROUTES = [
  "/page",
  "/guidebook/page",
  "/pricing/page",
  "/projects/page",
  "/account/activity/page",
  "/billing/checkout/page",
  "/billing/success/page",
  "/purchase-terms/page",
  "/refund/page",
  "/settings/page",
  "/admin/easycutcutcutcutcutcut/page",
  "/projects/[projectNumber]/edit/[shortId]/page",
  "/api/file-upload/sessions/route",
  "/api/file-upload/sessions/[sessionId]/route",
  "/api/projects/[projectNumber]/source-thumbnail/route",
];

// These routes are the only intentional additions relative to the currently
// promoted production manifest. Everything else must still fail closed.
export const ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE = [
  "/api/file-upload/sessions/route",
  "/api/file-upload/sessions/[sessionId]/route",
  "/api/projects/[projectNumber]/source-thumbnail/route",
];

export const FORBIDDEN_PRODUCTION_PATHS = [
  "web/app/content-calendar/",
  "web/app/api/youtube/connections/",
  "web/app/api/youtube/oauth/",
  "web/app/api/youtube/publications/",
  "web/components/youtube-share-dialog.tsx",
  "web/lib/youtube-publishing",
  "supabase/test-migrations/202608030001",
  "infra/aws/lib/youtube-test-stack.ts",
  "worker/youtube_uploader/",
  "worker/Dockerfile.youtube-uploader",
];

export const FORBIDDEN_APP_ROUTES = [
  "/content-calendar/page",
  "/api/youtube/connections/route",
  "/api/youtube/oauth/start/route",
  "/api/youtube/oauth/callback/route",
  "/api/youtube/publications/route",
];

export function validateTrackedFiles(trackedFiles) {
  return FORBIDDEN_PRODUCTION_PATHS.filter((forbidden) => (
    trackedFiles.some((file) => file === forbidden || file.startsWith(forbidden))
  ));
}

export function validateManifestRoutes(routeNames) {
  const routeSet = new Set(routeNames);
  return {
    missingProtected: PROTECTED_APP_ROUTES.filter((route) => !routeSet.has(route)),
    includedForbidden: FORBIDDEN_APP_ROUTES.filter((route) => routeSet.has(route)),
  };
}

export function compareManifestRoutes(
  candidateRouteNames,
  baselineRouteNames,
  allowedAdditions = [],
) {
  const candidate = new Set(candidateRouteNames);
  const baseline = new Set(baselineRouteNames);
  const allowed = new Set(allowedAdditions);
  return {
    added: [...candidate]
      .filter((route) => !baseline.has(route) && !allowed.has(route))
      .sort(),
    removed: [...baseline].filter((route) => !candidate.has(route)).sort(),
  };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function parseArgs(argv) {
  const options = {
    base: "",
    manifest: "web/.next/server/app-paths-manifest.json",
    baselineManifest: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base") options.base = argv[index + 1] || "";
    if (argv[index] === "--manifest") options.manifest = argv[index + 1] || options.manifest;
    if (argv[index] === "--baseline-manifest") {
      options.baselineManifest = argv[index + 1] || "";
    }
  }
  if (!options.base) throw new Error("--base <현재 운영 Git SHA>가 필요합니다.");
  if (!options.baselineManifest) {
    throw new Error("--baseline-manifest <현재 운영 경로 manifest>가 필요합니다.");
  }
  return options;
}

export function runReleaseVerification(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    throw new Error(`커밋되지 않은 파일이 있어 배포를 중단합니다.\n${dirty}`);
  }

  execFileSync("git", ["merge-base", "--is-ancestor", options.base, "HEAD"]);
  const trackedFiles = git(["ls-files"]).split("\n").filter(Boolean);
  const forbiddenFiles = validateTrackedFiles(trackedFiles);
  if (forbiddenFiles.length) {
    throw new Error(`개발 중인 콘텐츠 캘린더 파일이 포함되어 배포를 중단합니다.\n${forbiddenFiles.join("\n")}`);
  }

  const manifestPath = resolve(options.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const manifestResult = validateManifestRoutes(Object.keys(manifest));
  if (manifestResult.missingProtected.length) {
    throw new Error(`보호 경로가 빌드에서 사라져 배포를 중단합니다.\n${manifestResult.missingProtected.join("\n")}`);
  }
  if (manifestResult.includedForbidden.length) {
    throw new Error(`개발 중인 콘텐츠 캘린더 경로가 빌드되어 배포를 중단합니다.\n${manifestResult.includedForbidden.join("\n")}`);
  }
  const baselineManifest = JSON.parse(
    readFileSync(resolve(options.baselineManifest), "utf8"),
  );
  const routeDiff = compareManifestRoutes(
    Object.keys(manifest),
    Object.keys(baselineManifest),
    ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE,
  );
  if (routeDiff.added.length || routeDiff.removed.length) {
    throw new Error([
      "현재 운영과 후보의 경로 목록이 달라 배포를 중단합니다.",
      ...routeDiff.added.map((route) => `추가: ${route}`),
      ...routeDiff.removed.map((route) => `삭제: ${route}`),
    ].join("\n"));
  }

  const changedFiles = git(["diff", "--name-status", `${options.base}...HEAD`]);
  process.stdout.write([
    "운영 배포 안전 검사 통과",
    `기준 SHA: ${options.base}`,
    `후보 SHA: ${git(["rev-parse", "HEAD"])}`,
    "변경 파일:",
    changedFiles || "(없음)",
    "",
  ].join("\n"));
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  try {
    runReleaseVerification();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
