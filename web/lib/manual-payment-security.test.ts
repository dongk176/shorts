import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const activateRoute = readFileSync(
  new URL("../app/api/billing/activate/route.ts", import.meta.url),
  "utf8",
);
const addonRoute = readFileSync(
  new URL("../app/api/billing/addons/purchase/route.ts", import.meta.url),
  "utf8",
);
const addonCheckoutRoute = readFileSync(
  new URL("../app/api/billing/addons/checkout/route.ts", import.meta.url),
  "utf8",
);
const installmentsRoute = readFileSync(
  new URL("../app/api/billing/installments/route.ts", import.meta.url),
  "utf8",
);
const webhookRoute = readFileSync(
  new URL("../app/api/webhooks/thepayone/[secret]/route.ts", import.meta.url),
  "utf8",
);
const checkoutOverlay = readFileSync(
  new URL("../app/pricing/plan-checkout-overlay.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../../supabase/migrations/202607300004_manual_onetime_payments.sql", import.meta.url),
  "utf8",
);

describe("manual payment sensitive-data boundaries", () => {
  it("does not create a stored payment method in the add-on manual branch", () => {
    const manualBranch = addonRoute.slice(
      addonRoute.indexOf('if (addonPaymentMode === "manual")'),
      addonRoute.indexOf('if ("paymentInputMode" in body)'),
    );
    expect(manualBranch).not.toContain("billing_payment_methods");
    expect(manualBranch).not.toContain("setDefaultPaymentMethod");
    expect(manualBranch).not.toContain("providerResponseCardLast4");
    expect(manualBranch).not.toContain(
      "provider_card_id_hash=${cardTokenHash(payment.cardId)}",
    );
  });

  it("closes the legacy add-on checkout endpoint outside legacy mode", () => {
    expect(addonCheckoutRoute).toContain(
      'if (addonPaymentMode !== "legacy")',
    );
    expect(addonCheckoutRoute).toContain("ADDON_LEGACY_CHECKOUT_DISABLED");
  });

  it("keeps package card hashes only for the legacy stored-card path", () => {
    expect(activateRoute).toContain(
      "provider_card_id_hash=${isManualPackage ? null : cardTokenHash(payment.cardId)}",
    );
    expect(activateRoute).not.toContain("providerResponseCardLast4");
  });

  it("stores webhook card references only for the default recurring scope", () => {
    expect(webhookRoute).toContain(
      'const includeStoredCardReference = eventCredentialScope === "default"',
    );
    expect(webhookRoute).toContain(
      "includeStoredCardReference ? cardTokenHash(event.cardId) : null",
    );
  });

  it("never writes checkout card fields to browser storage and scrubs old manual references", () => {
    expect(checkoutOverlay).not.toMatch(/\blocalStorage\b|\bsessionStorage\b/);
    expect(migration).toContain("set provider_card_id_hash=null");
    expect(migration).toContain("event_summary=event.event_summary-'last4'");
  });

  it("rechecks the local tester gate in both real manual-charge routes", () => {
    expect(installmentsRoute).toContain(
      "assertLocalManualCheckoutAccess(request, await requireMvpSession())",
    );
    expect(activateRoute).toContain(
      "assertLocalManualCheckoutAccess(request, session, { mutation: true })",
    );
    expect(addonRoute).toContain(
      "assertLocalManualCheckoutAccess(",
    );
    expect(addonRoute).toContain(
      "{ mutation: true }",
    );
  });

  it("forces debit and prepaid cards to cash and rechecks provider card type", () => {
    for (const route of [activateRoute, addonRoute]) {
      expect(route).toContain("declaredCardKind");
      expect(route).toContain("DEBIT_CARD_INSTALLMENT_NOT_ALLOWED");
      expect(route).toContain("thePayOneCardTypeAllowsInstallment");
      expect(route).toContain("providerResponseCardKindMatchesSelection");
    }
  });

  it("returns only a structured maximum for definite provider installment-limit rejections", () => {
    for (const route of [activateRoute, addonRoute]) {
      expect(route).toContain("thePayOneInstallmentMaxMonths");
      expect(route).toContain('"INSTALLMENT_LIMIT_EXCEEDED"');
      expect(route).toContain("maxInstallmentMonths: providerInstallmentMaxMonths");
      expect(route.indexOf("if (unknown && billingOrderId)")).toBeLessThan(
        route.indexOf("const providerInstallmentMaxMonths"),
      );
    }
  });
});
