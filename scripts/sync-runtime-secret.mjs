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
