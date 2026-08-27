#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROJECT_TARGET_LANES,
  readProductionProjectTargets,
} from "./production-project-targets.mjs";

export function currentProjectTargetNames(registry = null) {
  return Object.entries(PROJECT_TARGET_LANES).flatMap(([lane, prefix]) => {
    const names = [
      `${prefix}_JOB_DEFINITION_ARN`,
      `${prefix}_BATCH_QUEUE_ARN`,
      `${prefix}_BATCH_TARGET_RELEASE_ID`,
      `${prefix}_WORKER_SOURCE_GIT_SHA`,
      `${prefix}_WORKER_IMAGE_DIGEST`,
    ];
    if (registry?.lanes?.[lane]?.current?.renderSpecVersion === 4) {
      names.push(
        `${prefix}_RENDER_SPEC_VERSION`,
        `${prefix}_CAPTION_RENDER_SPEC_VERSION`,
        `${prefix}_FONT_MANIFEST_SHA256`,
      );
    }
    return names;
  });
}

export function optionalProjectTargetNames() {
  return Object.values(PROJECT_TARGET_LANES).flatMap((prefix) => [
    `${prefix}_RENDER_SPEC_VERSION`,
    `${prefix}_CAPTION_RENDER_SPEC_VERSION`,
    `${prefix}_FONT_MANIFEST_SHA256`,
  ]);
}

export function staleOptionalProjectTargetNames(rows, registry) {
  if (!Array.isArray(rows)) {
    throw new Error("Vercel 프로젝트 환경변수 목록을 확인할 수 없습니다.");
  }
  const expected = new Set(currentProjectTargetNames(registry));
  return optionalProjectTargetNames().filter((name) => {
    if (expected.has(name)) return false;
    const matches = rows.filter((row) => (
      row?.key === name
      && Array.isArray(row.target)
      && row.target.includes("production")
    ));
    if (matches.length > 1) {
      throw new Error(`${name}의 stale Production 변수가 중복되어 있습니다.`);
    }
    if (matches.length === 0) return false;
    const [row] = matches;
    if (
      row.target.length !== 1
      || row.target[0] !== "production"
      || row.type !== "sensitive"
      || !/^[A-Za-z0-9_-]{8,}$/.test(String(row.id || ""))
    ) {
      throw new Error(`${name}의 stale Vercel 범위·타입·ID가 안전한 삭제 계약과 다릅니다.`);
    }
    return true;
  });
}

export function validateVercelProjectTargetMetadata(rows, registry = null) {
  if (!Array.isArray(rows)) {
    throw new Error("Vercel 프로젝트 환경변수 목록을 확인할 수 없습니다.");
  }
  const ids = {};
  for (const name of currentProjectTargetNames(registry)) {
    const matches = rows.filter((row) => (
      row?.key === name
      && Array.isArray(row.target)
      && row.target.includes("production")
    ));
    if (matches.length !== 1) {
      throw new Error(`${name} Production 변수가 정확히 하나가 아닙니다.`);
    }
    const [row] = matches;
    if (
      row.target.length !== 1
      || row.target[0] !== "production"
      || row.type !== "sensitive"
      || !/^[A-Za-z0-9_-]{8,}$/.test(String(row.id || ""))
    ) {
      throw new Error(`${name}의 Vercel 범위·타입·ID가 고정 계약과 다릅니다.`);
    }
    ids[name] = row.id;
  }
  const stale = staleOptionalProjectTargetNames(rows, registry);
  if (stale.length) {
    throw new Error(`legacy 대상에 stale v4 변수가 남아 있습니다: ${stale.join(",")}`);
  }
  return ids;
}

function parseArgs(argv) {
  const options = {
    project: "",
    scope: "",
    registry: "production-project-targets.json",
    printStaleOptional: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--project") options.project = argv[++index] || "";
    else if (argv[index] === "--scope") options.scope = argv[++index] || "";
    else if (argv[index] === "--registry") options.registry = argv[++index] || "";
    else if (argv[index] === "--print-stale-optional") options.printStaleOptional = true;
    else throw new Error(`알 수 없는 옵션입니다: ${argv[index]}`);
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(options.project)) {
    throw new Error("--project 값이 올바르지 않습니다.");
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(options.scope)) {
    throw new Error("--scope 값이 올바르지 않습니다.");
  }
  if (!options.registry) throw new Error("--registry 값이 필요합니다.");
  return options;
}

export function runVercelProjectTargetMetadataVerification(
  argv = process.argv.slice(2),
) {
  const options = parseArgs(argv);
  const registry = readProductionProjectTargets(path.resolve(options.registry));
  const response = JSON.parse(execFileSync("vercel", [
    "api",
    `/v10/projects/${encodeURIComponent(options.project)}/env`,
    "--raw",
    "--scope",
    options.scope,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  if (options.printStaleOptional) {
    process.stdout.write(
      `${staleOptionalProjectTargetNames(response?.envs, registry).join("\n")}\n`,
    );
    return;
  }
  validateVercelProjectTargetMetadata(response?.envs, registry);
  process.stdout.write(
    `Vercel Production Batch 대상 metadata 검증 완료: ${currentProjectTargetNames(registry).length}개\n`,
  );
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runVercelProjectTargetMetadataVerification();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
