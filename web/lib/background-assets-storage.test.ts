import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mocks.send;
    destroy = mocks.destroy;
  },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  GetObjectCommand: class { constructor(public input: unknown) {} },
}));

import {
  backgroundAssetObjectKey,
  getBackgroundAssetObject,
  putBackgroundAssetObject,
} from "@/lib/background-assets-storage";

const USER = "5576b6fc-edbf-4eb4-85df-f619e33befb0";
const ASSET = "710489ee-7318-48a1-b4d1-73573f3654ab";
const KEY = `custom-backgrounds/${USER}/${ASSET}.webp`;
const body = Buffer.from("normalized-webp-test");
const sha256 = createHash("sha256").update(body).digest("hex");
const reference = { userId: USER, assetId: ASSET, objectKey: KEY, byteSize: body.length, sha256 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AWS_S3_OUTPUT_BUCKET", "private-media-test");
  mocks.send.mockResolvedValue({
    ContentLength: body.length, ContentType: "image/webp",
    Body: { transformToByteArray: async () => body },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("private immutable background storage", () => {
  it("derives only canonical UUID-scoped WebP keys", () => {
    expect(backgroundAssetObjectKey(USER.toUpperCase(), ASSET.toUpperCase())).toBe(KEY);
    expect(() => backgroundAssetObjectKey("../../user", ASSET)).toThrow();
    expect(() => backgroundAssetObjectKey(USER, "https://example.com/file.webp")).toThrow();
  });

  it("uses a conditional immutable PUT with checksum and no public ACL", async () => {
    await putBackgroundAssetObject({ userId: USER, assetId: ASSET, body, sha256 });
    const command = mocks.send.mock.calls[0][0];
    expect(command.input).toEqual({
      Bucket: "private-media-test", Key: KEY, Body: body, ContentLength: body.length,
      ContentType: "image/webp", CacheControl: "private, no-store", IfNoneMatch: "*",
      ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
    });
    expect(command.input).not.toHaveProperty("ACL");
    expect(mocks.send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("does not send corrupted conversion bytes to the object store", async () => {
    await expect(putBackgroundAssetObject({ userId: USER, assetId: ASSET, body, sha256: "a".repeat(64) }))
      .rejects.toMatchObject({ code: "BACKGROUND_IMAGE_INVALID" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("reads only the derived owner key and verifies content metadata and hash", async () => {
    expect(await getBackgroundAssetObject(reference)).toEqual(body);
    expect(mocks.send.mock.calls[0][0].input).toEqual({ Bucket: "private-media-test", Key: KEY });
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("rejects a stored key from another owner or prefix before contacting storage", async () => {
    await expect(getBackgroundAssetObject({ ...reference, objectKey: "edit-sources/another.webp" }))
      .rejects.toMatchObject({ code: "BACKGROUND_ASSET_NOT_FOUND" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    { ContentLength: body.length + 1, ContentType: "image/webp" },
    { ContentLength: body.length, ContentType: "text/html" },
  ])("does not read a mismatched object body", async (metadata) => {
    const download = vi.fn();
    mocks.send.mockResolvedValue({ ...metadata, Body: { transformToByteArray: download } });
    await expect(getBackgroundAssetObject(reference)).rejects.toMatchObject({ code: "BACKGROUND_ASSET_UNAVAILABLE" });
    expect(download).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("rejects mutated stored bytes and always closes the client", async () => {
    mocks.send.mockResolvedValue({
      ContentLength: body.length, ContentType: "image/webp",
      Body: { transformToByteArray: async () => Buffer.alloc(body.length) },
    });
    await expect(getBackgroundAssetObject(reference)).rejects.toMatchObject({ code: "BACKGROUND_ASSET_UNAVAILABLE" });
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
