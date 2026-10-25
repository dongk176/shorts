import "server-only";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { rankingUuid } from "./ranking-access";
export async function createRankingOutputUpload(
  project: string,
  operation: string,
) {
  const region = process.env.AWS_REGION || "ap-northeast-2",
    roleArn = process.env.AWS_ROLE_ARN;
  const bucket = process.env.AWS_S3_OUTPUT_BUCKET;
  if (!bucket) throw new Error("Output storage unavailable");
  const client = new S3Client({
    region,
    credentials:
      roleArn && process.env.VERCEL
        ? awsCredentialsProvider({
            roleArn,
            audience: "sts.amazonaws.com",
            clientConfig: { region },
          })
        : undefined,
  });
  const outputKey = `outputs/ranking/${rankingUuid(project)}/${rankingUuid(operation)}.mp4`;
  return {
    outputKey,
    outputUploadUrl: await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: outputKey,
        ContentType: "video/mp4",
      }),
      { expiresIn: 1200 },
    ),
  };
}
