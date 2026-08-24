import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overlaySource = readFileSync(
  new URL("./payment-message-overlay.tsx", import.meta.url),
  "utf8",
);
const pricingSource = readFileSync(
  new URL("../app/pricing/pricing-client.tsx", import.meta.url),
  "utf8",
);

describe("PaymentMessageOverlay", () => {
  it("supports separate action and cancel callbacks", () => {
    expect(overlaySource).toContain("onAction?: () => void");
    expect(overlaySource).toContain("onClick={onAction}");
    expect(overlaySource).toContain("(actionHref || onAction)");
  });

  it("warns before opening the resubscription payment form", () => {
    expect(pricingSource).toContain("setResubscribeConfirmationOpen(true)");
    expect(pricingSource).toContain("원이 즉시 결제됩니다");
    expect(pricingSource).toContain("새로운 유료 결제입니다");
    expect(pricingSource).toContain('actionLabel="결제 정보 확인하기"');
    expect(pricingSource).toContain("setResubscribeAuth({");
  });
});
