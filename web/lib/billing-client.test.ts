import { afterEach, describe, expect, it, vi } from "vitest";
import { purchaseAddonWithSavedCard } from "./billing-client";

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
});
