import { execFileSync } from "node:child_process";

const names = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_OPENAI_BASE_URL",
  "YOUTUBE_API_KEY",
];
const values = Object.fromEntries(names.map((name) => [name, process.env[name] || ""]));
const present = names.filter((name) => Boolean(values[name]));
if (!process.env.SECRET_ARN) throw new Error("SECRET_ARN is required");
execFileSync("aws", [
  "secretsmanager",
  "put-secret-value",
  "--secret-id",
  process.env.SECRET_ARN,
  "--secret-string",
  JSON.stringify(values),
], { stdio: ["ignore", "ignore", "inherit"] });
process.stdout.write(`AWS runtime secret 동기화 완료 (${present.join(", ") || "입력값 없음"})\n`);
