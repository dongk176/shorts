import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: vi.fn() }));
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/paddle/service", () => ({
  preparePaddleCheckout: vi.fn(),
  resumePaddleCheckout: vi.fn(),
  cancelPaddleCheckout: vi.fn(),
}));
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  preparePaddleCheckout,
  resumePaddleCheckout,
} from "@/lib/paddle/service";
import { HttpError } from "@/lib/http";
import { POST } from "./route";
const request = (body: unknown, origin = "https://www.easycut.co.kr") =>
  new Request("https://www.easycut.co.kr/api/paddle/checkout", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PADDLE_ENABLED", "true");
  vi.stubEnv("PADDLE_ENVIRONMENT", "live");
  vi.stubEnv("PADDLE_CLIENT_TOKEN", "live_public_test");
  vi.mocked(requireAuthenticatedMvpSession).mockResolvedValue({
    userId: "owner",
  } as Awaited<ReturnType<typeof requireAuthenticatedMvpSession>>);
  vi.mocked(preparePaddleCheckout).mockResolvedValue("txn_" + "a".repeat(26));
});
describe("authenticated checkout boundary", () => {
  it("rejects an unauthenticated buyer before creating any transaction", async () => {
    vi.mocked(requireAuthenticatedMvpSession).mockRejectedValue(
      new HttpError(401, "Login required"),
    );
    expect(
      (await POST(request({ planCode: "paddle_lite", locale: "en" }))).status,
    ).toBe(401);
    expect(preparePaddleCheckout).not.toHaveBeenCalled();
  });
  it("uses the signed-in owner and fixed currency mapping, ignoring no client-supplied price", async () => {
    const response = await POST(
      request({ planCode: "paddle_lite", locale: "ja" }),
    );
    expect(response.status).toBe(200);
    expect(preparePaddleCheckout).toHaveBeenCalledWith(
      "owner",
      "paddle_lite",
      "JPY",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(
      (
        await POST(
          request({
            planCode: "paddle_lite",
            locale: "ja",
            price: 1,
            userId: "other",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("rejects cross-origin requests", async () => {
    expect(
      (
        await POST(
          request(
            { planCode: "paddle_lite", locale: "en" },
            "https://evil.test",
          ),
        )
      ).status,
    ).toBe(403);
    expect(preparePaddleCheckout).not.toHaveBeenCalled();
  });
  it("does not create transactions before client configuration is ready", async () => {
    vi.stubEnv("PADDLE_CLIENT_TOKEN", "");
    expect(
      (await POST(request({ planCode: "paddle_lite", locale: "en" }))).status,
    ).toBe(503);
    expect(preparePaddleCheckout).not.toHaveBeenCalled();
  });
  it("checks transaction ownership when resuming", async () => {
    const id = "txn_" + "a".repeat(26);
    vi.mocked(resumePaddleCheckout).mockRejectedValue(
      new HttpError(404, "not found"),
    );
    expect((await POST(request({ transactionId: id }))).status).toBe(404);
    expect(resumePaddleCheckout).toHaveBeenCalledWith("owner", id);
  });
});
