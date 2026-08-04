#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_SMOKE_PATHS,
  buildRouteInventory,
  compareRoutes,
  compareTreeInventories,
  extractDeploymentInfo,
  findDisallowedWebReleaseFiles,
  findForbiddenPublishingReferences,
  makeProductionTagName,
  validateRepositoryFacts,
} from "./release-production-policy.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BOOTSTRAP_PATH = resolve(ROOT, ".release/production-baseline.json");
const LINK_PATH = resolve(ROOT, ".vercel/project.json");

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: options.timeout ?? 30 * 60 * 1000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(`${command} ${args.join(" ")} 실패${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function capture(command, args, options = {}) {
  return run(command, args, { ...options, capture: true }).stdout.trim();
}

function git(args, options = {}) {
  return capture("git", args, options);
}

function parseArgs(argv) {
  const unknown = argv.filter((arg) => arg !== "--dry-run" && arg !== "--");
  if (unknown.length) fail(`알 수 없는 옵션입니다: ${unknown.join(" ")}`);
  return { dryRun: argv.includes("--dry-run") };
}

function parseJsonOutput(output, label) {
  const text = output.trim();
  const attempts = [text, ...text.split("\n").reverse()];
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) attempts.push(text.slice(firstBrace, lastBrace + 1));
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying because the Vercel CLI can print notices around JSON.
    }
  }
  fail(`${label} JSON을 해석하지 못했습니다.\n${text.slice(0, 2000)}`);
}

function readBootstrap() {
  if (!existsSync(BOOTSTRAP_PATH)) fail(`${BOOTSTRAP_PATH}가 없습니다.`);
  return JSON.parse(readFileSync(BOOTSTRAP_PATH, "utf8"));
}

function readLatestProductionRecord(bootstrap) {
  const tags = git(["tag", "--list", "prod-*", "--sort=-creatordate"])
    .split("\n")
    .filter(Boolean);
  if (!tags.length) return { ...bootstrap, source: "bootstrap" };

  const tag = tags[0];
  const commit = git(["rev-list", "-n", "1", tag]);
  const contents = git(["tag", "--list", tag, "--format=%(contents)"]);
  const start = contents.indexOf("{");
  const end = contents.lastIndexOf("}");
  if (start < 0 || end <= start) fail(`${tag} 태그에 배포 JSON 기록이 없습니다.`);
  const record = JSON.parse(contents.slice(start, end + 1));
  if (record.commit !== commit) fail(`${tag}의 커밋 기록이 실제 태그 커밋과 다릅니다.`);
  return {
    ...bootstrap,
    ...record,
    commit,
    tag,
    source: "tag",
  };
}

function ensureProjectLink(config) {
  mkdirSync(resolve(ROOT, ".vercel"), { recursive: true });
  const expected = {
    orgId: config.vercel.orgId,
    projectId: config.vercel.projectId,
    projectName: config.vercel.projectName,
  };
  if (existsSync(LINK_PATH)) {
    const current = JSON.parse(readFileSync(LINK_PATH, "utf8"));
    if (current.orgId !== expected.orgId || current.projectId !== expected.projectId) {
      fail("현재 .vercel 연결이 EasyCut 운영 프로젝트와 다릅니다.");
    }
    return;
  }
  writeFileSync(LINK_PATH, `${JSON.stringify(expected, null, 2)}\n`, { mode: 0o600 });
}

function inspectDeployment(target, scope, wait = false) {
  const args = ["inspect", target, "--format=json", "--scope", scope];
  if (wait) args.push("--wait", "--timeout", "10m");
  const output = capture("vercel", args, { timeout: 11 * 60 * 1000 });
  const parsed = parseJsonOutput(output, `Vercel inspect ${target}`);
  const info = extractDeploymentInfo(parsed);
  if (!info.deploymentId) fail(`${target}에서 Vercel deployment ID를 찾지 못했습니다.`);
  return { ...info, raw: parsed };
}

function verifyProductionDomains(record, bootstrap) {
  const results = bootstrap.productionDomains.map((domain) => ({
    domain,
    ...inspectDeployment(domain, bootstrap.vercel.scope),
  }));
  const unexpected = results.filter((result) => result.deploymentId !== record.deploymentId);
  if (unexpected.length) {
    fail([
      "현재 운영 별칭이 기록된 운영 배포와 다릅니다. 다른 배포가 진행됐을 수 있어 중단합니다.",
      `기록: ${record.deploymentId}`,
      ...results.map((result) => `${result.domain}: ${result.deploymentId}`),
    ].join("\n"));
  }
  return results;
}

function repositoryFacts(baselineCommit) {
  const branch = git(["symbolic-ref", "--short", "-q", "HEAD"], { allowFailure: true });
  const ancestor = run("git", ["merge-base", "--is-ancestor", baselineCommit, "HEAD"], {
    capture: true,
    allowFailure: true,
  });
  const upstreamResult = run("git", ["rev-parse", "@{upstream}"], {
    capture: true,
    allowFailure: true,
  });
  return {
    dirty: Boolean(git(["status", "--porcelain", "--untracked-files=all"])),
    branch,
    baselineIsAncestor: ancestor.status === 0,
    commitsAhead: Number(git(["rev-list", "--count", `${baselineCommit}..HEAD`])),
    head: git(["rev-parse", "HEAD"]),
    upstream: upstreamResult.status === 0 ? upstreamResult.stdout.trim() : "",
  };
}

function assertRepositoryReady(baselineCommit, expectedHead = "") {
  const facts = repositoryFacts(baselineCommit);
  const errors = validateRepositoryFacts(facts);
  if (expectedHead && facts.head !== expectedHead) errors.push("검증 중 Git SHA가 변경됐습니다.");
  if (errors.length) fail(errors.join("\n"));
  return facts;
}

function parseTreeInventory(commit) {
  const output = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", commit], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const inventory = new Map();
  for (const record of output.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const metadata = record.slice(0, tab);
    const file = record.slice(tab + 1);
    inventory.set(file, metadata);
  }
  return inventory;
}

function nulList(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function verifyWholeSourceAndRoutes(baselineCommit, head) {
  const baselineTree = parseTreeInventory(baselineCommit);
  const candidateTree = parseTreeInventory(head);
  const declaredChanged = nulList(["diff", "--name-only", "-z", baselineCommit, head]);
  const treeResult = compareTreeInventories(baselineTree, candidateTree, declaredChanged);
  if (treeResult.undeclared.length || treeResult.phantom.length) {
    fail([
      "전체 소스 트리 해시와 Git diff가 일치하지 않습니다.",
      `diff에 없는 변경: ${treeResult.undeclared.join(", ") || "없음"}`,
      `실제 트리에 없는 diff: ${treeResult.phantom.join(", ") || "없음"}`,
    ].join("\n"));
  }

  const disallowed = findDisallowedWebReleaseFiles(treeResult.actualChanged);
  if (disallowed.length) {
    fail(`웹 배포와 분리해야 하는 파일이 포함됐습니다.\n${disallowed.join("\n")}`);
  }

  const publishingReferences = findForbiddenPublishingReferences(
    treeResult.actualChanged
      .filter((file) => candidateTree.has(file))
      .map((file) => ({ file, content: git(["show", `${head}:${file}`]) })),
  );
  if (publishingReferences.length) {
    fail(`개발 중인 콘텐츠 캘린더·YouTube 게시 코드가 포함됐습니다.\n${publishingReferences.join("\n")}`);
  }

  const baselineRoutes = buildRouteInventory([...baselineTree.keys()]);
  const candidateRoutes = buildRouteInventory([...candidateTree.keys()]);
  const routeResult = compareRoutes(baselineRoutes, candidateRoutes);
  if (routeResult.missing.length || routeResult.forbidden.length) {
    fail([
      routeResult.missing.length ? `사라진 운영 라우트:\n${routeResult.missing.join("\n")}` : "",
      routeResult.forbidden.length ? `금지된 개발 라우트:\n${routeResult.forbidden.join("\n")}` : "",
    ].filter(Boolean).join("\n"));
  }

  process.stdout.write([
    "\n전체 소스·라우트 비교 통과",
    `운영 파일: ${baselineTree.size}개`,
    `후보 파일: ${candidateTree.size}개`,
    `의도된 변경: ${treeResult.actualChanged.length}개`,
    `운영 라우트: ${baselineRoutes.length}개`,
    `후보 라우트: ${candidateRoutes.length}개`,
    ...treeResult.actualChanged.map((file) => `  ${file}`),
    "",
  ].join("\n"));
  return { changedFiles: treeResult.actualChanged, baselineRoutes, candidateRoutes };
}

function smokeCandidate(candidateUrl) {
  for (const check of REQUIRED_SMOKE_PATHS) {
    const result = run("curl", [
      "--silent",
      "--show-error",
      "--location",
      "--output", "/dev/null",
      "--write-out", "%{http_code}",
      "--connect-timeout", "10",
      "--max-time", "45",
      `${candidateUrl}${check.path}`,
    ], { capture: true });
    const status = Number(result.stdout.trim());
    if (!check.statuses.includes(status)) {
      fail(`${check.path} 후보 점검 실패: HTTP ${status} (허용 ${check.statuses.join(", ")})`);
    }
    process.stdout.write(`  HTTP ${status} ${check.path}\n`);
  }
}

function verifyNoCandidate5xx(deploymentId, config) {
  const result = run("vercel", [
    "logs", deploymentId,
    "--status-code", "5xx",
    "--since", "15m",
    "--limit", "50",
    "--json",
    "--scope", config.vercel.scope,
  ], { capture: true, allowFailure: true, timeout: 2 * 60 * 1000 });
  const output = result.stdout.trim();
  if (result.status !== 0) {
    fail(`후보 5xx 로그 조회 실패\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
  }
  if (output) fail(`후보 배포에서 5xx 로그가 발견됐습니다.\n${output.slice(0, 5000)}`);
}

function deployCandidate(head, config) {
  const result = run("vercel", [
    "deploy", ".",
    "--prod",
    "--skip-domain",
    "--yes",
    "--format", "json",
    "--meta", `easycutReleaseCommit=${head}`,
    "--scope", config.vercel.scope,
  ], { capture: true, timeout: 30 * 60 * 1000 });
  const parsed = parseJsonOutput(result.stdout, "Vercel candidate deploy");
  const info = extractDeploymentInfo(parsed);
  if (!info.deploymentId || !info.deploymentUrl) {
    fail(`후보 배포 ID 또는 URL을 찾지 못했습니다.\n${result.stdout.slice(0, 3000)}`);
  }
  return info;
}

function promoteCandidate(candidate, baseline, config) {
  run("vercel", [
    "promote", candidate.deploymentId,
    "--yes",
    "--timeout", "10m",
    "--scope", config.vercel.scope,
  ], { timeout: 11 * 60 * 1000 });

  const mismatched = config.productionDomains
    .map((domain) => ({ domain, ...inspectDeployment(domain, config.vercel.scope) }))
    .filter((result) => result.deploymentId !== candidate.deploymentId);
  if (mismatched.length) {
    fail([
      "승격 후 운영 별칭이 검증한 후보와 다릅니다.",
      `후보: ${candidate.deploymentId}`,
      ...mismatched.map((result) => `${result.domain}: ${result.deploymentId}`),
    ].join("\n"));
  }

  const head = git(["rev-parse", "HEAD"]);
  const promotedAt = new Date();
  const tag = makeProductionTagName(promotedAt, head);
  const record = {
    commit: head,
    deploymentId: candidate.deploymentId,
    deploymentUrl: candidate.deploymentUrl,
    previousDeploymentId: baseline.deploymentId,
    promotedAt: promotedAt.toISOString(),
  };
  run("git", ["tag", "-a", tag, "-m", JSON.stringify(record)]);
  run("git", ["push", "origin", tag]);
  return tag;
}

export function runProductionRelease(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const bootstrap = readBootstrap();
  ensureProjectLink(bootstrap);

  process.stdout.write("운영 태그와 원격 브랜치를 동기화합니다.\n");
  run("git", ["fetch", "--tags", "origin"]);
  const baseline = readLatestProductionRecord(bootstrap);
  verifyProductionDomains(baseline, bootstrap);

  const facts = assertRepositoryReady(baseline.commit);
  const head = facts.head;
  verifyWholeSourceAndRoutes(baseline.commit, head);

  process.stdout.write("\n전체 정적 검사·테스트·빌드를 실행합니다.\n");
  run("make", ["verify"]);
  run("node", ["scripts/verify-production-release.mjs", "--base", baseline.commit]);
  assertRepositoryReady(baseline.commit, head);

  if (options.dryRun) {
    process.stdout.write([
      "\n운영 배포 dry-run 통과",
      `현재 운영: ${baseline.deploymentId} (${baseline.commit})`,
      `검증 후보 SHA: ${head}`,
      "Vercel 후보 배포와 운영 승격은 실행하지 않았습니다.",
      "",
    ].join("\n"));
    return;
  }

  process.stdout.write("\n운영 별칭 없는 후보를 배포합니다.\n");
  const candidate = deployCandidate(head, bootstrap);
  const inspected = inspectDeployment(candidate.deploymentId, bootstrap.vercel.scope, true);
  if (inspected.deploymentId !== candidate.deploymentId) fail("후보 inspect 결과의 deployment ID가 다릅니다.");

  process.stdout.write(`\n후보 점검: ${candidate.deploymentUrl}\n`);
  smokeCandidate(candidate.deploymentUrl);
  verifyNoCandidate5xx(candidate.deploymentId, bootstrap);

  assertRepositoryReady(baseline.commit, head);
  verifyProductionDomains(baseline, bootstrap);

  process.stdout.write(`\n검증한 동일 후보 ${candidate.deploymentId}를 운영으로 승격합니다.\n`);
  const tag = promoteCandidate(candidate, baseline, bootstrap);
  smokeCandidate("https://easycut.co.kr");
  verifyNoCandidate5xx(candidate.deploymentId, bootstrap);

  process.stdout.write([
    "\n운영 배포 완료",
    `Git SHA: ${head}`,
    `Vercel deployment: ${candidate.deploymentId}`,
    `운영 태그: ${tag}`,
    "",
  ].join("\n"));
}

try {
  runProductionRelease();
} catch (error) {
  process.stderr.write(`\n운영 배포 중단: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
