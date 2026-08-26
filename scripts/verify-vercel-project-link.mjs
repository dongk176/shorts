#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function requiredString(value, label) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${label}을(를) 확인할 수 없습니다.`);
  return result;
}

export function validateVercelProjectLink(linkValue, liveValue, expectedName) {
  if (!linkValue || typeof linkValue !== "object" || Array.isArray(linkValue)) {
    throw new Error("Vercel 로컬 project link 형식이 올바르지 않습니다.");
  }
  if (!liveValue || typeof liveValue !== "object" || Array.isArray(liveValue)) {
    throw new Error("Vercel live project API 응답 형식이 올바르지 않습니다.");
  }
  const expectedProjectName = requiredString(expectedName, "예상 projectName");
  const live = {
    projectName: requiredString(liveValue.name, "live project name"),
    projectId: requiredString(liveValue.id, "live project id"),
    orgId: requiredString(liveValue.accountId, "live project accountId"),
  };
  const link = {
    projectName: requiredString(linkValue.projectName, "linked projectName"),
    projectId: requiredString(linkValue.projectId, "linked projectId"),
    orgId: requiredString(linkValue.orgId, "linked orgId"),
  };
  if (live.projectName !== expectedProjectName) {
    throw new Error(
      `Vercel live project name이 기대값과 다릅니다: expected=${expectedProjectName} actual=${live.projectName}`,
    );
  }
  for (const field of ["projectName", "projectId", "orgId"]) {
    if (link[field] !== live[field]) {
      throw new Error(
        `Vercel 로컬 링크의 ${field}가 live project와 다릅니다.`,
      );
    }
  }
  return link;
}

function parseArgs(argv) {
  const options = { link: "", live: "", expectedName: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--link") options.link = argv[++index] || "";
    else if (argv[index] === "--live") options.live = argv[++index] || "";
    else if (argv[index] === "--expected-name") options.expectedName = argv[++index] || "";
    else throw new Error(`알 수 없는 옵션입니다: ${argv[index]}`);
  }
  for (const [name, value] of Object.entries(options)) {
    if (!value) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}가 필요합니다.`);
  }
  return options;
}

function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const link = JSON.parse(fs.readFileSync(path.resolve(options.link), "utf8"));
  const live = JSON.parse(fs.readFileSync(path.resolve(options.live), "utf8"));
  const validated = validateVercelProjectLink(link, live, options.expectedName);
  process.stdout.write(
    `Vercel project link 검증 완료: ${validated.projectName} (${validated.projectId})\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
