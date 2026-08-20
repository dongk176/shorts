import { describe, expect, it } from "vitest";
import {
  cohortForBillingEvidence,
  requirePersistedTossBillingCustomer,
} from "@/lib/billing-cohort";

describe("billing customer cohort", () => {
  it("never changes an already assigned cohort", () => {
    expect(cohortForBillingEvidence({
      existing: {
        cohort: "legacy_thepayone",
        providerCustomerKey: null,
        persisted: true,
        reason: "historical_payment",
      },
      hasHistoricalNonTossPayment: false,
      hasHistoricalNonTossSubscription: false,
      hasHistoricalNonTossPaymentMethod: false,
      assignmentEnabled: true,
    })).toBe("legacy_thepayone");
  });

  it("allows Toss mutations only for an explicitly persisted Toss customer", () => {
    expect(requirePersistedTossBillingCustomer({
      cohort: "toss_v1",
      providerCustomerKey: "EC_customer_1",
      persisted: true,
      reason: "no_historical_subscription_payment",
    })).toMatchObject({
      cohort: "toss_v1",
      providerCustomerKey: "EC_customer_1",
    });

    expect(() => requirePersistedTossBillingCustomer({
      cohort: "legacy_thepayone",
      providerCustomerKey: null,
      persisted: true,
      reason: "historical_non_toss_subscription_payment",
    })).toThrow("Toss billing is not allowed");
    expect(() => requirePersistedTossBillingCustomer({
      cohort: "toss_v1",
      providerCustomerKey: "EC_unpersisted",
      persisted: false,
      reason: "classification_failed_closed",
    })).toThrow("Toss billing is not allowed");
  });

  it("routes every historical subscriber to ThePayOne", () => {
    expect(cohortForBillingEvidence({
      hasHistoricalNonTossPayment: true,
      hasHistoricalNonTossSubscription: false,
      hasHistoricalNonTossPaymentMethod: false,
      assignmentEnabled: true,
    })).toBe("legacy_thepayone");
    expect(cohortForBillingEvidence({
      hasHistoricalNonTossPayment: false,
      hasHistoricalNonTossSubscription: true,
      hasHistoricalNonTossPaymentMethod: false,
      assignmentEnabled: true,
    })).toBe("legacy_thepayone");
    expect(cohortForBillingEvidence({
      hasHistoricalNonTossPayment: false,
      hasHistoricalNonTossSubscription: false,
      hasHistoricalNonTossPaymentMethod: true,
      assignmentEnabled: true,
    })).toBe("legacy_thepayone");
  });

  it("keeps a current legacy entitlement out of Toss even without a saved payment method", () => {
    expect(cohortForBillingEvidence({
      hasHistoricalNonTossPayment: false,
      hasHistoricalNonTossSubscription: true,
      hasHistoricalNonTossPaymentMethod: false,
      assignmentEnabled: true,
    })).toBe("legacy_thepayone");
  });

  it("keeps an active legacy base grant out of Toss", () => {
    expect(cohortForBillingEvidence({
      hasHistoricalNonTossPayment: false,
      hasHistoricalNonTossSubscription: false,
      hasHistoricalNonTossPaymentMethod: false,
      hasActiveLegacyBaseGrant: true,
      assignmentEnabled: true,
    })).toBe("legacy_thepayone");
  });

  it("admits never-paid customers only while assignment is explicitly enabled", () => {
    expect(cohortForBillingEvidence({
      hasHistoricalNonTossPayment: false,
      hasHistoricalNonTossSubscription: false,
      hasHistoricalNonTossPaymentMethod: false,
      assignmentEnabled: false,
    })).toBe("legacy_thepayone");
    expect(cohortForBillingEvidence({
      hasHistoricalNonTossPayment: false,
      hasHistoricalNonTossSubscription: false,
      hasHistoricalNonTossPaymentMethod: false,
      assignmentEnabled: true,
    })).toBe("toss_v1");
  });
});
