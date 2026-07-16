import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const expectedProxyCount = 10;

function validIpv4(value) {
  const parts = value.split(".");
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function parseWebshareProxyFile(contents) {
  const lines = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== expectedProxyCount) {
    throw new Error(`Webshare proxy 파일에는 정확히 ${expectedProxyCount}개가 있어야 합니다.`);
  }

  const endpoints = new Set();
  return lines.map((line, index) => {
    const fields = line.split(":");
    if (fields.length !== 4) throw new Error("Webshare proxy 행 형식이 올바르지 않습니다.");
    const [host, rawPort, username, password] = fields;
    const port = Number(rawPort);
    if (!validIpv4(host) || !Number.isInteger(port) || port < 1000 || port > 9999) {
      throw new Error("Webshare proxy 호스트 또는 포트가 허용 범위를 벗어났습니다.");
    }
    if (!username || !password || /[\u0000-\u001f\u007f]/.test(`${username}${password}`)) {
      throw new Error("Webshare proxy 인증정보가 비어 있거나 유효하지 않습니다.");
    }
    const endpoint = `${host}:${port}`;
    if (endpoints.has(endpoint)) throw new Error("중복된 Webshare proxy endpoint가 있습니다.");
    endpoints.add(endpoint);
    return {
      id: `webshare-${String(index + 1).padStart(2, "0")}`,
      proxy_url: `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`,
      egress_class: "webshare_isp",
    };
  });
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

export function importWebshareProxies(filePath, secretArn) {
  if (!secretArn) throw new Error("SECRET_ARN이 필요합니다.");
  const routes = parseWebshareProxyFile(fs.readFileSync(filePath, "utf8"));
  const existing = readExistingSecret(secretArn);
  existing.INGESTION_PROXY_ROUTES_JSON = JSON.stringify(routes);
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
    input: JSON.stringify(existing),
    stdio: ["pipe", "ignore", "ignore"],
  });
  process.stdout.write(`Webshare Dedicated ISP proxy ${routes.length}개를 AWS secret에 반영했습니다.\n`);
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) importWebshareProxies(process.argv[2], process.env.SECRET_ARN);
