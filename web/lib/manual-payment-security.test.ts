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
const installmentsLibrary = readFileSync(
  new URL("./installments.ts", import.meta.url),
  "utf8",
);
const manualPaymentRouting = readFileSync(
  new URL("./manual-payment-routing.ts", import.meta.url),
  "utf8",
);
const vercelIgnore = readFileSync(
  new URL("../../.vercelignore", import.meta.url),
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

  it("keeps local payment-test overrides out of production billing paths", () => {
    for (const source of [
      activateRoute,
      addonRoute,
      installmentsRoute,
      installmentsLibrary,
      manualPaymentRouting,
    ]) {
      expect(source).not.toContain("@/lib/payment-test");
      expect(source).not.toContain("assertLocalManualCheckoutAccess");
      expect(source).not.toContain("isLocalManualCheckoutEnabled");
      expect(source).not.toContain("localManualCheckout");
      expect(source).not.toContain("THEPAYONE_LOCAL_MANUAL_CHECKOUT_ENABLED");
    }
  });

  it("keeps the shared runtime gate on every production manual-payment entrypoint", () => {
    expect(activateRoute).toContain(
      'await assertManualPaymentAvailable(db, "package")',
    );
    expect(addonRoute).toContain(
      'await assertManualPaymentAvailable(db, "addon")',
    );
    expect(installmentsRoute).toContain(
      "await resolveOneTimePaymentFlow(db, productKind)",
    );
  });

  it("excludes local payment helpers and generated caches from Vercel uploads", () => {
    for (const pattern of [
      "web/lib/payment-test.ts",
      "**/.ruff_cache/**",
      "**/.pytest_cache/**",
      "infra/aws/cdk.out/**",
      "infra/aws/cdk.context.json",
    ]) {
      expect(vercelIgnore).toContain(pattern);
    }
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
