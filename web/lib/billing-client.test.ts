import { afterEach, describe, expect, it, vi } from "vitest";
import {
  purchaseAddonWithSavedCard,
  purchasePlanWithSavedCard,
  replaceStoredPaymentMethod,
} from "./billing-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saved-card billing client", () => {
  it("purchases an add-on without resending full card or payer details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      orderId: "EC-ADD-test",
      addedMinutes: 100,
      chargedAmountKrw: 9_900,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await purchaseAddonWithSavedCard({
      addonCode: "minutes_100",
      expectedChargeAmountKrw: 9_900,
      identityNumber: "900101",
      cardPassword: "12",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/billing/addons/purchase");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      addonCode: "minutes_100",
      expectedChargeAmountKrw: 9_900,
      identityNumber: "900101",
      cardPassword: "12",
      consent: true,
    });
    expect(body.requestId).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("payerName");
    expect(body).not.toHaveProperty("payerEmail");
    expect(body).not.toHaveProperty("cardNumber");
    expect(body).not.toHaveProperty("expiryMonth");
    expect(body).not.toHaveProperty("expiryYear");
  });

  it.each([
    ["subscribe", "subscribe_saved"],
    ["change_subscription", "change_subscription_saved"],
  ] as const)("purchases a plan with the saved card for %s", async (mode, expectedMode) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      orderId: "EC-SUB-test",
      checkoutId: "checkout-id",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await purchasePlanWithSavedCard({
      mode,
      planCode: "starter_6m",
      billingCycle: "yearly",
      expectedChargeAmountKrw: 119_400,
      identityNumber: "900101",
      cardPassword: "12",
    });

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/billing/activate");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      mode: expectedMode,
      planCode: "starter_6m",
      billingCycle: "yearly",
      expectedChargeAmountKrw: 119_400,
      identityNumber: "900101",
      cardPassword: "12",
      consent: true,
      installmentMonths: 0,
      installmentCampaignId: null,
    });
    expect(body.requestId).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("payerName");
    expect(body).not.toHaveProperty("payerEmail");
    expect(body).not.toHaveProperty("cardNumber");
    expect(body).not.toHaveProperty("expiryMonth");
    expect(body).not.toHaveProperty("expiryYear");
  });

  it("replaces the stored card before continuing a purchase with another card", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      orderId: "EC-PMU-test",
      paymentMethodUpdated: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await replaceStoredPaymentMethod({
      requestId: "fe655ba8-c5c9-4fc3-ae77-ffcb1cc92c22",
      payerName: "홍길동",
      payerEmail: "buyer@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiryYear: "30",
      expiryMonth: "12",
      identityNumber: "900101",
      cardPassword: "12",
    });

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/billing/activate");
    expect(JSON.parse(String(init.body))).toEqual({
      mode: "replace_payment_method",
      requestId: "fe655ba8-c5c9-4fc3-ae77-ffcb1cc92c22",
      payerName: "홍길동",
      payerEmail: "buyer@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiryYear: "30",
      expiryMonth: "12",
      identityNumber: "900101",
      cardPassword: "12",
      consent: true,
      installmentMonths: 0,
      installmentCampaignId: null,
    });
  });
});
