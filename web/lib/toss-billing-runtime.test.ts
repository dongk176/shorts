import type { Sql } from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTossRuntimeChargesEnabled,
  isTossCardIssuerAllowed,
  isTossRuntimeFlag,
  loadTossBillingRuntimeState,
  TOSS_RUNTIME_ASSIGNMENTS_FLAG,
  TOSS_RUNTIME_CHARGES_FLAG,
  TOSS_RUNTIME_HANA_CARD_FLAG,
  TOSS_RUNTIME_RENEWALS_FLAG,
} from "@/lib/toss-billing-runtime";

function flagDb(rows: Array<{ flagKey: string; enabled: boolean }>) {
  return (async () => rows) as unknown as Sql;
}

function enableEnvironment() {
  vi.stubEnv("TOSS_BILLING_ENABLED", "true");
  vi.stubEnv("TOSS_BILLING_CHARGES_ENABLED", "true");
  vi.stubEnv("TOSS_BILLING_RENEWALS_ENABLED", "true");
  vi.stubEnv("TOSS_BILLING_COHORT_ASSIGNMENT_ENABLED", "true");
}

afterEach(() => vi.unstubAllEnvs());

describe("Toss billing runtime controls", () => {
  it("requires both the deployment ceiling and database switch", async () => {
    enableEnvironment();
    const state = await loadTossBillingRuntimeState(flagDb([
      { flagKey: TOSS_RUNTIME_ASSIGNMENTS_FLAG, enabled: true },
      { flagKey: TOSS_RUNTIME_CHARGES_FLAG, enabled: false },
      { flagKey: TOSS_RUNTIME_RENEWALS_FLAG, enabled: true },
      { flagKey: TOSS_RUNTIME_HANA_CARD_FLAG, enabled: false },
    ]));
    expect(state.stored).toEqual({
      assignments: true,
      charges: false,
      renewals: true,
      hanaCard: false,
    });
    expect(state.effective).toEqual({
      assignments: false,
      charges: false,
      renewals: false,
      hanaCard: false,
    });
  });

  it("fails closed when the runtime rows are missing", async () => {
    enableEnvironment();
    const state = await loadTossBillingRuntimeState(flagDb([]));
    expect(state.effective).toEqual({
      assignments: false,
      charges: false,
      renewals: false,
      hanaCard: false,
    });
    await expect(assertTossRuntimeChargesEnabled(flagDb([]))).rejects.toMatchObject({
      code: "TOSS_RUNTIME_CHARGES_DISABLED",
    });
  });

  it("accepts only the four audited runtime controls", () => {
    expect(isTossRuntimeFlag(TOSS_RUNTIME_CHARGES_FLAG)).toBe(true);
    expect(isTossRuntimeFlag(TOSS_RUNTIME_HANA_CARD_FLAG)).toBe(true);
    expect(isTossRuntimeFlag("unrelated_flag")).toBe(false);
  });

  it("blocks only Toss issuer code 21 until the Hana review switch is enabled", () => {
    expect(isTossCardIssuerAllowed({
      issuerCode: "21",
      hanaCardEnabled: false,
    })).toBe(false);
    expect(isTossCardIssuerAllowed({
      issuerCode: "21",
      hanaCardEnabled: true,
    })).toBe(true);
    expect(isTossCardIssuerAllowed({
      issuerCode: "11",
      hanaCardEnabled: false,
    })).toBe(true);
    expect(isTossCardIssuerAllowed({
      issuerCode: null,
      hanaCardEnabled: false,
    })).toBe(true);
  });
});
