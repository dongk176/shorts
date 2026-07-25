import { afterEach, describe, expect, it, vi } from "vitest";
import { requestNicepayOneTimePayment } from "./nicepay-browser";

describe("requestNicepayOneTimePayment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the required fnError callback to the live checkout SDK", async () => {
    const requestPay = vi.fn();
    const alert = vi.fn();
    vi.stubGlobal("window", {
      AUTHNICE: { requestPay },
      alert,
    });

    await requestNicepayOneTimePayment({
      clientId: "S1_test",
      sdkUrl: "https://pay.nicepay.co.kr/v1/js/",
      method: "card",
      orderId: "EASYCUT_TEST_ORDER",
      amount: 1_000,
      goodsName: "Easy Cut 테스트",
      returnUrl: "http://localhost:3000/api/payment-test/one-time-return",
    });

    expect(requestPay).toHaveBeenCalledOnce();
    const request = requestPay.mock.calls[0]?.[0] as { fnError?: (value: unknown) => void };
    expect(request.fnError).toEqual(expect.any(Function));

    request.fnError?.({ errorMsg: "결제창 테스트 오류" });
    expect(alert).toHaveBeenCalledWith("결제창 테스트 오류");
  });

  it("uses English checkout for English and Japanese site locales", async () => {
    const requestPay = vi.fn();
    vi.stubGlobal("window", { AUTHNICE: { requestPay }, alert: vi.fn() });
    vi.stubGlobal("document", { documentElement: { lang: "ja" } });

    await requestNicepayOneTimePayment({
      clientId: "S1_test",
      sdkUrl: "https://pay.nicepay.co.kr/v1/js/",
      method: "card",
      orderId: "EASYCUT_TEST_ORDER_JA",
      amount: 1_000,
      goodsName: "Easy Cut",
      returnUrl: "http://localhost:3000/api/billing/addons/return",
    });

    expect(requestPay).toHaveBeenCalledWith(expect.objectContaining({ language: "EN" }));
  });
});
