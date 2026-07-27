import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { getSignedUrl as getS3SignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { shortDownloadContentDisposition } from "@/lib/short-download";

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

function s3Client() { return new S3Client({ region, credentials: credentials() }); }
function lambdaClient() { return new LambdaClient({ region, credentials: credentials() }); }

export async function getShortDownloadUrl(
  key: string,
  filename: string,
  expiresIn: number,
) {
  const bucket = process.env.AWS_S3_OUTPUT_BUCKET;
  if (!bucket) throw new Error("AWS_S3_OUTPUT_BUCKET이 설정되지 않았습니다.");
  if (!/^outputs\/[A-Za-z0-9/_-]+\.mp4$/.test(key)) {
    throw new Error("다운로드할 수 없는 영상 경로입니다.");
  }
  return getS3SignedUrl(
    s3Client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: shortDownloadContentDisposition(filename),
      ResponseContentType: "video/mp4",
    }),
    { expiresIn: Math.max(1, Math.min(300, Math.floor(expiresIn))) },
  );
}

export async function wakeOutboxDispatcher() {
  const functionArn = process.env.AWS_OUTBOX_DISPATCHER_FUNCTION_ARN;
  if (!functionArn) throw new Error("AWS_OUTBOX_DISPATCHER_FUNCTION_ARN이 설정되지 않았습니다.");
  await lambdaClient().send(new InvokeCommand({
    FunctionName: functionArn,
    InvocationType: "Event",
    Payload: new TextEncoder().encode(JSON.stringify({ source: "job_created" })),
  }));
}

export function latestJobDefinitionName(value: string) {
  const arnName = /:job-definition\/([^:]+)(?::\d+)?$/.exec(value)?.[1];
  if (arnName) return arnName;
  return value.replace(/:\d+$/, "");
}

export async function deleteShortObjects(keys: string[]) {
  const bucket = process.env.AWS_S3_OUTPUT_BUCKET;
  if (!bucket) throw new Error("AWS_S3_OUTPUT_BUCKET이 설정되지 않았습니다.");
  const allowed = keys.filter((key) => /^(outputs|thumbnails|edit-sources)\/[A-Za-z0-9/_-]+\.(mp4|jpg)$/.test(key));
  const output = allowed.find((key) => key.startsWith("outputs/"));
  const prefixes: string[] = [];
  if (output) {
    const outputPrefix = output.slice(0, output.lastIndexOf("/") + 1);
    const relativeShortPrefix = outputPrefix.replace(/^outputs\//, "");
    prefixes.push(outputPrefix, `edit-sources/${relativeShortPrefix}`);
  } else {
    const timeline = allowed.find((key) => key.startsWith("edit-sources/") && key.includes("/timeline-"));
    if (timeline) prefixes.push(timeline.slice(0, timeline.lastIndexOf("/") + 1));
  }
  for (const prefix of prefixes) {
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
