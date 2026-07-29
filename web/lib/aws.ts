import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getCloudFrontSignedUrl } from "@aws-sdk/cloudfront-signer";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { readFile } from "node:fs/promises";
import path from "node:path";

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

async function cloudFrontPrivateKey() {
  const privateKeyB64 = process.env.CLOUDFRONT_PRIVATE_KEY_B64;
  if (privateKeyB64) return Buffer.from(privateKeyB64, "base64").toString("utf8");
  const privateKeyPath = process.env.CLOUDFRONT_PRIVATE_KEY_PATH;
  if (!privateKeyPath) return "";
  return readFile(path.resolve(process.cwd(), privateKeyPath), "utf8");
}

export async function getShortDownloadUrl(
  key: string,
  filename: string,
  expiresIn: number,
) {
  if (!/^outputs\/[A-Za-z0-9/_-]+\.mp4$/.test(key)) {
    throw new Error("다운로드할 수 없는 영상 경로입니다.");
  }
  if (!/^[0-9A-Za-z가-힣 _-]{1,80}\.mp4$/.test(filename)) {
    throw new Error("다운로드 파일명이 올바르지 않습니다.");
  }
  const domain = process.env.CLOUDFRONT_DOMAIN;
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const privateKey = await cloudFrontPrivateKey();
  if (!domain || !keyPairId || !privateKey) {
    throw new Error("CloudFront Signed URL 설정이 완료되지 않았습니다.");
  }
  const lifetimeSeconds = Math.max(1, Math.min(300, Math.floor(expiresIn)));
  return getCloudFrontSignedUrl({
    url: `https://${domain}/${key}?download=1&filename=${encodeURIComponent(filename)}`,
    keyPairId,
    privateKey,
    dateLessThan: new Date(Date.now() + lifetimeSeconds * 1_000).toISOString(),
  });
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
