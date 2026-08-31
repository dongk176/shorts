import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { HttpError } from "@/lib/http";

export const FILE_UPLOAD_CONTROL_BODY_MAX_BYTES = 64 * 1024;
export const FILE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const FILE_UPLOAD_MIN_DURATION_SECONDS = 3 * 60;
export const FILE_UPLOAD_MAX_DURATION_SECONDS = 3 * 60 * 60;

const TOKEN_VERSION = "easycut-upload-v1";
const INTENT_VERSION = "easycut-upload-intent-v1";

export type FileUploadReceiverConfig = {
  receiverBaseUrl: URL;
  tokenSecret: string;
};

export type FileUploadTokenIdentity = {
  uploadSessionId: string;
  jobId: string;
  userId: string;
  requestId: string;
};

export type FileUploadIntentIdentity = {
  originalFilename: string;
  declaredContentType: string;
  sizeBytes: number;
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  rangeStartSeconds: number;
  rangeEndSeconds: number;
  templateId: string;
  customTemplateId: string | null;
  customTemplateVersion?: number;
  videoAspectRatio: string;
  outputLanguage: string;
  subtitleTemplateId: string | null;
  subtitleCaptionPlacement: string | null;
  brandColor: string | null;
  rightsConfirmed: boolean;
};

function unavailableConfiguration() {
  return new HttpError(
    503,
    "파일 업로드 수신 서비스를 준비하지 못했습니다.",
    "FILE_UPLOAD_RECEIVER_UNAVAILABLE",
  );
}

function normalizedAllowedHosts(value: string | undefined) {
  return new Set(
    (value || "")
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  );
}

function explicitLocalLoopbackHttpEnabled(
  environment: Readonly<Record<string, string | undefined>>,
  receiverBaseUrl: URL,
) {
  const hostname = receiverBaseUrl.hostname.toLowerCase().replace(/\.$/, "");
  return environment.NODE_ENV !== "production"
    && environment.UNIFIED_TEMPLATE_SUBTITLE_LOCAL_UPLOAD_ENABLED
      ?.trim()
      .toLowerCase() === "true"
    && receiverBaseUrl.protocol === "http:"
    && (
      hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "[::1]"
    );
}

export function getFileUploadReceiverConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): FileUploadReceiverConfig {
  const receiverValue = environment.FILE_UPLOAD_RECEIVER_URL?.trim();
  const tokenSecret = environment.FILE_UPLOAD_TOKEN_SECRET;
  const allowedHosts = normalizedAllowedHosts(
    environment.FILE_UPLOAD_RECEIVER_ALLOWED_HOSTS,
  );
  if (
    !receiverValue
    || !tokenSecret
    || Buffer.byteLength(tokenSecret, "utf8") < 32
    || allowedHosts.size === 0
  ) {
    throw unavailableConfiguration();
  }

  let receiverBaseUrl: URL;
  try {
    receiverBaseUrl = new URL(receiverValue);
  } catch {
    throw unavailableConfiguration();
  }
  const receiverHostname = receiverBaseUrl.hostname
    .toLowerCase()
    .replace(/\.$/, "");
  const receiverTransportAllowed = receiverBaseUrl.protocol === "https:"
    || explicitLocalLoopbackHttpEnabled(environment, receiverBaseUrl);
  if (
    !receiverTransportAllowed
    || receiverBaseUrl.username
    || receiverBaseUrl.password
    || receiverBaseUrl.search
    || receiverBaseUrl.hash
    || !allowedHosts.has(receiverHostname)
  ) {
    throw unavailableConfiguration();
  }

  return { receiverBaseUrl, tokenSecret };
}

export function fileUploadReceiverUrl(
  receiverBaseUrl: URL,
  uploadSessionId: string,
) {
  const uploadUrl = new URL(receiverBaseUrl.toString());
  const basePath = uploadUrl.pathname.replace(/\/+$/, "");
  uploadUrl.pathname = `${basePath}/v1/upload-sessions/${encodeURIComponent(uploadSessionId)}/source`;
  return uploadUrl.toString();
}

export function fileUploadBearerToken(
  tokenSecret: string,
  identity: FileUploadTokenIdentity,
) {
  const canonicalIdentity = [
    TOKEN_VERSION,
    identity.uploadSessionId,
    identity.jobId,
    identity.userId,
    identity.requestId,
  ].join("\n");
  const signature = createHmac("sha256", tokenSecret)
    .update(canonicalIdentity, "utf8")
    .digest("base64url");
  return `${TOKEN_VERSION}.${signature}`;
}

export function fileUploadTokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function fileUploadIntentHash(intent: FileUploadIntentIdentity) {
  // An ordered tuple makes the digest independent from object insertion order.
  // This is an idempotency contract, not an authentication secret.
  return createHash("sha256").update(JSON.stringify([
    INTENT_VERSION,
    intent.originalFilename,
    intent.declaredContentType,
    intent.sizeBytes,
    intent.durationSeconds,
    intent.width,
    intent.height,
    intent.hasAudio,
    intent.rangeStartSeconds,
    intent.rangeEndSeconds,
    intent.templateId,
    intent.customTemplateId,
    intent.videoAspectRatio,
    intent.outputLanguage,
    intent.subtitleTemplateId,
    intent.subtitleCaptionPlacement,
    intent.brandColor,
    intent.rightsConfirmed,
    // Omitted by already-running legacy sessions: retain their exact hash.
    ...(intent.customTemplateVersion === undefined ? [] : [intent.customTemplateVersion]),
  ]), "utf8").digest("hex");
}

export function fileUploadTokenMatchesHash(token: string, expectedHash: string) {
  const actual = Buffer.from(fileUploadTokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export async function readLimitedJsonBody(
  request: Request,
  maximumBytes = FILE_UPLOAD_CONTROL_BODY_MAX_BYTES,
) {
  const contentLengthValue = request.headers.get("content-length");
  if (contentLengthValue) {
    const contentLength = Number(contentLengthValue);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new HttpError(400, "Content-Length를 확인해 주세요.");
    }
    if (contentLength > maximumBytes) {
      throw new HttpError(413, "요청 본문이 너무 큽니다.");
    }
  }

  if (!request.body) throw new SyntaxError("JSON body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "요청 본문이 너무 큽니다.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
}
