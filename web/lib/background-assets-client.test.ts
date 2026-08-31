import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_ASSET_MAX_INPUT_BYTES } from "@/lib/background-assets-contract";
import {
  removeBackgroundAssetFromLibrary,
  requestBackgroundAssetList,
  uploadBackgroundAsset,
  validateBackgroundAssetUpload,
  verifyBackgroundAssetSelection,
} from "@/lib/background-assets-client";

const id = "9bfcc905-bbbf-46b5-812b-7fb1c5c0bde4";
const asset = { id, displayName: "내 배경", width: 1080, height: 1920, byteSize: 100, createdAt: "2026-08-31T00:00:00Z", imageUrl: `https://untrusted.invalid/${id}` };
const quota = { listedCount: 1, pendingCount: 0, maxListed: 100, bytesUsed: 100, maxBytes: 1024 ** 3 };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("background asset UI API client", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s and the exact input boundary", (type) => {
    expect(() => validateBackgroundAssetUpload({ type, size: BACKGROUND_ASSET_MAX_INPUT_BYTES })).not.toThrow();
    expect(() => validateBackgroundAssetUpload({ type, size: BACKGROUND_ASSET_MAX_INPUT_BYTES + 1 })).toThrow("3MB");
    expect(() => validateBackgroundAssetUpload({ type, size: 0 })).toThrow();
  });

  it("rejects unsupported types before making a request", async () => {
    await expect(uploadBackgroundAsset(new File(["gif"], "fake.png", { type: "image/gif" }))).rejects.toThrow("정지 WebP");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads a private list without cache and never follows metadata image URLs", async () => {
    fetchMock.mockResolvedValue(Response.json({ assets: [asset], quota }));
    const result = await requestBackgroundAssetList();
    expect(result.assets[0].imageUrl).toBe(`/api/background-assets/${id}`);
    expect(fetchMock).toHaveBeenCalledWith("/api/background-assets", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });

  it("uploads a single multipart file and accepts an existing asset restoration", async () => {
    fetchMock.mockResolvedValue(Response.json({ asset, reused: true }));
    const result = await uploadBackgroundAsset(new File(["image"], "background.png", { type: "image/png" }));
    const options = fetchMock.mock.calls[0][1]!;
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).getAll("file")).toHaveLength(1);
    expect(options.headers).toBeUndefined();
    expect(result).toMatchObject({ reused: true, asset: { id } });
  });

  it("keeps quota and rate errors actionable without retrying uploads", async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: "내 배경은 최대 100개까지 보관할 수 있습니다.", code: "BACKGROUND_ASSET_LIMIT" }, { status: 409 }));
    await expect(uploadBackgroundAsset(new File(["image"], "background.png", { type: "image/png" }))).rejects.toThrow("100개");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("removes only the selected library entry", async () => {
    fetchMock.mockResolvedValue(Response.json({ removed: true, assetId: id }));
    await removeBackgroundAssetFromLibrary(id);
    expect(fetchMock).toHaveBeenCalledWith(`/api/background-assets/${id}`, expect.objectContaining({ method: "DELETE", credentials: "same-origin" }));
  });

  it("verifies authenticated normalized pixels before the caller can apply an image", async () => {
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 1080, height: 1920, close });
    vi.stubGlobal("createImageBitmap", decode);
    fetchMock.mockResolvedValue(new Response(new Blob(["webp"], { type: "image/webp" })));
    await verifyBackgroundAssetSelection(id);
    expect(decode).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a removed or inaccessible image instead of applying an empty background", async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: "배경 이미지를 찾을 수 없습니다." }, { status: 404 }));
    await expect(verifyBackgroundAssetSelection(id)).rejects.toThrow("찾을 수 없습니다");
  });

  it("rejects a malformed decoded image and releases its bitmap", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 20, height: 20, close }));
    fetchMock.mockResolvedValue(new Response(new Blob(["webp"], { type: "image/webp" })));
    await expect(verifyBackgroundAssetSelection(id)).rejects.toThrow("크기");
    expect(close).toHaveBeenCalledOnce();
  });
});
