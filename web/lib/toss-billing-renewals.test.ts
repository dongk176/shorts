import { describe, expect, it } from "vitest";
import {
  collectTossQuotaWindows,
  decideTossRenewalAttempt,
} from "@/lib/toss-billing-renewals";

describe("decideTossRenewalAttempt", () => {
  const now = new Date("2026-08-20T00:00:00.000Z");

  it("fulfills a provider-approved order before considering another charge", () => {
    expect(decideTossRenewalAttempt({
      orderStatus: "succeeded",
      attempts: [{ attemptNo: 1, nextRetryAt: null, status: "succeeded" }],
      now,
    })).toEqual({ action: "fulfill" });
  });

  it("reconciles an unknown result instead of charging again", () => {
    expect(decideTossRenewalAttempt({
      orderStatus: "unknown",
      attempts: [{ attemptNo: 1, nextRetryAt: now, status: "unknown" }],
      now,
    })).toEqual({ action: "reconcile" });
  });

  it("creates the first charge only when no prior attempt exists", () => {
    expect(decideTossRenewalAttempt({
      orderStatus: "pending",
      attempts: [],
      now,
    })).toEqual({ action: "charge", attemptNo: 1 });
  });

  it("waits until the persisted retry time", () => {
    expect(decideTossRenewalAttempt({
      orderStatus: "failed",
      attempts: [{
        attemptNo: 1,
        nextRetryAt: new Date("2026-08-20T00:05:00.000Z"),
        status: "failed",
      }],
      now,
    })).toEqual({ action: "wait" });
  });

  it("advances to the next attempt after the retry time", () => {
    expect(decideTossRenewalAttempt({
      orderStatus: "failed",
      attempts: [{
        attemptNo: 1,
        nextRetryAt: new Date("2026-08-19T23:59:00.000Z"),
        status: "failed",
      }],
      now,
    })).toEqual({ action: "charge", attemptNo: 2 });
  });

  it("never charges beyond the retry ceiling", () => {
    expect(decideTossRenewalAttempt({
      orderStatus: "failed",
      attempts: [{ attemptNo: 3, nextRetryAt: now, status: "failed" }],
      now,
    })).toEqual({ action: "exhausted" });
  });
});

describe("collectTossQuotaWindows", () => {
  it("creates one monthly window without extending past the contract", () => {
    const result = collectTossQuotaWindows({
      nextQuotaAt: new Date("2026-09-20T00:00:00.000Z"),
      contractEnd: new Date("2026-11-20T00:00:00.000Z"),
      billingAnchorDay: 20,
      now: new Date("2026-10-25T00:00:00.000Z"),
    });
    expect(result.windows).toEqual([
      {
        validFrom: new Date("2026-09-20T00:00:00.000Z"),
        expiresAt: new Date("2026-10-20T00:00:00.000Z"),
      },
      {
        validFrom: new Date("2026-10-20T00:00:00.000Z"),
        expiresAt: new Date("2026-11-20T00:00:00.000Z"),
      },
    ]);
    expect(result.nextQuotaAt).toEqual(new Date("2026-11-20T00:00:00.000Z"));
  });

  it("does not issue quota at or after the contract boundary", () => {
    expect(collectTossQuotaWindows({
      nextQuotaAt: new Date("2026-11-20T00:00:00.000Z"),
      contractEnd: new Date("2026-11-20T00:00:00.000Z"),
      billingAnchorDay: 20,
      now: new Date("2026-11-20T00:00:00.000Z"),
    }).windows).toEqual([]);
  });

  it("caps catch-up work so a damaged row cannot create unbounded grants", () => {
    const result = collectTossQuotaWindows({
      nextQuotaAt: new Date("2025-01-20T00:00:00.000Z"),
      contractEnd: new Date("2027-01-20T00:00:00.000Z"),
      billingAnchorDay: 20,
      now: new Date("2026-08-20T00:00:00.000Z"),
      maxWindows: 3,
    });
    expect(result.windows).toHaveLength(3);
  });
});
