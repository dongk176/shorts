import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getCloudFrontSignedUrl } from "@aws-sdk/cloudfront-signer";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

const EDITOR_CHANNEL_ASSET_MAX_BYTES = 300_000;

export function parseEditorChannelImageDataUrl(value: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(value);
  if (!match) throw new Error("채널 이미지는 PNG, JPG 또는 WebP만 사용할 수 있습니다.");
  const mimeSubtype = match[1].toLowerCase();
  const body = Buffer.from(match[2], "base64");
  if (body.length < 32 || body.length > EDITOR_CHANNEL_ASSET_MAX_BYTES) {
    throw new Error("채널 이미지 용량을 다시 확인해 주세요.");
  }
  const signatureIsValid = mimeSubtype === "png"
    ? body.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    : mimeSubtype === "jpeg"
      ? body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
      : body.subarray(0, 4).toString("ascii") === "RIFF"
        && body.subarray(8, 12).toString("ascii") === "WEBP";
  if (!signatureIsValid) throw new Error("채널 이미지 파일 형식이 올바르지 않습니다.");
  return {
    body,
    contentType: mimeSubtype === "jpeg" ? "image/jpeg" : `image/${mimeSubtype}`,
    extension: mimeSubtype === "jpeg" ? "jpg" : mimeSubtype,
  };
}

export async function putEditorChannelAsset({
  sessionId,
  jobId,
  shortId,
  dataUrl,
}: {
  sessionId: string;
  jobId: string;
  shortId: string;
  dataUrl: string;
}) {
  const bucket = process.env.AWS_S3_OUTPUT_BUCKET;
  if (!bucket) throw new Error("AWS_S3_OUTPUT_BUCKET이 설정되지 않았습니다.");
  for (const id of [sessionId, jobId, shortId]) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error("채널 이미지 저장 경로가 올바르지 않습니다.");
    }
  }
  const parsed = parseEditorChannelImageDataUrl(dataUrl);
  const digest = createHash("sha256").update(parsed.body).digest("hex");
  const key = (
    `edit-sources/${sessionId}/${jobId}/${shortId}/`
    + `editor-assets/${digest}.${parsed.extension}`
  );
  await s3Client().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: parsed.body,
    ContentType: parsed.contentType,
    CacheControl: "private, max-age=2592000, immutable",
  }));
  return key;
}

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
