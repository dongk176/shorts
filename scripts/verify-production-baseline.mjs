#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateTrackedFiles } from "./verify-production-release.mjs";

const REQUIRED_SOURCE_ROUTES = [
  "web/app/page.tsx",
  "web/app/guidebook/page.tsx",
  "web/app/pricing/page.tsx",
  "web/app/admin/easycutcutcutcutcutcut/page.tsx",
  "web/app/projects/[projectNumber]/edit/[shortId]/page.tsx",
];

function digest(algorithm, value) {
  return crypto.createHash(algorithm).update(value).digest("hex");
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function extractSqlFunctionBody(sql, name) {
  const marker = `create or replace function shorts_mvp.${name}(`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`마이그레이션에 ${name} 함수가 없습니다.`);
  const bodyStart = sql.indexOf("as $$", start);
  const bodyEnd = sql.indexOf("$$;", bodyStart + 5);
  if (bodyStart < 0 || bodyEnd < 0) {
    throw new Error(`${name} 함수 본문을 읽을 수 없습니다.`);
  }
  return sql.slice(bodyStart + 5, bodyEnd);
}

export function verifyBaselineFiles(root = process.cwd()) {
  const manifestPath = resolve(root, "production-baseline.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  for (const route of REQUIRED_SOURCE_ROUTES) {
    if (!existsSync(resolve(root, route))) {
      throw new Error(`보호 경로 소스가 없습니다: ${route}`);
    }
  }

  const trackedFiles = git(["-C", root, "ls-files"])
    .split("\n")
    .filter(Boolean);
  const forbiddenFiles = validateTrackedFiles(trackedFiles);
  if (forbiddenFiles.length) {
    throw new Error(`미완성 게시 기능이 기준선에 포함됐습니다: ${forbiddenFiles.join(", ")}`);
  }

  git(["-C", root, "cat-file", "-e", `${manifest.web.gitSha}^{commit}`]);
  git(["-C", root, "merge-base", "--is-ancestor", manifest.web.gitSha, "HEAD"]);

  const hashedFiles = [
    ["production-worker-release.json", "workerReleaseManifestSha256"],
    ["production-project-targets.json", "projectTargetsManifestSha256"],
    [manifest.sourceFiles.ingestionDatabaseMigration, "ingestionDatabaseMigrationSha256"],
  ];
  for (const [relativePath, manifestKey] of hashedFiles) {
    const actual = digest("sha256", readFileSync(resolve(root, relativePath)));
    const expected = manifest.sourceFiles[manifestKey];
    if (actual !== expected) {
      throw new Error(`${relativePath} SHA-256 불일치: ${actual}`);
    }
  }

  const workerRelease = JSON.parse(
    readFileSync(resolve(root, "production-worker-release.json"), "utf8"),
  );
  if (workerRelease.workerSourceGitSha !== manifest.aws.projectWorker.sourceGitSha) {
    throw new Error("프로젝트 Worker 소스 SHA가 기준선과 다릅니다.");
  }
  if (workerRelease.imageDigest !== manifest.aws.projectWorker.imageDigest) {
    throw new Error("프로젝트 Worker 이미지 digest가 기준선과 다릅니다.");
  }

  const migration = readFileSync(
    resolve(root, manifest.sourceFiles.ingestionDatabaseMigration),
    "utf8",
  );
  for (const [signature, expected] of Object.entries(manifest.database.functionBodyMd5)) {
    const name = signature.slice(0, signature.indexOf("("));
    const actual = digest("md5", extractSqlFunctionBody(migration, name));
    if (actual !== expected) {
      throw new Error(`${signature} 운영 본문 지문 불일치: ${actual}`);
    }
  }

  return manifest;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  try {
    const manifest = verifyBaselineFiles();
    process.stdout.write([
      "운영 기준선 파일 검사 통과",
      `운영 웹 SHA: ${manifest.web.gitSha}`,
      `운영 Vercel 배포: ${manifest.web.deploymentId}`,
      `프로젝트 Worker 이미지: ${manifest.aws.projectWorker.imageDigest}`,
      `파일 업로드 이미지: ${manifest.aws.fileUploadReceiver.imageDigest}`,
      "",
    ].join("\n"));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
