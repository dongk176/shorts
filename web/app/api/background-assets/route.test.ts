import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(), db: vi.fn(), access: vi.fn(), begin: vi.fn(), finish: vi.fn(),
  fail: vi.fn(), list: vi.fn(), normalize: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/custom-template-design-access", async (original) => ({
  ...await original<typeof import("@/lib/custom-template-design-access")>(), getCustomTemplateDesignAccess: mocks.access,
}));
vi.mock("@/lib/background-assets", () => ({
  beginBackgroundAssetUpload: mocks.begin,
  finishBackgroundAssetUpload: mocks.finish,
  failBackgroundAssetUpload: mocks.fail,
  listBackgroundAssets: mocks.list,
}));
vi.mock("@/lib/background-assets-image", () => ({ normalizeBackgroundAssetImage: mocks.normalize }));

import { GET, POST } from "./route";
import { BACKGROUND_ASSET_MULTIPART_MAX_BYTES } from "@/lib/background-assets-request";

const ORIGIN = "https://www.easycut.co.kr";
const USER = "5576b6fc-edbf-4eb4-85df-f619e33befb0";
const ASSET = "710489ee-7318-48a1-b4d1-73573f3654ab";
const db = {};
const reservation = { assetId: ASSET, userId: USER, objectKey: `custom-backgrounds/${USER}/${ASSET}.webp` };
const asset = { id: ASSET, displayName: "my.png", width: 1080, height: 1920, byteSize: 100, createdAt: "2026-08-31T00:00:00Z", imageUrl: `/api/background-assets/${ASSET}` };

function uploadRequest(options: { origin?: string | null; extra?: boolean } = {}) {
  const form = new FormData();
  form.set("file", new File(["png"], "my.png", { type: "image/png" }));
  if (options.extra) form.set("objectKey", "custom-backgrounds/other/evil.webp");
  return new Request(`${ORIGIN}/api/background-assets`, {
    method: "POST", body: form,
    headers: options.origin === null ? {} : { Origin: options.origin || ORIGIN },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.mockReturnValue(db);
  mocks.session.mockResolvedValue({ userId: USER });
  mocks.access.mockResolvedValue({ enabled: true });
  mocks.begin.mockResolvedValue(reservation);
  mocks.finish.mockResolvedValue({ asset, reused: false });
  mocks.fail.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue({ assets: [asset], quota: { listedCount: 1, pendingCount: 0, maxListed: 100, bytesUsed: 100, maxBytes: 1024 ** 3 } });
  mocks.normalize.mockResolvedValue({ body: Buffer.from("webp") });
});

describe("GET background assets", () => {
  it("lists only authenticated owned assets with no shared cache or release/paid gate", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ assets: [{ id: ASSET }] });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.list).toHaveBeenCalledWith(db, USER);
    expect(mocks.session).toHaveBeenCalledWith({ allowPaymentMethodRemediation: true });
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("requires login before accessing the asset repository", async () => {
    mocks.session.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));
    expect((await GET()).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe("POST background asset", () => {
  it("reserves before decoding and returns a stable owned asset ID, never a key", async () => {
    const response = await POST(uploadRequest());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ asset, reused: false });
    expect(mocks.begin).toHaveBeenCalledWith(db, USER, { originalByteSize: 3, displayName: "my.png" });
    expect(mocks.begin.mock.invocationCallOrder[0]).toBeLessThan(mocks.normalize.mock.invocationCallOrder[0]);
    expect(mocks.normalize).toHaveBeenCalledWith(Buffer.from("png"), { filename: "my.png", contentType: "image/png" });
    expect(mocks.finish).toHaveBeenCalledWith(db, reservation, { body: Buffer.from("webp") });
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("returns a reused asset without pretending a new object was created", async () => {
    mocks.finish.mockResolvedValue({ asset, reused: true });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ asset, reused: true });
  });

  it.each([null, "https://attacker.example"])("rejects missing/cross-site Origin before authentication or parsing", async (origin) => {
    const response = await POST(uploadRequest({ origin }));
    expect(response.status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("does not decode or reserve when the release is disabled", async () => {
    mocks.access.mockResolvedValue({ enabled: false });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "CUSTOM_TEMPLATE_DESIGN_DISABLED" });
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it("returns rate limiting before decode and does not allocate an extra cleanup request", async () => {
    mocks.begin.mockRejectedValue(new HttpError(429, "잠시 후 다시 시도해 주세요.", "BACKGROUND_UPLOAD_RATE_LIMIT", 60));
    const response = await POST(uploadRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.normalize).not.toHaveBeenCalled();
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("releases only the pending reservation on invalid image/failed storage and preserves the primary error", async () => {
    mocks.normalize.mockRejectedValue(new HttpError(400, "움직이는 이미지는 사용할 수 없습니다.", "BACKGROUND_IMAGE_ANIMATED"));
    mocks.fail.mockRejectedValue(new Error("DB temporarily unavailable"));
    const response = await POST(uploadRequest());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BACKGROUND_IMAGE_ANIMATED" });
    expect(mocks.fail).toHaveBeenCalledWith(db, reservation);
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("hands ambiguous storage failures to the reservation cleanup path", async () => {
    mocks.finish.mockRejectedValue(new HttpError(503, "배경 이미지 저장을 완료하지 못했습니다.", "BACKGROUND_STORAGE_UNAVAILABLE"));
    const response = await POST(uploadRequest());
    expect(response.status).toBe(503);
    expect(mocks.fail).toHaveBeenCalledWith(db, reservation);
  });

  it("rejects arbitrary fields such as user paths and asset owners", async () => {
    expect((await POST(uploadRequest({ extra: true }))).status).toBe(400);
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("bounds actual multipart bytes even if Content-Length lies", async () => {
    const response = await POST(new Request(`${ORIGIN}/api/background-assets`, {
      method: "POST", body: new Uint8Array(BACKGROUND_ASSET_MULTIPART_MAX_BYTES + 1),
      headers: { Origin: ORIGIN, "Content-Type": "multipart/form-data; boundary=test", "Content-Length": "1" },
    }));
    expect(response.status).toBe(413);
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it("requires multipart file upload, not Base64 JSON or external URL", async () => {
    const response = await POST(new Request(`${ORIGIN}/api/background-assets`, {
      method: "POST", body: JSON.stringify({ url: "https://example.com/image.png" }),
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(415);
    expect(mocks.begin).not.toHaveBeenCalled();
  });
});
