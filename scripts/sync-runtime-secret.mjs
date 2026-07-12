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

const names = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_OPENAI_BASE_URL",
  "YOUTUBE_API_KEY",
  "WARP_CONF_B64",
];
const values = Object.fromEntries(names.map((name) => [name, process.env[name] || ""]));
values.DATABASE_URL = normalizeWorkerDatabaseUrl(values.DATABASE_URL);
const present = names.filter((name) => Boolean(values[name]));

export function syncRuntimeSecret() {
  if (!process.env.SECRET_ARN) throw new Error("SECRET_ARN is required");
  try {
    execFileSync("aws", [
      "secretsmanager",
      "put-secret-value",
      "--region",
      process.env.AWS_REGION || "ap-northeast-2",
      "--secret-id",
      process.env.SECRET_ARN,
      "--secret-string",
      JSON.stringify(values),
    ], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    throw new Error("AWS runtime secret 동기화에 실패했습니다. AWS 로그인과 리전을 확인해 주세요.");
  }
  process.stdout.write(`AWS runtime secret 동기화 완료 (${present.join(", ") || "입력값 없음"})\n`);
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) syncRuntimeSecret();
