import { describe, expect, it } from "vitest";
import type { BillingSummary } from "@/lib/contracts";
import type { TossBillingState } from "@/lib/toss-billing-state";
import {
  thePayOnePlanManagementView,
  tossPlanManagementView,
} from "./plan-management-model";

describe("plan management view", () => {
  it("shows the current and scheduled Toss plans without exposing a partial card mask", () => {
    const state = {
      subscription: {
        id: "sub-toss",
        plan: {
          code: "toss_starter_6m",
          displayName: "스타터",
          contractMonths: 6,
          monthlyQuotaSeconds: 12_000,
          maxActiveJobs: 2,
          guidebookIncluded: true,
        },
        currentPeriodStart: "2026-08-20T14:53:59.000Z",
        currentPeriodEnd: "2027-02-20T14:53:59.000Z",
        nextQuotaAt: "2026-09-20T14:53:59.000Z",
        cancelAtPeriodEnd: false,
        scheduledPlan: {
          code: "toss_easycut_pro_6m",
          displayName: "이지컷 프로",
          contractMonths: 6,
          monthlyQuotaSeconds: 3_600,
          maxActiveJobs: 1,
          guidebookIncluded: false,
        },
        scheduledChangeEffectiveAt: "2027-02-20T14:53:59.000Z",
        paymentMethod: {
          issuerCode: "11",
          cardNumberMasked: "43368900****310*",
          cardLast4: null,
        },
      },
    } as unknown as TossBillingState;

    const view = tossPlanManagementView(state);
    expect(view.plans[0]).toMatchObject({
      name: "스타터",
      termLabel: "6개월",
      monthlyMinutes: 200,
      maxActiveJobs: 2,
    });
    expect(view.nextPlan).toMatchObject({
      name: "이지컷 프로",
      monthlyMinutes: 60,
      effectiveAt: "2027-02-20T14:53:59.000Z",
    });
    expect(view.paymentMethod).toEqual({
      providerLabel: "토스페이먼츠",
      issuer: "하나카드",
      cardLabel: null,
    });
  });

  it("shows every active legacy product and only allows ThePayOne EasyCut Pro cancellation", () => {
    const state = {
      activeProducts: [
        {
          planCode: "easycut_pro_v2",
          displayName: "이지컷 프로",
          billingCycle: "monthly",
          currentPeriodStart: "2026-08-01T00:00:00.000Z",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          nextChargeAt: "2026-09-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          monthlySourceSeconds: 3_600,
        },
        {
          planCode: "starter_6m",
          displayName: "스타터 패키지 6개월",
          billingCycle: "yearly",
          currentPeriodStart: "2026-08-10T00:00:00.000Z",
          currentPeriodEnd: "2027-02-10T00:00:00.000Z",
          nextChargeAt: null,
          cancelAtPeriodEnd: false,
          monthlySourceSeconds: 12_000,
        },
      ],
      paymentProvider: "thepayone",
      cardIssuer: "국민카드",
      cardNumberMasked: "12345678****9876",
      cardLast4: "9876",
      cancelAtPeriodEnd: false,
      scheduledPlanCode: null,
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    } as unknown as BillingSummary;

    const view = thePayOnePlanManagementView(state);
    expect(view.plans).toHaveLength(2);
    expect(view.plans[0]).toMatchObject({
      name: "이지컷 프로",
      monthlyMinutes: 60,
      canCancel: true,
    });
    expect(view.plans[1]).toMatchObject({
      name: "스타터 패키지 6개월",
      monthlyMinutes: 200,
      canCancel: false,
    });
    expect(view.paymentMethod).toEqual({
      providerLabel: "더페이원",
      issuer: "국민카드",
      cardLabel: "••9876",
    });
  });
});
