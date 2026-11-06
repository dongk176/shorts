import "server-only";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { HttpError } from "./http";

export type RankingProxyRoute = { id: string; proxy_url: string; egress_class: "webshare_isp" };

/** Fetch AWSCURRENT for every lease, including retries. Never use the copied Vercel list. */
export async function currentRankingProxyRegistry(): Promise<{ registryVersion: string; routes: RankingProxyRoute[] }> {
  const arn = process.env.RANKING_CAPACITY_FUNCTION_ARN;
  if (arn !== "arn:aws:lambda:ap-northeast-2:181651591905:function:shorts-ranking-capacity-production")
    throw new HttpError(503, "다운로드 연결 설정을 확인하고 있어요. 잠시 후 다시 시도해 주세요.");
  try {
    const roleArn = process.env.AWS_ROLE_ARN;
    const client = new LambdaClient({
      region: "ap-northeast-2", maxAttempts: 3,
      credentials: roleArn && process.env.VERCEL ? awsCredentialsProvider({
        roleArn, audience: "sts.amazonaws.com", clientConfig: { region: "ap-northeast-2" },
      }) : undefined,
    });
    const result = await client.send(new InvokeCommand({
      FunctionName: arn, InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({action: "proxy_registry"})),
    }), {abortSignal: AbortSignal.timeout(15000)});
    if (result.FunctionError) throw new Error();
    const data = JSON.parse(Buffer.from(result.Payload || []).toString());
    if (!data.ok || typeof data.registryVersion !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(data.registryVersion) ||
        !Array.isArray(data.routes) || !data.routes.length || data.routes.length > 32) throw new Error();
    const ids = new Set<string>();
    for (const r of data.routes) {
      if (!r || typeof r.id !== "string" || typeof r.proxy_url !== "string") throw new Error();
      const u = new URL(r.proxy_url);
      if (r.egress_class !== "webshare_isp" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(r.id) || ids.has(r.id) ||
          !["http:", "https:", "socks5:", "socks5h:"].includes(u.protocol) || !u.hostname || !u.port ||
          u.search || u.hash || !["", "/"].includes(u.pathname)) throw new Error();
      ids.add(r.id);
    }
    return {registryVersion: data.registryVersion, routes: data.routes.map((r: RankingProxyRoute) => ({id:r.id,proxy_url:r.proxy_url,egress_class:r.egress_class}))};
  } catch {
    // SDK/JSON errors can include sensitive payloads. Expose a fixed message only.
    throw new HttpError(503, "다운로드 연결 설정을 확인하고 있어요. 잠시 후 다시 시도해 주세요.");
  }
}
