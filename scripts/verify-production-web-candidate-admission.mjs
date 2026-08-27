#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  productionProjectTargetsFingerprint,
  readProductionProjectTargets,
} from "./production-project-targets.mjs";

function candidateOrigin(rawUrl) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:"
    || !url.hostname.endsWith(".vercel.app")
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("--url에는 검증할 무별칭 Vercel 후보의 HTTPS origin만 입력해야 합니다.");
  }
  return url.origin;
}

export async function verifyCandidateJobAdmission({
  url,
  registry,
  fetchImpl = fetch,
}) {
  const origin = candidateOrigin(url);
  const expectedFingerprint = productionProjectTargetsFingerprint(registry);
  const response = await fetchImpl(
    `${origin}/api/internal/job-admission-preflight`,
    {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (
    response.status !== 200
    || body?.ready !== true
    || body?.targetCount !== 5
    || body?.fingerprint !== expectedFingerprint
  ) {
    throw new Error(
      `후보 작업 생성 사전검증 실패(status=${response.status}, ready=${body?.ready === true}, targets=${Number(body?.targetCount) || 0}, fingerprintMatch=${body?.fingerprint === expectedFingerprint})`,
    );
  }
  return { origin, fingerprint: expectedFingerprint };
}

function parseArgs(argv) {
  const options = { url: "", registryFile: "production-project-targets.json" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--url") options.url = argv[++index] || "";
    else if (argv[index] === "--registry") options.registryFile = argv[++index] || "";
    else throw new Error(`알 수 없는 옵션입니다: ${argv[index]}`);
  }
  if (!options.url) throw new Error("--url <무별칭 후보 URL>이 필요합니다.");
  if (!options.registryFile) throw new Error("--registry <registry 파일>이 필요합니다.");
  return options;
}

async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await verifyCandidateJobAdmission({
    url: options.url,
    registry: readProductionProjectTargets(options.registryFile),
  });
  process.stdout.write(
    `후보 작업 생성 사전검증 통과: ${result.origin}, 5개 Batch 대상 identity 일치\n`,
  );
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
