import { randomUUID } from "node:crypto";
import { BatchClient, SubmitJobCommand } from "@aws-sdk/client-batch";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

const region = process.env.AWS_REGION || "ap-northeast-2";

function credentials() {
  const roleArn = process.env.AWS_ROLE_ARN;
  if (!roleArn || (!process.env.VERCEL && !process.env.VERCEL_OIDC_TOKEN)) return undefined;
  return awsCredentialsProvider({
    roleArn,
    audience: "sts.amazonaws.com",
    clientConfig: { region },
    roleSessionName: "shorts-vercel",
  });
}

function batchClient() { return new BatchClient({ region, credentials: credentials() }); }
function s3Client() { return new S3Client({ region, credentials: credentials() }); }

export async function submitInitialJob(jobId: string, durationSeconds: number) {
  if (process.env.AWS_BATCH_MOCK === "true") return `mock-${randomUUID()}`;
  const jobQueue = process.env.AWS_BATCH_JOB_QUEUE;
  const definition = durationSeconds <= 900 ? process.env.AWS_BATCH_JOB_DEFINITION_SHORT : process.env.AWS_BATCH_JOB_DEFINITION_LONG;
  if (!jobQueue || !definition) throw new Error("AWS Batch 작업 설정이 완료되지 않았습니다.");
  const result = await batchClient().send(new SubmitJobCommand({
    jobName: `shorts-initial-${jobId}`,
    jobQueue,
    jobDefinition: definition,
    containerOverrides: { command: ["python", "-m", "shorts_worker", "initial", "--job-id", jobId] },
    retryStrategy: { attempts: 2 },
    timeout: { attemptDurationSeconds: 5400 },
  }));
  if (!result.jobId) throw new Error("AWS Batch 작업 ID를 받지 못했습니다.");
  return result.jobId;
}

export async function submitRerender(shortId: string) {
  if (process.env.AWS_BATCH_MOCK === "true") return `mock-${randomUUID()}`;
  const jobQueue = process.env.AWS_BATCH_JOB_QUEUE;
  const definition = process.env.AWS_BATCH_JOB_DEFINITION_SHORT;
  if (!jobQueue || !definition) throw new Error("AWS Batch 재렌더링 설정이 완료되지 않았습니다.");
  const result = await batchClient().send(new SubmitJobCommand({
    jobName: `shorts-rerender-${shortId}`,
    jobQueue,
    jobDefinition: definition,
    containerOverrides: { command: ["python", "-m", "shorts_worker", "rerender", "--short-id", shortId] },
    retryStrategy: { attempts: 2 },
    timeout: { attemptDurationSeconds: 5400 },
  }));
  if (!result.jobId) throw new Error("AWS Batch 재렌더링 작업 ID를 받지 못했습니다.");
  return result.jobId;
}

export async function deleteShortObjects(keys: string[]) {
  const bucket = process.env.AWS_S3_OUTPUT_BUCKET;
  if (!bucket) throw new Error("AWS_S3_OUTPUT_BUCKET이 설정되지 않았습니다.");
  const allowed = keys.filter((key) => /^(outputs|thumbnails|edit-sources)\/[A-Za-z0-9/_-]+\.(mp4|jpg)$/.test(key));
  const output = allowed.find((key) => key.startsWith("outputs/"));
  if (output) {
    const prefix = output.slice(0, output.lastIndexOf("/") + 1);
    let continuationToken: string | undefined;
    do {
      const listed = await s3Client().send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      for (const item of listed.Contents || []) if (item.Key) allowed.push(item.Key);
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }
  const unique = [...new Set(allowed)];
  if (!unique.length) return;
  await s3Client().send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: unique.map((Key) => ({ Key })), Quiet: true },
  }));
}
