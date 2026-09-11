import { makeZip } from "client-zip";
import { getShortDownloadUrl } from "@/lib/aws";
import { HttpError } from "@/lib/http";
import { shortDownloadExpirySeconds, shortDownloadFilename } from "@/lib/short-download";

export type ProjectDownloadItem = {
  outputS3Key: string;
  hookTitle: string;
  expiresAt: Date | string | null;
};

const unavailable = () => new HttpError(
  503,
  "일부 영상을 가져오지 못했습니다. 잠시 후 다시 다운로드해 주세요.",
  "PROJECT_DOWNLOAD_UNAVAILABLE",
);

/** Fetch one output at a time; never buffer the project's videos in memory. */
export async function projectDownloadArchive(
  items: ProjectDownloadItem[],
  requestSignal: AbortSignal,
) {
  if (!items.length) throw unavailable();
  const controller = new AbortController();
  const signal = AbortSignal.any([
    requestSignal,
    controller.signal,
    AbortSignal.timeout(240_000),
  ]);

  const openVideo = async (item: ProjectDownloadItem) => {
    signal.throwIfAborted();
    if (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()) {
      throw unavailable();
    }
    const url = await getShortDownloadUrl(
      item.outputS3Key,
      shortDownloadFilename(item.hookTitle),
      shortDownloadExpirySeconds(item.expiresAt),
    );
    const response = await fetch(url, {
      signal,
      cache: "no-store",
      redirect: "error",
      headers: { "Accept-Encoding": "identity" },
    });
    const size = Number(response.headers.get("content-length"));
    if (!response.ok || !response.body || !Number.isSafeInteger(size) || size <= 0) {
      await response.body?.cancel();
      throw unavailable();
    }
    return { body: response.body, size };
  };

  // Check the first output before sending attachment headers so initial failures
  // remain ordinary API errors. Later failures abort the ZIP, never omit a file.
  const first = await openVideo(items[0]);
  let activeBody: ReadableStream<Uint8Array> | null = first.body;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  async function* contents(body: ReadableStream<Uint8Array>, expected: number) {
    const reader = body.getReader();
    activeReader = reader;
    let received = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        received += chunk.value.byteLength;
        if (received > expected) throw unavailable();
        yield chunk.value;
      }
      if (received !== expected) throw unavailable();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      activeReader = null;
      activeBody = null;
    }
  }
  async function* files() {
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const video = index === 0 ? first : await openVideo(item);
        activeBody = video.body;
        yield {
          name: `${String(index + 1).padStart(2, "0")}_${shortDownloadFilename(item.hookTitle)}`,
          size: video.size,
          input: contents(video.body, video.size),
        };
      }
    } catch (error) {
      // client-zip forwards cancellation to this iterator without awaiting it.
      if (!controller.signal.aborted) throw error;
    }
  }
  const reader = makeZip(files()).getReader();
  return new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) {
          output.close();
        } else {
          output.enqueue(chunk.value);
        }
      } catch {
        controller.abort();
        await activeReader?.cancel().catch(() => undefined);
        if (activeBody && !activeBody.locked) await activeBody.cancel().catch(() => undefined);
        await reader.cancel().catch(() => undefined);
        // Signed URLs and upstream error text must not appear in logs.
        console.error("project_download_stream_failed", { code: "ARCHIVE_INTERRUPTED" });
        output.error(unavailable());
      }
    },
    async cancel() {
      controller.abort();
      await activeReader?.cancel().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
      if (activeBody && !activeBody.locked) {
        await activeBody.cancel().catch(() => undefined);
      }
    },
  });
}
