import "server-only";

import { open, stat } from "node:fs/promises";

function localFileStream(filePath: string, start: number, end: number) {
  const handlePromise = open(filePath, "r");
  let position = start;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let ended = false;
  let cancelled = false;

  const closeHandle = async () => {
    const activeHandle = handle || await handlePromise.catch(() => null);
    handle = activeHandle;
    if (activeHandle) await activeHandle.close().catch(() => undefined);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (ended || cancelled) return;
      try {
        handle ||= await handlePromise;
        if (cancelled) {
          await closeHandle();
          return;
        }
        const remaining = end - position + 1;
        if (remaining <= 0) {
          ended = true;
          await closeHandle();
          if (!cancelled) controller.close();
          return;
        }
        const buffer = new Uint8Array(Math.min(64 * 1024, remaining));
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
        if (cancelled) {
          await closeHandle();
          return;
        }
        if (!bytesRead) {
          ended = true;
          await closeHandle();
          if (!cancelled) controller.close();
          return;
        }
        position += bytesRead;
        controller.enqueue(buffer.subarray(0, bytesRead));
        if (position > end) {
          ended = true;
          await closeHandle();
          if (!cancelled) controller.close();
        }
      } catch (error) {
        ended = true;
        await closeHandle();
        if (!cancelled) controller.error(error);
      }
    },
    async cancel() {
      cancelled = true;
      await closeHandle();
    },
  });
}

export async function localVideoResponse(request: Request, filePath: string) {
  const details = await stat(filePath);
  const range = request.headers.get("range");
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Type": "video/mp4",
  });
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416 });
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), details.size - 1) : details.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= details.size) {
      return new Response(null, { status: 416 });
    }
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Content-Range", `bytes ${start}-${end}/${details.size}`);
    return new Response(localFileStream(filePath, start, end), { status: 206, headers });
  }
  headers.set("Content-Length", String(details.size));
  return new Response(localFileStream(filePath, 0, details.size - 1), { headers });
}
