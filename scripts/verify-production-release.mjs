#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PROTECTED_APP_ROUTES = [
  "/page",
  "/guidebook/page",
  "/pricing/page",
  "/templates/page",
  "/projects/page",
  "/account/activity/page",
  "/billing/checkout/page",
  "/billing/success/page",
  "/purchase-terms/page",
  "/refund/page",
  "/settings/page",
  "/admin/easycutcutcutcutcutcut/page",
  "/projects/[projectNumber]/edit/[shortId]/page",
  "/enterprise-pay/[token]/page",
  "/enterprise-pay/[token]/billing/success/page",
  "/enterprise-pay/[token]/billing/fail/page",
  "/enterprise/purchase-terms/page",
  "/enterprise/purchase-terms/versions/1/page",
  "/enterprise/refund-policy/page",
  "/enterprise/refund-policy/versions/1/page",
  "/api/enterprise-pay/[token]/consent/route",
  "/api/enterprise-pay/[token]/billing/registration/prepare/route",
  "/api/enterprise-pay/[token]/billing/registration/complete/route",
  "/api/enterprise-pay/[token]/billing/registration/fail/route",
  "/api/enterprise-pay/[token]/billing/items/[itemId]/charge/route",
  "/api/file-upload/sessions/route",
  "/api/file-upload/sessions/[sessionId]/route",
  "/api/projects/[projectNumber]/source-thumbnail/route",
  "/api/projects/route",
  "/api/admin/overview/route",
  "/api/admin/billing/supporting-data/route",
];

// These routes are the only intentional additions relative to the currently
// promoted production manifest. Everything else must still fail closed.
export const ALLOWED_ROUTE_ADDITIONS_FROM_BASELINE = [
  // Read-only administrator PayPal configuration verification.
  "/api/admin/paypal/diagnostics/route",
  // Independent PayPal recovery must not wait for other billing providers.
  "/api/cron/paypal-reconciliation/route",
  // User-approved PayPal international checkout (2026-11-01).
  "/api/paypal/checkout/route",
  "/api/paypal/subscription/route",
  "/api/paypal/webhook/route",
  "/billing/paypal/page",
  "/en/billing/paypal/page",
  "/jp/billing/paypal/page",
  // User-requested English ranking workspace (2026-10-30).
  "/en/ranking-shorts/page",
  // User-requested feedback for the owner's completed ranking videos (2026-10-27).
  "/api/ranking-shorts/[projectId]/feedback/route",
  "/api/ranking-shorts/welcome/route",
  // Overseas-only period graphs use the existing restricted role.
  "/api/admin/overseas/trends/route",
  // User-requested overseas-only administrator console and login (2026-10-27).
  "/admin/easycutcutcutcutcutcut/overseas/page",
  "/admin/easycutcutcutcutcutcut/overseas/login/page",
  // User-authorized administrator-only related Shorts search and bounded indexer (2026-10-26).
  "/api/ranking-shorts/discover/route",
  "/api/cron/ranking-search-index/route",
  // User-authorized administrator-only ranking shorts (2026-10-24).
  "/ranking-shorts/page",
  "/api/ranking-shorts/route",
  "/api/ranking-shorts/[projectId]/route",
  "/api/ranking-shorts/[projectId]/sources/route",
  "/api/ranking-shorts/[projectId]/sources/[sourceId]/preview/route",
  "/api/ranking-shorts/[projectId]/render/route",
  "/api/ranking-shorts/[projectId]/operations/[operationId]/route",
  "/api/ranking-shorts/[projectId]/media/[sourceId]/route",
  "/api/cron/ranking-completion-emails/route",
  // User-approved US/GB trending collector, 4-hour cadence (2026-10-15).
  "/api/cron/youtube-english/route",
  // User-approved update content management (2026-10-01).
  "/api/admin/updates/route",
  "/api/admin/updates/assets/route",
  "/api/updates/assets/[id]/route",
  "/api/updates/recent/route",
  // User-approved updates archive release (2026-09-30).
  "/updates/page",
  "/updates/[slug]/page",
  // Requested account-owned saved videos; DB promotion approval is tracked separately.
  "/saved-videos/page",
  "/en/saved-videos/page",
  "/jp/saved-videos/page",
  "/api/saved-videos/route",
  // Approved localized Shorts guide and paid workbook release (2026-09-27).
  "/shorts-monetization/page",
  "/en/shorts-monetization/page",
  "/jp/shorts-monetization/page",
  "/api/shorts-guides/[slug]/download/route",
  "/api/shorts-monetization/events/route",
  // Read-only Paddle admin summary (2026-09-27).
  "/api/admin/billing/paddle-summary/route",
  // Approved Paddle production rollout (2026-09-26): exact billing routes only.
  "/api/paddle/checkout/route",
  "/api/paddle/change/route",
  "/api/cron/paddle-plan-changes/route",
  "/api/paddle/portal/route",
  "/api/paddle/state/route",
  "/api/paddle/webhook/route",
  "/billing/paddle/page",
  "/en/billing/paddle/page",
  "/jp/billing/paddle/page",
  "/en/pricing/page",
  "/jp/pricing/page",
  "/en/settings/plan/page",
  "/jp/settings/plan/page",
  // Explicit YouTube reviewer account and owned fixture only (2026-09-22).
  "/api/youtube/accounts/[connectionId]/route",
  "/api/youtube/accounts/eligibility/route",
  "/api/youtube/accounts/maintenance/route",
  "/api/youtube/accounts/media/[shortId]/route",
  "/api/youtube/accounts/oauth/callback/route",
  "/api/youtube/accounts/oauth/start/route",
  "/api/youtube/accounts/route",
  "/api/youtube/accounts/uploads/[uploadId]/resume/route",
  "/api/youtube/accounts/uploads/route",
  "/api/cron/youtube-accounts/route",
  "/publish/channels/page",
  // Explicitly authorized administrator-only Instagram/Threads test release.
  "/api/social/[platform]/route",
  "/api/social/[platform]/connections/[connectionId]/route",
  "/api/social/[platform]/deauthorize/route",
  "/api/social/[platform]/media/[capability]/route",
  "/api/social/[platform]/oauth/callback/route",
  "/api/social/[platform]/oauth/start/route",
  "/api/social/[platform]/posts/route",
  "/api/social/[platform]/posts/[postId]/check/route",
  "/api/social/[platform]/preview/[shortId]/route",

  // Explicitly authorized administrator-only TikTok review release (2026-09-21).
  "/api/social/tiktok/connections/[connectionId]/route",
  "/api/social/tiktok/creator/route",
  "/api/social/tiktok/media/[capability]/route",
  "/api/social/tiktok/oauth/callback/route",
  "/api/social/tiktok/oauth/start/route",
  "/api/social/tiktok/posts/[postId]/check/route",
  "/api/social/tiktok/posts/route",
  "/api/social/tiktok/preview/[shortId]/route",
  "/api/social/tiktok/route",

  "/api/admin/expenses/route",
  "/api/admin/expenses/[id]/route",
  "/api/admin/expenses/[id]/receipts/[receiptId]/route",
  "/blog/page",
  "/blog/[slug]/page",
  "/api/site-metrics/route",
  "/api/admin/language-test/route",
  "/api/language-guide/route",
  "/api/creator-support/application/route",
  "/api/admin/creator-support/applications/route",
  "/api/projects/[projectNumber]/download/route",
  "/creator-support/page",
  "/api/admin/creator-support/route",
  "/api/creator-support/assets/route",
  "/api/creator-support/assets/[id]/route",
  "/api/creator-support/channel/route",
  "/api/creator-support/enroll/route",
  "/api/creator-support/me/route",
  "/api/creator-support/status/route",
  "/api/admin/youtube-discovery/route",
  "/api/admin/youtube-discovery/backfill/route",
  "/api/cron/youtube-discovery/route",
  "/api/cron/youtube-japan/route",
  "/api/youtube/popular/calendar/route",
  "/api/youtube/popular/status/route",
  "/api/background-assets/route",
  "/api/background-assets/[assetId]/route",
  "/api/projects/route",
  "/api/admin/overview/route",
  "/api/admin/trends/route",
  "/api/admin/billing/supporting-data/route",
  "/api/internal/job-admission-preflight/route",
  "/api/file-upload/sessions/route",
  "/api/file-upload/sessions/[sessionId]/route",
  "/api/projects/[projectNumber]/source-thumbnail/route",
  "/purchase-terms/versions/7/page",
  "/enterprise-pay/[token]/billing/success/page",
  "/enterprise-pay/[token]/billing/fail/page",
  "/enterprise/purchase-terms/page",
  "/enterprise/purchase-terms/versions/1/page",
  "/enterprise/refund-policy/page",
  "/enterprise/refund-policy/versions/1/page",
  "/api/enterprise-pay/[token]/consent/route",
  "/api/enterprise-pay/[token]/billing/registration/prepare/route",
  "/api/enterprise-pay/[token]/billing/registration/complete/route",
  "/api/enterprise-pay/[token]/billing/registration/fail/route",
  "/api/enterprise-pay/[token]/billing/items/[itemId]/charge/route",
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
