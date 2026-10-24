import "server-only";
import { createHmac } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { HttpError } from "@/lib/http";
import { rankingUuid } from "./ranking-access";

export function rankingRuntimeConfig() {
  const base = process.env.RANKING_RECEIVER_URL || "";
  const secret = process.env.RANKING_TOKEN_SECRET || "";
  const arn = process.env.RANKING_CAPACITY_FUNCTION_ARN || "";
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new HttpError(503, "랭킹 영상 처리기를 준비 중입니다.");
  }
  const hosts = (process.env.RANKING_RECEIVER_ALLOWED_HOSTS || "").split(",");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hosts.includes(url.hostname) ||
    !url.pathname.endsWith("/ranking/v1") ||
    secret.length < 32 ||
    !/^arn:aws:lambda:ap-northeast-2:181651591905:function:shorts-ranking-capacity-production$/.test(
      arn,
    )
  )
    throw new HttpError(503, "랭킹 영상 처리 설정을 확인해 주세요.");
  return { base: url.toString().replace(/\/$/, ""), secret, arn };
}
export function rankingCapability(
  secret: string,
  method: string,
  project: string,
  source: string,
  owner: string,
  expires: number,
) {
  [project, source, owner].forEach(rankingUuid);
  const body = Buffer.from(
    JSON.stringify({ v: 1, method, project, source, owner, exp: expires }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`ranking-v1.${body}`).digest("base64url")}`;
}
export function rankingReceiverAccess(
  method: "PUT" | "GET",
  project: string,
  source: string,
  owner: string,
) {
  const config = rankingRuntimeConfig();
  const token = rankingCapability(
    config.secret,
    method,
    project,
    source,
    owner,
    Math.floor(Date.now() / 1000) + (method === "PUT" ? 600 : 7200),
  );
  const url = `${config.base}/projects/${rankingUuid(project)}/sources/${rankingUuid(source)}`;
  return method === "GET"
    ? { url: `${url}?token=${encodeURIComponent(token)}` }
    : { url, token };
}
export async function wakeRankingRuntime() {
  const { arn } = rankingRuntimeConfig();
  const roleArn = process.env.AWS_ROLE_ARN;
  const client = new LambdaClient({
    region: "ap-northeast-2",
    maxAttempts: 2,
    credentials:
      roleArn && process.env.VERCEL
        ? awsCredentialsProvider({
            roleArn,
            audience: "sts.amazonaws.com",
            clientConfig: { region: "ap-northeast-2" },
          })
        : undefined,
  });
  const result = await client.send(
    new InvokeCommand({
      FunctionName: arn,
      Payload: Buffer.from(JSON.stringify({ action: "wake" })),
    }),
    { abortSignal: AbortSignal.timeout(15000) },
  );
  if (result.FunctionError)
    throw new HttpError(
      503,
      "영상 처리기를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  const data = JSON.parse(Buffer.from(result.Payload || []).toString());
  if (!data.ok) throw new HttpError(503, "영상 처리기를 사용할 수 없습니다.");
  return Boolean(data.ready);
}
