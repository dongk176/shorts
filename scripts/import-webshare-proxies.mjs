import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const expectedProxyCount = 20;
const proxySecretField = "INGESTION_PROXY_ROUTES_JSON";
const proxyHealthcheckUrl = "https://api.ipify.org";
const execFileAsync = promisify(execFile);

function validIpv4(value) {
  const parts = value.split(".");
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function proxyUrl({ host, port, username, password }) {
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}

function parseProxyLines(contents) {
  const lines = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Webshare proxy 파일이 비어 있습니다.");

  return lines.map((line) => line.split(":"));
}

function validateProxy({ host, rawPort, username, password }) {
  const port = Number(rawPort);
  if (!validIpv4(host) || !Number.isInteger(port) || port < 1000 || port > 9999) {
    throw new Error("Webshare proxy 호스트 또는 포트가 허용 범위를 벗어났습니다.");
  }
  if (!username || !password || /[\u0000-\u001f\u007f]/.test(`${username}${password}`)) {
    throw new Error("Webshare proxy 인증정보가 비어 있거나 유효하지 않습니다.");
  }
  return { host, port, username, password };
}

function ensureUniqueEndpoints(proxies) {
  const endpoints = new Set();
  for (const proxy of proxies) {
    const endpoint = `${proxy.host}:${proxy.port}`;
    if (endpoints.has(endpoint)) throw new Error("중복된 Webshare proxy endpoint가 있습니다.");
    endpoints.add(endpoint);
  }
}

export function parseWebshareProxyFile(contents) {
  const rows = parseProxyLines(contents);
  if (rows.length !== expectedProxyCount) {
    throw new Error(`Webshare proxy 파일에는 정확히 ${expectedProxyCount}개가 있어야 합니다.`);
  }
  if (rows.some((fields) => fields.length !== 4)) {
    throw new Error("Webshare proxy 행 형식이 올바르지 않습니다.");
  }

  const proxies = rows.map((fields) => {
    const [host, rawPort, username, password] = fields;
    return validateProxy({ host, rawPort, username, password });
  });
  ensureUniqueEndpoints(proxies);

  return proxies.map((proxy, index) => ({
    id: `webshare-${String(index + 1).padStart(2, "0")}`,
    proxy_url: proxyUrl(proxy),
    egress_class: "webshare_isp",
  }));
}

export function parseWebshareReplacementFile(contents) {
  const rows = parseProxyLines(contents);
  if (rows.length > expectedProxyCount || rows.some((fields) => fields.length !== 5)) {
    throw new Error("교체된 Webshare proxy 행 형식이 올바르지 않습니다.");
  }

  const replacements = rows.map((fields) => {
    const [host, rawPort, username, password, previousHost] = fields;
    if (!validIpv4(previousHost)) {
      throw new Error("교체 전 Webshare proxy IP 형식이 올바르지 않습니다.");
    }
    return {
      ...validateProxy({ host, rawPort, username, password }),
      previousHost,
    };
  });
  ensureUniqueEndpoints(replacements);
  if (new Set(replacements.map(({ previousHost }) => previousHost)).size !== replacements.length) {
    throw new Error("중복된 교체 전 Webshare proxy IP가 있습니다.");
  }
  return replacements;
}

export function replaceWebshareProxyRoutes(existingRoutes, contents) {
  const rows = parseProxyLines(contents);
  if (rows.every((fields) => fields.length === 4)) {
    return { routes: parseWebshareProxyFile(contents), updatedRouteIds: Array.from({ length: expectedProxyCount }, (_, index) => `webshare-${String(index + 1).padStart(2, "0")}`) };
  }
  if (!rows.every((fields) => fields.length === 5)) {
    throw new Error("전체 목록 또는 교체 목록 중 하나의 형식만 사용해야 합니다.");
  }

  if (!Array.isArray(existingRoutes) || existingRoutes.length !== expectedProxyCount) {
    throw new Error(`기존 Webshare proxy 설정에는 정확히 ${expectedProxyCount}개가 있어야 합니다.`);
  }
  const replacements = parseWebshareReplacementFile(contents);
  const routeByHost = new Map(existingRoutes.map((route) => {
    const parsed = new URL(route.proxy_url);
    return [parsed.hostname, route];
  }));
  if (routeByHost.size !== existingRoutes.length) {
    throw new Error("기존 Webshare proxy IP가 중복되어 교체할 수 없습니다.");
  }

  const updatedRouteIds = replacements.map(({ previousHost }) => routeByHost.get(previousHost)?.id);
  if (updatedRouteIds.some((routeId) => !routeId)) {
    throw new Error("교체 전 Webshare proxy IP를 운영 설정에서 찾을 수 없습니다.");
  }

  const replacementByRouteId = new Map(replacements.map((replacement, index) => [updatedRouteIds[index], replacement]));
  const routes = existingRoutes.map((route) => {
    const replacement = replacementByRouteId.get(route.id);
    if (!replacement) return route;
    return {
      ...route,
      proxy_url: proxyUrl(replacement),
      egress_class: "webshare_isp",
    };
  });
  const endpoints = routes.map((route) => {
    const parsed = new URL(route.proxy_url);
    return { host: parsed.hostname, port: Number(parsed.port) };
  });
  ensureUniqueEndpoints(endpoints);
  return { routes, updatedRouteIds };
}

function readExistingSecret(secretArn) {
  const output = execFileSync("aws", [
    "secretsmanager",
    "get-secret-value",
    "--region",
    process.env.AWS_REGION || "ap-northeast-2",
    "--secret-id",
    secretArn,
    "--query",
    "SecretString",
    "--output",
    "text",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(output);
}

function readJobDefinitions(jobDefinitionArns) {
  const output = execFileSync("aws", [
    "batch",
    "describe-job-definitions",
    "--region",
    process.env.AWS_REGION || "ap-northeast-2",
    "--job-definitions",
    ...jobDefinitionArns,
    "--output",
    "json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(output).jobDefinitions || [];
}

export function assertJobDefinitionsUseProxySecret(
  jobDefinitions,
  secretArn,
  expectedArns,
) {
  const byArn = new Map(jobDefinitions.map((definition) => [definition.jobDefinitionArn, definition]));
  const expectedValueFrom = `${secretArn}:${proxySecretField}::`;
  for (const arn of expectedArns) {
    const definition = byArn.get(arn);
    if (!definition || definition.status !== "ACTIVE") {
      throw new Error(`운영 Job Definition이 ACTIVE 상태가 아닙니다: ${arn}`);
    }
    const proxySecret = (definition.containerProperties?.secrets || [])
      .find((secret) => secret.name === proxySecretField);
    if (proxySecret?.valueFrom !== expectedValueFrom) {
      throw new Error(`운영 Job Definition의 프록시 시크릿 대상이 다릅니다: ${arn}`);
    }
  }
}

export function assertSecretUpdatePreserved(before, after, expectedRoutes) {
  const beforeWithoutRoutes = { ...before };
  const afterWithoutRoutes = { ...after };
  delete beforeWithoutRoutes[proxySecretField];
  delete afterWithoutRoutes[proxySecretField];
  if (JSON.stringify(beforeWithoutRoutes) !== JSON.stringify(afterWithoutRoutes)) {
    throw new Error("프록시 이외의 런타임 시크릿 값이 변경되었습니다.");
  }
  const actualRoutes = JSON.parse(after[proxySecretField] || "[]");
  if (JSON.stringify(actualRoutes) !== JSON.stringify(expectedRoutes)) {
    throw new Error("AWS AWSCURRENT 프록시 목록이 입력 파일과 일치하지 않습니다.");
  }
}

export async function probeWebshareRoutes(routes, run = execFileAsync) {
  const results = await Promise.all(routes.map(async (route) => {
    try {
      const { stdout } = await run("curl", [
        "--silent",
        "--show-error",
        "--fail",
        "--connect-timeout",
        "6",
        "--max-time",
        "12",
        "--proxy",
        route.proxy_url,
        proxyHealthcheckUrl,
      ], { encoding: "utf8", maxBuffer: 4096 });
      return { routeId: route.id, ok: validIpv4(stdout.trim()) };
    } catch {
      return { routeId: route.id, ok: false };
    }
  }));
  const failedRouteIds = results.filter((result) => !result.ok).map((result) => result.routeId);
  if (failedRouteIds.length) {
    throw new Error(`HTTPS 연결 검사에 실패한 프록시가 있습니다: ${failedRouteIds.join(", ")}`);
  }
  return results;
}

export async function importWebshareProxies(
  filePath,
  secretArn,
  { dryRun = false, jobDefinitionArns = [] } = {},
) {
  if (!secretArn) throw new Error("SECRET_ARN이 필요합니다.");
  if (!jobDefinitionArns.length) throw new Error("JOB_DEFINITION_ARNS가 필요합니다.");
  assertJobDefinitionsUseProxySecret(
    readJobDefinitions(jobDefinitionArns),
    secretArn,
    jobDefinitionArns,
  );
  const existing = readExistingSecret(secretArn);
  const { routes, updatedRouteIds } = replaceWebshareProxyRoutes(
    JSON.parse(existing[proxySecretField] || "[]"),
    fs.readFileSync(filePath, "utf8"),
  );
  await probeWebshareRoutes(routes);
  if (dryRun) {
    process.stdout.write(
      `Webshare Dedicated ISP proxy ${updatedRouteIds.join(", ")}의 대상과 연결을 검증했습니다.\n`,
    );
    return;
  }
  const updated = { ...existing, [proxySecretField]: JSON.stringify(routes) };
  execFileSync("aws", [
    "secretsmanager",
    "put-secret-value",
    "--region",
    process.env.AWS_REGION || "ap-northeast-2",
    "--secret-id",
    secretArn,
    "--secret-string",
    "file:///dev/stdin",
  ], {
    input: JSON.stringify(updated),
    stdio: ["pipe", "ignore", "ignore"],
  });
  const applied = readExistingSecret(secretArn);
  assertSecretUpdatePreserved(existing, applied, routes);
  assertJobDefinitionsUseProxySecret(
    readJobDefinitions(jobDefinitionArns),
    secretArn,
    jobDefinitionArns,
  );
  process.stdout.write(
    `Webshare Dedicated ISP proxy ${updatedRouteIds.join(", ")}를 실제 운영 워커 시크릿에 반영하고 재검증했습니다.\n`,
  );
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dryRun = process.argv.slice(3).includes("--dry-run");
  const jobDefinitionArns = (process.env.JOB_DEFINITION_ARNS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  await importWebshareProxies(process.argv[2], process.env.SECRET_ARN, {
    dryRun,
    jobDefinitionArns,
  });
}
