import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startProjectDownload } from "./project-download-client";

describe("download all button request", () => {
  const anchor = { href: "", download: "", hidden: false, click: vi.fn(), remove: vi.fn() };
  const createElement = vi.fn(() => anchor);
  const appendChild = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("document", { createElement, body: { appendChild } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts exactly one ZIP attachment after the access check", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { headers: { "X-Shorts-Count": "15" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await startProjectDownload(123, new AbortController().signal)).toBe(200);
    expect(fetcher).toHaveBeenCalledWith("/api/projects/123/download", expect.objectContaining({ method: "HEAD" }));
    expect(createElement).toHaveBeenCalledTimes(1);
    expect(anchor.href).toBe("/api/projects/123/download");
    expect(anchor.download).toBe("easycut-project-123.zip");
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
  });

  it.each([401, 402, 403, 404, 503])("keeps the project open without starting downloads on HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    expect(await startProjectDownload(123, new AbortController().signal)).toBe(status);
    expect(createElement).not.toHaveBeenCalled();
  });

  it("does not start the attachment after the user leaves during preparation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      controller.abort();
      return new Response(null, { headers: { "X-Shorts-Count": "3" } });
    }));
    await expect(startProjectDownload(123, controller.signal)).rejects.toBeDefined();
    expect(createElement).not.toHaveBeenCalled();
  });

  it("does not treat an unexpected HTTP 200 page as a prepared download", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>fallback</html>")));
    expect(await startProjectDownload(123, new AbortController().signal)).toBe(503);
    expect(createElement).not.toHaveBeenCalled();
  });
});
