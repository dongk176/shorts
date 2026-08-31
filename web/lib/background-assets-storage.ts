import "server-only";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { createHash } from "node:crypto";
import {
  backgroundAssetIdSchema,
  BACKGROUND_ASSET_MAX_OUTPUT_BYTES,
} from "@/lib/background-assets-contract";
import { HttpError } from "@/lib/http";

export function backgroundAssetObjectKey(userId: string, assetId: string) {
  return `custom-backgrounds/${backgroundAssetIdSchema.parse(userId)}/${backgroundAssetIdSchema.parse(assetId)}.webp`;
}

function storage() {
  const bucket = process.env.AWS_S3_OUTPUT_BUCKET;
  if (!bucket) throw new HttpError(503, "배경 이미지 저장소가 준비되지 않았습니다.", "BACKGROUND_STORAGE_UNAVAILABLE");
  const region = process.env.AWS_REGION || "ap-northeast-2";
  const roleArn = process.env.AWS_ROLE_ARN;
  const credentials = roleArn && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN)
    ? awsCredentialsProvider({ roleArn, audience: "sts.amazonaws.com", clientConfig: { region }, roleSessionName: "shorts-vercel" })
    : undefined;
  return { bucket, client: new S3Client({ region, credentials, maxAttempts: 2 }) };
}

export async function putBackgroundAssetObject(input: {
  userId: string; assetId: string; body: Buffer; sha256: string;
}) {
  const key = backgroundAssetObjectKey(input.userId, input.assetId);
  if (!input.body.length || input.body.length > BACKGROUND_ASSET_MAX_OUTPUT_BYTES
    || createHash("sha256").update(input.body).digest("hex") !== input.sha256) {
    throw new HttpError(400, "저장할 배경 이미지 정보가 올바르지 않습니다.", "BACKGROUND_IMAGE_INVALID");
  }
  const { bucket, client } = storage();
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.body,
      ContentLength: input.body.length,
      ContentType: "image/webp",
      CacheControl: "private, no-store",
      IfNoneMatch: "*",
      ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
    }), { abortSignal: AbortSignal.timeout(20_000) });
  } finally {
    client.destroy();
  }
}

export async function getBackgroundAssetObject(input: {
  userId: string; assetId: string; objectKey: string; sha256: string; byteSize: number;
}) {
  const key = backgroundAssetObjectKey(input.userId, input.assetId);
  if (key !== input.objectKey || !/^[0-9a-f]{64}$/.test(input.sha256)
    || input.byteSize < 1 || input.byteSize > BACKGROUND_ASSET_MAX_OUTPUT_BYTES) {
    throw new HttpError(404, "배경 이미지를 찾을 수 없습니다.", "BACKGROUND_ASSET_NOT_FOUND");
  }
  const { bucket, client } = storage();
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(15_000),
    });
    if (!response.Body || response.ContentLength !== input.byteSize
      || response.ContentType !== "image/webp") {
      throw new HttpError(503, "배경 이미지를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", "BACKGROUND_ASSET_UNAVAILABLE");
    }
    const body = Buffer.from(await response.Body.transformToByteArray());
    if (body.length !== input.byteSize || createHash("sha256").update(body).digest("hex") !== input.sha256) {
      throw new HttpError(503, "배경 이미지를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", "BACKGROUND_ASSET_UNAVAILABLE");
    }
    return body;
  } finally {
    client.destroy();
  }
}
