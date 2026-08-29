const transientNames = new Set([
  "TooManyRequestsException",
  "ThrottlingException",
  "ServiceUnavailableException",
  "InternalServerError",
  "TimeoutError",
  "RequestTimeout",
]);

const transientCodes = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

type ErrorShape = {
  name?: unknown;
  code?: unknown;
  $metadata?: { httpStatusCode?: unknown };
};

export class FileUploadCapacityTransientError extends Error {
  constructor(public readonly lastError: unknown) {
    super("파일 업로드 용량 조정 요청이 일시적으로 지연되었습니다.");
    this.name = "FileUploadCapacityTransientError";
  }
}

export function isTransientFileUploadCapacityError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const shaped = error as ErrorShape;
  const name = typeof shaped.name === "string" ? shaped.name : "";
  const code = typeof shaped.code === "string" ? shaped.code : "";
  const status = Number(shaped.$metadata?.httpStatusCode);
  return transientNames.has(name)
    || transientCodes.has(code)
    || status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504;
}

export function fileUploadCapacityRetryDelayMs(
  retryIndex: number,
  randomValue = Math.random(),
) {
  const base = Math.min(2_000, 150 * 2 ** Math.max(0, retryIndex));
  const jitter = 0.75 + Math.max(0, Math.min(1, randomValue)) * 0.5;
  return Math.max(1, Math.round(base * jitter));
}

export async function retryFileUploadCapacityOperation<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    maxElapsedMs?: number;
    now?: () => number;
    random?: () => number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const maxAttempts = Math.max(1, Math.min(12, options.maxAttempts ?? 8));
  const maxElapsedMs = Math.max(0, options.maxElapsedMs ?? 12_000);
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>(
    (resolve) => setTimeout(resolve, milliseconds),
  ));
  const startedAt = now();
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientFileUploadCapacityError(error)) throw error;
      lastError = error;
      if (attempt >= maxAttempts - 1) break;
      const delay = fileUploadCapacityRetryDelayMs(attempt, random());
      if (now() - startedAt + delay > maxElapsedMs) break;
      await wait(delay);
    }
  }
  throw new FileUploadCapacityTransientError(lastError);
}
