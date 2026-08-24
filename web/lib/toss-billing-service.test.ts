import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  canRetireFailedTossInitialAttempt,
  registerTossBillingKey,
} from "@/lib/toss-billing-service";
import {
  TOSS_RUNTIME_ASSIGNMENTS_FLAG,
  TOSS_RUNTIME_CHARGES_FLAG,
  TOSS_RUNTIME_HANA_CARD_FLAG,
  TOSS_RUNTIME_RENEWALS_FLAG,
} from "@/lib/toss-billing-runtime";

describe("failed Toss initial purchase retirement", () => {
  it("retires only a conclusively failed pending initial purchase", () => {
    expect(canRetireFailedTossInitialAttempt({
      subscriptionStatus: "pending",
      orderKind: "subscription_initial",
      orderStatus: "failed",
      ledgerStatuses: ["failed"],
      fulfillmentStatuses: ["pending"],
    })).toBe(true);
  });

  it.each([
    { ledgerStatuses: [], fulfillmentStatuses: [] },
    { ledgerStatuses: ["unknown"], fulfillmentStatuses: ["pending"] },
    { ledgerStatuses: ["processing"], fulfillmentStatuses: ["pending"] },
    { ledgerStatuses: ["succeeded"], fulfillmentStatuses: ["applied"] },
  ])("keeps ambiguous or fulfilled attempts locked", (override) => {
    expect(canRetireFailedTossInitialAttempt({
      subscriptionStatus: "pending",
      orderKind: "subscription_initial",
      orderStatus: "failed",
      ledgerStatuses: override.ledgerStatuses,
      fulfillmentStatuses: override.fulfillmentStatuses,
    })).toBe(false);
  });
});

describe("Toss card-company review gate", () => {
  it("deletes an issued Hana billing key before persistence and never starts a charge", async () => {
    const begin = vi.fn();
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const statement = parts.join(" ");
      if (statement.includes("from shorts_mvp.billing_customer_cohorts")) {
        return [{
          cohort: "toss_v1",
          providerCustomerKey: "EC_customer_1",
          sourceReason: "no_historical_subscription_payment",
        }];
      }
      if (statement.includes("from shorts_mvp.billing_payment_methods")) return [];
      if (statement.includes("from shorts_mvp.runtime_feature_flags")) {
        return [
          { flagKey: TOSS_RUNTIME_ASSIGNMENTS_FLAG, enabled: true },
          { flagKey: TOSS_RUNTIME_CHARGES_FLAG, enabled: true },
          { flagKey: TOSS_RUNTIME_RENEWALS_FLAG, enabled: true },
          { flagKey: TOSS_RUNTIME_HANA_CARD_FLAG, enabled: false },
        ];
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    });
    Object.assign(query, { begin });
    const issue = vi.fn(async () => ({
      mId: "billing-mid",
      customerKey: "EC_customer_1",
      authenticatedAt: "2026-08-24T12:00:00+09:00",
      method: "카드",
      billingKey: "hana-billing-key",
      card: {
        issuerCode: "21",
        acquirerCode: "21",
        number: "12345678****1234",
        cardType: "신용",
        ownerType: "개인",
      },
    }));
    const removeIssuedKey = vi.fn(async () => undefined);

    await expect(registerTossBillingKey({
      userId: "user-1",
      authKey: "auth-key",
      paymentMethodId: "11111111-1111-4111-8111-111111111111",
      db: query as unknown as Sql,
      issue,
      removeIssuedKey,
    })).rejects.toMatchObject({ code: "TOSS_HANA_CARD_UNAVAILABLE" });

    expect(issue).toHaveBeenCalledOnce();
    expect(removeIssuedKey).toHaveBeenCalledExactlyOnceWith("hana-billing-key");
    expect(begin).not.toHaveBeenCalled();
  });
});
