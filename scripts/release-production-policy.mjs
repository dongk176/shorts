export const DISALLOWED_WEB_RELEASE_PREFIXES = [
  "supabase/",
  "worker/",
  "infra/aws/",
];

export const DISALLOWED_WEB_RELEASE_FILES = new Set([
  ".github/workflows/deploy-worker.yml",
  "scripts/deploy-worker.sh",
]);

export const FORBIDDEN_PRODUCTION_ROUTE_PREFIXES = [
  "/content-calendar",
  "/api/youtube/connections",
  "/api/youtube/oauth",
  "/api/youtube/publications",
];

export const FORBIDDEN_PUBLISHING_REFERENCE = /(?:\/content-calendar|api\/youtube\/(?:connections|oauth|publications)|youtube[_-](?:channel_connections|publications|share)|EasyCutYoutubeTest|YOUTUBE_PUBLISHING_MODE)/i;

export const REQUIRED_SMOKE_PATHS = [
  { path: "/", statuses: [200] },
  { path: "/guidebook", statuses: [200] },
  { path: "/pricing", statuses: [200] },
  { path: "/projects", statuses: [200] },
  { path: "/admin/easycutcutcutcutcutcut", statuses: [200] },
  { path: "/billing/checkout", statuses: [200] },
  { path: "/refund", statuses: [200] },
  { path: "/api/mvp/state", statuses: [200] },
  { path: "/api/account/completion-email-preference", statuses: [200, 401, 403, 405] },
  { path: "/api/billing/installments?planCode=starter_3m", statuses: [200] },
];

export function appRouteFromFile(file) {
  const normalized = file.replaceAll("\\", "/");
  if (!normalized.startsWith("web/app/")) return null;
  if (!/(^|\/)(page|route)\.(?:js|jsx|ts|tsx)$/.test(normalized)) return null;

  const relative = normalized
    .slice("web/app/".length)
    .replace(/\/(?:page|route)\.(?:js|jsx|ts|tsx)$/, "")
    .replace(/^(?:page|route)\.(?:js|jsx|ts|tsx)$/, "");
  const segments = relative
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .filter((segment) => !segment.startsWith("@"));
  return `/${segments.join("/")}` || "/";
}

export function buildRouteInventory(files) {
  return [...new Set(files.map(appRouteFromFile).filter(Boolean))].sort();
}

export function compareRoutes(baselineRoutes, candidateRoutes) {
  const candidate = new Set(candidateRoutes);
  return {
    missing: baselineRoutes.filter((route) => !candidate.has(route)),
    forbidden: candidateRoutes.filter((route) => (
      FORBIDDEN_PRODUCTION_ROUTE_PREFIXES.some((prefix) => (
        route === prefix || route.startsWith(`${prefix}/`)
      ))
    )),
  };
}

export function findDisallowedWebReleaseFiles(changedFiles) {
  return changedFiles.filter((file) => (
    DISALLOWED_WEB_RELEASE_FILES.has(file)
    || DISALLOWED_WEB_RELEASE_PREFIXES.some((prefix) => file.startsWith(prefix))
  ));
}

export function findForbiddenPublishingReferences(entries) {
  return entries
    .filter(({ file, content }) => file.startsWith("web/") && FORBIDDEN_PUBLISHING_REFERENCE.test(content))
    .map(({ file }) => file);
}

export function compareTreeInventories(baseline, candidate, declaredChangedFiles) {
  const allPaths = new Set([...baseline.keys(), ...candidate.keys()]);
  const actualChanged = [...allPaths]
    .filter((file) => baseline.get(file) !== candidate.get(file))
    .sort();
  const declared = [...new Set(declaredChangedFiles)].sort();
  return {
    actualChanged,
    undeclared: actualChanged.filter((file) => !declared.includes(file)),
    phantom: declared.filter((file) => !actualChanged.includes(file)),
  };
}

export function validateRepositoryFacts(facts) {
  const errors = [];
  if (facts.dirty) errors.push("커밋되지 않은 변경이 있습니다.");
  if (!facts.branch || facts.branch === "HEAD") errors.push("detached HEAD에서는 배포할 수 없습니다.");
  if (!facts.baselineIsAncestor) errors.push("현재 브랜치가 운영 기준 커밋에서 시작하지 않았습니다.");
  if (facts.commitsAhead !== 1) {
    errors.push(`운영 기준 위에는 단일 릴리스 커밋만 허용됩니다. 현재 ${facts.commitsAhead}개입니다.`);
  }
  if (!facts.upstream || facts.head !== facts.upstream) {
    errors.push("현재 릴리스 커밋이 원격 브랜치에 푸시되지 않았습니다.");
  }
  return errors;
}

export function extractDeploymentInfo(value) {
  let deploymentId = "";
  let deploymentUrl = "";
  const visit = (node) => {
    if (deploymentId && deploymentUrl) return;
    if (typeof node === "string") {
      if (!deploymentId && /^dpl_[A-Za-z0-9]+$/.test(node)) deploymentId = node;
      if (!deploymentUrl && /^(?:https:\/\/)?[^\s]+\.vercel\.app\/?$/.test(node)) {
        deploymentUrl = node.startsWith("http") ? node.replace(/\/$/, "") : `https://${node.replace(/\/$/, "")}`;
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === "object") Object.values(node).forEach(visit);
  };
  visit(value);
  return { deploymentId, deploymentUrl };
}

export function makeProductionTagName(date, sha) {
  const timestamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `prod-${timestamp}-${sha.slice(0, 8)}`;
}
