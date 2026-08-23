export const FILE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const FILE_UPLOAD_MIN_DURATION_SECONDS = 3 * 60;
export const FILE_UPLOAD_MAX_DURATION_SECONDS = 3 * 60 * 60;

const supportedExtensions = new Set(["mp4", "mov", "m4v", "webm", "mkv", "mpeg", "mpg"]);
const metadataTimeoutMs = 20_000;

export type InspectedUploadVideo = {
  file: File;
  title: string;
  contentType: string;
  durationSeconds: number;
  width: number;
  height: number;
  thumbnailDataUrl: string;
};

function displayTitle(filename: string) {
  const normalized = filename.normalize("NFKC").split(/[\\/]/).at(-1)?.trim() || "";
  const withoutExtension = normalized.replace(/\.[^.]+$/, "").trim();
  return (withoutExtension || normalized || "업로드한 영상").slice(0, 255);
}

function extensionOf(filename: string) {
  return filename.split(".").at(-1)?.toLowerCase() || "";
}

export function uploadContentType(file: Pick<File, "type">) {
  return file.type.trim().slice(0, 120) || "application/octet-stream";
}

export function assertUploadFileCandidate(file: Pick<File, "name" | "size" | "type">) {
  if (!file.size || file.size > FILE_UPLOAD_MAX_BYTES) {
    throw new Error("5GB 이하 영상 파일을 선택해 주세요.");
  }
  if (!file.type.startsWith("video/") && !supportedExtensions.has(extensionOf(file.name))) {
    throw new Error("MP4, MOV, M4V, WEBM, MKV 영상 파일을 선택해 주세요.");
  }
}

function waitForMediaEvent(
  media: HTMLVideoElement,
  successEvent: "loadedmetadata" | "seeked",
  failureMessage: string,
) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error(failureMessage)), metadataTimeoutMs);
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      media.removeEventListener(successEvent, succeeded);
      media.removeEventListener("error", failed);
      if (error) reject(error);
      else resolve();
    };
    const succeeded = () => finish();
    const failed = () => finish(new Error(failureMessage));
    media.addEventListener(successEvent, succeeded, { once: true });
    media.addEventListener("error", failed, { once: true });
  });
}

function captureThumbnail(video: HTMLVideoElement) {
  const maximumWidth = 1280;
  const maximumHeight = 720;
  const scale = Math.min(
    1,
    maximumWidth / video.videoWidth,
    maximumHeight / video.videoHeight,
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("영상 썸네일을 만들지 못했습니다.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.84);
}

export async function inspectUploadVideo(file: File): Promise<InspectedUploadVideo> {
  assertUploadFileCandidate(file);
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  try {
    const metadataReady = waitForMediaEvent(
      video,
      "loadedmetadata",
      "브라우저에서 영상 정보를 확인하지 못했습니다.",
    );
    video.src = objectUrl;
    video.load();
    await metadataReady;
    const durationSeconds = video.duration;
    if (
      !Number.isFinite(durationSeconds)
      || durationSeconds < FILE_UPLOAD_MIN_DURATION_SECONDS
      || durationSeconds > FILE_UPLOAD_MAX_DURATION_SECONDS
    ) {
      throw new Error("3분부터 3시간까지의 원본 영상을 선택해 주세요.");
    }
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("영상 화면 크기를 확인하지 못했습니다.");
    }

    const thumbnailSecond = Math.min(Math.max(0, durationSeconds - 0.1), 2);
    if (thumbnailSecond > 0.05) {
      const seeked = waitForMediaEvent(
        video,
        "seeked",
        "영상 썸네일을 준비하지 못했습니다.",
      );
      video.currentTime = thumbnailSecond;
      await seeked;
    }
    return {
      file,
      title: displayTitle(file.name),
      contentType: uploadContentType(file),
      durationSeconds,
      width: video.videoWidth,
      height: video.videoHeight,
      thumbnailDataUrl: captureThumbnail(video),
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

export type DirectUploadProgress = {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
};

export class DirectUploadError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DirectUploadError";
  }
}

export function uploadFileDirectly(input: {
  file: File;
  uploadUrl: string;
  bearerToken: string;
  signal?: AbortSignal;
  onProgress?: (progress: DirectUploadProgress) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => xhr.abort();
    if (input.signal?.aborted) {
      finish(new DOMException("업로드가 취소되었습니다.", "AbortError"));
      return;
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    xhr.open("PUT", input.uploadUrl, true);
    xhr.setRequestHeader("Authorization", `Bearer ${input.bearerToken}`);
    xhr.setRequestHeader("Content-Type", uploadContentType(input.file));
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      const totalBytes = event.lengthComputable ? event.total : input.file.size;
      input.onProgress?.({
        loadedBytes: event.loaded,
        totalBytes,
        percent: Math.max(0, Math.min(100, totalBytes
          ? Math.round(event.loaded / totalBytes * 100)
          : 0)),
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress?.({
          loadedBytes: input.file.size,
          totalBytes: input.file.size,
          percent: 100,
        });
        finish();
        return;
      }
      const detail = xhr.response && typeof xhr.response === "object"
        ? "detail" in xhr.response && typeof xhr.response.detail === "string"
          ? xhr.response.detail
          : "message" in xhr.response && typeof xhr.response.message === "string"
            ? xhr.response.message
            : "영상 업로드를 완료하지 못했습니다."
        : "영상 업로드를 완료하지 못했습니다.";
      const code = xhr.response && typeof xhr.response === "object"
        && "error" in xhr.response && typeof xhr.response.error === "string"
        ? xhr.response.error
        : undefined;
      finish(new DirectUploadError(xhr.status, detail, code));
    };
    xhr.onerror = () => finish(new Error("업로드 서버에 연결하지 못했습니다."));
    xhr.onabort = () => finish(new DOMException("업로드가 취소되었습니다.", "AbortError"));
    xhr.send(input.file);
  });
}
