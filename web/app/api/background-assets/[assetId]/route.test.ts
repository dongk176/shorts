import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), image: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/background-assets", () => ({ getBackgroundAssetImage: mocks.image, removeBackgroundAssetFromLibrary: mocks.remove }));

import { DELETE, GET } from "./route";

const ORIGIN = "https://www.easycut.co.kr";
const USER = "5576b6fc-edbf-4eb4-85df-f619e33befb0";
const ASSET = "710489ee-7318-48a1-b4d1-73573f3654ab";
const db = {};
const context = { params: Promise.resolve({ assetId: ASSET }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.mockReturnValue(db);
  mocks.session.mockResolvedValue({ userId: USER });
  mocks.image.mockResolvedValue({ body: Buffer.from("webp"), byteSize: 4, sha256: "a".repeat(64) });
  mocks.remove.mockResolvedValue({ removed: true, assetId: ASSET });
});

describe("GET owned background image", () => {
  it("returns authenticated private bytes without a public/expiring redirect", async () => {
    const response = await GET(new Request(`${ORIGIN}/api/background-assets/${ASSET}`), context);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("webp");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.image).toHaveBeenCalledWith(db, USER, ASSET);
    expect(mocks.session).toHaveBeenCalledWith({ allowPaymentMethodRemediation: true });
  });

  it("keeps missing and another owner's image indistinguishable", async () => {
    mocks.image.mockRejectedValue(new HttpError(404, "배경 이미지를 찾을 수 없습니다.", "BACKGROUND_ASSET_NOT_FOUND"));
    const response = await GET(new Request(`${ORIGIN}/api/background-assets/${ASSET}`), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "BACKGROUND_ASSET_NOT_FOUND" });
  });

  it("rejects malformed identifiers and unauthenticated access", async () => {
    const response = await GET(new Request(`${ORIGIN}/api/background-assets/invalid`), { params: Promise.resolve({ assetId: "invalid" }) });
    expect(response.status).toBe(400);
    expect(mocks.image).not.toHaveBeenCalled();
    mocks.session.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));
    expect((await GET(new Request(`${ORIGIN}/api/background-assets/${ASSET}`), context)).status).toBe(401);
  });
});

describe("DELETE owned library item", () => {
  it("removes only the owner's library entry and accepts no external paths", async () => {
    const response = await DELETE(new Request(`${ORIGIN}/api/background-assets/${ASSET}`, {
      method: "DELETE", headers: { Origin: ORIGIN },
    }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: true, assetId: ASSET });
    expect(mocks.remove).toHaveBeenCalledWith(db, USER, ASSET);
    expect(mocks.session).toHaveBeenCalledWith({ allowPaymentMethodRemediation: true });
  });

  it("blocks cross-site removal even for a valid signed-in session", async () => {
    const response = await DELETE(new Request(`${ORIGIN}/api/background-assets/${ASSET}`, {
      method: "DELETE", headers: { Origin: "https://attacker.example" },
    }), context);
    expect(response.status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
