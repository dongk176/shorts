import "server-only";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { z } from "zod";
import { getDb } from "@/lib/db";

const assignment = z.object({
  routeId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  identity: z.string().regex(/^[a-f0-9]{10}$/),
  assignedAt: z.iso.datetime({ offset: true }),
  assignmentExact: z.boolean(),
});
const inventory = z.object({ verified: z.literal(true), checkedAt: z.iso.datetime({ offset: true }), routes: z.array(assignment).max(40) });
export type RouteAssignment = z.infer<typeof assignment>;
export async function loadRouteAssignments(): Promise<RouteAssignment[]> {
  const functionName = process.env.ADMIN_IP_INVENTORY_FUNCTION_ARN;
  if (!functionName) return [];
  const db = getDb();
  const rows = await db`select distinct batch_job_definition from shorts_mvp.video_jobs
    where created_at>=now()-interval '72 hours' and batch_job_definition is not null
      and source_type='youtube' limit 33`;
  const targets = rows.map(r => String(r.batchJobDefinition));
  if (!targets.length || targets.length > 32) return [];
  const region = process.env.AWS_REGION || "ap-northeast-2", roleArn = process.env.AWS_ROLE_ARN;
  const client = new LambdaClient({ region, maxAttempts: 1,
    credentials: roleArn && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN)
      ? awsCredentialsProvider({roleArn, audience:"sts.amazonaws.com",clientConfig:{region},roleSessionName:"admin-ip-inventory"}) : undefined });
  try {
    const response = await client.send(new InvokeCommand({ FunctionName:functionName,
      Payload:Buffer.from(JSON.stringify({targets})), InvocationType:"RequestResponse" }), {abortSignal:AbortSignal.timeout(12000)});
    if (response.FunctionError || !response.Payload) return [];
    const result = inventory.parse(JSON.parse(Buffer.from(response.Payload).toString("utf8")));
    if (Math.abs(Date.now()-Date.parse(result.checkedAt)) > 60_000) return [];
    return result.routes.filter(r => Date.parse(r.assignedAt) <= Date.now());
  } catch { return []; }
  finally { client.destroy(); }
}
