import { afterEach, describe, expect, it, vi } from "vitest";
import { requestThePayOnePayment } from "./thepayone-browser";

describe("requestThePayOnePayment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens TPO.pay without trusting or logging the browser result", async () => {
    const pay = vi.fn();
    const debug = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("window", { TPO: { pay, debug }, location: { assign } });

    await requestThePayOnePayment({
      checkoutId: "7eb5f6d5-2cf4-45a9-86f1-b7e96a11741a",
      sdkUrl: "https://api.thepayone.com/js/clientside.js",
      publicKey: "pk_test",
      amount: 9_900,
      trackId: "EC-ADD-ORDER",
      webhookUrl: "https://example.com/api/webhooks/thepayone/secret-value-long-enough",
      udf1: "7eb5f6d5-2cf4-45a9-86f1-b7e96a11741a",
      udf2: "addon",
      payerName: "테스트",
      payerEmail: "tester@example.com",
      payerTel: "01012345678",
      products: [{ name: "추가 100분", price: "9900", qty: "1", desc: "90일" }],
      pendingUrl: "/billing/success?status=pending",
    });

    expect(debug).toHaveBeenCalledWith(false);
    expect(pay).toHaveBeenCalledWith(expect.objectContaining({
      amount: "9900",
      publicKey: "pk_test",
      trackId: "EC-ADD-ORDER",
      payerTel: "01012345678",
      responseFunction: expect.any(Function),
    }));
    const input = pay.mock.calls[0]?.[0] as { responseFunction: () => void };
    input.responseFunction();
    expect(assign).toHaveBeenCalledWith("/billing/success?status=pending");
  });

  it("rejects an unexpected SDK origin", async () => {
    vi.stubGlobal("window", {});
    await expect(requestThePayOnePayment({
      checkoutId: "id",
      sdkUrl: "https://attacker.example/clientside.js",
      publicKey: "pk",
      amount: 1_000,
      trackId: "track",
      webhookUrl: "https://example.com/webhook",
      udf1: "id",
      udf2: "addon",
      payerName: "name",
      payerEmail: "test@example.com",
      payerTel: "01012345678",
      products: [],
      pendingUrl: "/billing/success",
    })).rejects.toThrow("SDK 주소");
  });

  it("replays DOMContentLoaded for the provider SDK when it is loaded after the page", async () => {
    let initialized = false;
    const pay = vi.fn();
    const debug = vi.fn();
    const sdk = { pay, debug, cyrexpop: vi.fn() };
    vi.stubGlobal("window", { TPO: sdk, location: { assign: vi.fn() } });
    vi.stubGlobal("document", {
      readyState: "complete",
      getElementById: vi.fn((id: string) => id === "cyrexpop_iframe" && initialized ? {} : null),
      dispatchEvent: vi.fn(() => {
        initialized = true;
        return true;
      }),
    });
    vi.stubGlobal("Event", class {
      constructor(readonly type: string) {}
    });

    await requestThePayOnePayment({
      checkoutId: "id",
      sdkUrl: "https://api.thepayone.com/js/clientside.js",
      publicKey: "pk",
      amount: 1_000,
      trackId: "track",
      webhookUrl: "https://example.com/webhook",
      udf1: "id",
      udf2: "addon",
      payerName: "name",
      payerEmail: "test@example.com",
      payerTel: "01012345678",
      products: [],
      pendingUrl: "/billing/success",
    });

    expect(document.dispatchEvent).toHaveBeenCalledOnce();
    expect(pay).toHaveBeenCalledOnce();
  });
});
