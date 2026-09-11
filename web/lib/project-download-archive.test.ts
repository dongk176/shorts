import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sign = vi.hoisted(() => vi.fn());
vi.mock("@/lib/aws", () => ({ getShortDownloadUrl: sign }));
import { projectDownloadArchive, type ProjectDownloadItem } from "./project-download-archive";

const items: ProjectDownloadItem[] = ["first", "middle", "last"].map((id) => ({
  outputS3Key: `outputs/${id}.mp4`, hookTitle: "같은 제목 🎬", expiresAt: null,
}));
const signal = () => new AbortController().signal;
const video = (bytes: Uint8Array, length = bytes.length) => new Response(bytes, {
  headers: { "content-length": String(length), "content-type": "video/mp4" },
});

describe("project ZIP archive", () => {
  beforeEach(() => {
    sign.mockReset().mockImplementation(async (key: string) => `https://cdn.example/${key}`);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("contains every file, preserves bytes and gives identical titles distinct UTF-8 names", async () => {
    // Larger than the ordinary serverless buffered-response limit. The ZIP is
    // consumed here only for independent integrity verification with Python.
    const bodies = [new Uint8Array(3_000_000).fill(1), new Uint8Array(3_000_000).fill(2), new Uint8Array(3_000_000).fill(3)];
    const fetcher = vi.fn().mockImplementation(async () => video(bodies[fetcher.mock.calls.length - 1]));
    vi.stubGlobal("fetch", fetcher);
    const stream = await projectDownloadArchive(items, signal());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const bytes = Buffer.from(await new Response(stream).arrayBuffer());
    const archive = JSON.parse(execFileSync("python3", ["-c", [
      "import sys,io,zipfile,json,hashlib",
      "z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))",
      "assert z.testzip() is None",
      "print(json.dumps([{'name':i.filename,'size':i.file_size,'value':z.read(i)[0], 'unique':len(set(z.read(i)))} for i in z.infolist()]))",
    ].join("\n")], { input: bytes, timeout: 15_000, maxBuffer: 1_000_000 }).toString());
    expect(archive).toEqual([1, 2, 3].map((value) => ({
      name: `0${value}_같은 제목.mp4`, size: 3_000_000, value, unique: 1,
    })));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sign.mock.calls.map((call) => call[0])).toEqual(items.map((item) => item.outputS3Key));
  });

  it("fails before returning an archive when the first output is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(projectDownloadArchive(items, signal())).rejects.toMatchObject({ status: 503 });
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("aborts the whole ZIP if a later output fails instead of silently skipping it", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(video(new Uint8Array([1])))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    const stream = await projectDownloadArchive(items, signal());
    await expect(new Response(stream).arrayBuffer()).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a truncated video even when the upstream returned HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(video(new Uint8Array([1, 2]), 50)));
    const stream = await projectDownloadArchive(items, signal());
    await expect(new Response(stream).arrayBuffer()).rejects.toMatchObject({ status: 503 });
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("stops reading and aborts upstream requests when the download is canceled", async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024)); }, cancel,
    }), { headers: { "content-length": "100000000" } }));
    vi.stubGlobal("fetch", fetcher);
    const reader = (await projectDownloadArchive(items, signal())).getReader();
    await reader.read();
    await reader.read();
    await reader.cancel();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not sign expired outputs or start a request after cancellation", async () => {
    await expect(projectDownloadArchive([{ ...items[0], expiresAt: new Date(0) }], signal()))
      .rejects.toMatchObject({ status: 503 });
    await expect(projectDownloadArchive(items, AbortSignal.abort())).rejects.toBeDefined();
    expect(sign).not.toHaveBeenCalled();
  });
});
