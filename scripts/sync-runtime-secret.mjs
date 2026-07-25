import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const unsupportedPsycopgOptions = ["pgbouncer", "connection_limit", "schema"];

export function normalizeWorkerDatabaseUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  for (const option of unsupportedPsycopgOptions) url.searchParams.delete(option);
  return url.toString();
}

export const runtimeSecretNames = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_PAID_DATA_PROCESSING_CONFIRMED",
  "GEMINI_OPENAI_BASE_URL",
  "YOUTUBE_API_KEY",
  "INGESTION_PROXY_ROUTES_JSON",
  "WARP_CONF_B64",
  "WARP_CONF_A_B64",
  "WARP_CONF_B_B64",
  "WARP_CONF_C_B64",
  "WARP_CONF_D_B64",
];

export function mergeRuntimeSecretValues(existing = {}, environment = process.env) {
  const values = Object.fromEntries(runtimeSecretNames.map((name) => {
    const supplied = Object.prototype.hasOwnProperty.call(environment, name);
    return [name, supplied ? String(environment[name] || "") : String(existing[name] || "")];
  }));
  values.DATABASE_URL = normalizeWorkerDatabaseUrl(values.DATABASE_URL);
  return values;
}

function readExistingSecret() {
  try {
    const output = execFileSync("aws", [
      "secretsmanager",
      "get-secret-value",
      "--region",
      process.env.AWS_REGION || "ap-northeast-2",
      "--secret-id",
      process.env.SECRET_ARN,
      "--query",
      "SecretString",
      "--output",
      "text",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(output);
  } catch {
    throw new Error("기존 AWS runtime secret을 안전하게 읽지 못했습니다.");
  }
}

export function syncRuntimeSecret() {
  if (!process.env.SECRET_ARN) throw new Error("SECRET_ARN is required");
  const values = mergeRuntimeSecretValues(readExistingSecret());
  const present = runtimeSecretNames.filter((name) => Boolean(values[name]));
  try {
    execFileSync("aws", [
      "secretsmanager",
      "put-secret-value",
      "--region",
      process.env.AWS_REGION || "ap-northeast-2",
      "--secret-id",
      process.env.SECRET_ARN,
      "--secret-string",
      "file:///dev/stdin",
    ], {
      input: JSON.stringify(values),
      stdio: ["pipe", "ignore", "ignore"],
    });
  } catch {
    throw new Error("AWS runtime secret 동기화에 실패했습니다. AWS 로그인과 리전을 확인해 주세요.");
  }
  process.stdout.write(`AWS runtime secret 동기화 완료 (${present.join(", ") || "입력값 없음"})\n`);
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) syncRuntimeSecret();
