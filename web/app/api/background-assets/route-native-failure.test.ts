import { beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(), list: vi.fn(), begin: vi.fn(), loadDecoder: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/custom-template-design-access", () => ({
  getCustomTemplateDesignAccess: async () => ({ enabled: true }),
  assertCustomTemplateDesignAccess: () => undefined,
}));
vi.mock("@/lib/background-assets", () => ({
  listBackgroundAssets: mocks.list,
  beginBackgroundAssetUpload: mocks.begin,
  finishBackgroundAssetUpload: vi.fn(),
  failBackgroundAssetUpload: vi.fn(),
}));
vi.mock("@/lib/background-assets-image", () => {
  mocks.loadDecoder();
  throw new Error('Could not load the "sharp" module using the linux-x64 runtime');
});

import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: "owner" });
  mocks.list.mockResolvedValue({ assets: [], quota: { listedCount: 0 } });
});

it("keeps the owner's library readable even when the native decoder cannot load", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ assets: [], quota: { listedCount: 0 } });
  expect(mocks.list).toHaveBeenCalledWith({}, "owner");
  expect(mocks.loadDecoder).not.toHaveBeenCalled();
});

it("retains the unauthenticated gate even when the decoder is broken", async () => {
  mocks.session.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));
  expect((await GET()).status).toBe(401);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.loadDecoder).not.toHaveBeenCalled();
});

it("returns a retryable upload error without reserving quota or exposing native paths", async () => {
  const form = new FormData();
  form.set("file", new File(["png"], "test.png", { type: "image/png" }));
  const response = await POST(new Request("https://www.easycut.co.kr/api/background-assets", {
    method: "POST", headers: { Origin: "https://www.easycut.co.kr" }, body: form,
  }));
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("2");
  expect(await response.json()).toEqual({
    code: "BACKGROUND_IMAGE_PROCESSOR_UNAVAILABLE",
    detail: "배경 이미지 처리 기능을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  });
  expect(mocks.begin).not.toHaveBeenCalled();
});
