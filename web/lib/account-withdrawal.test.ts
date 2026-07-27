import { describe, expect, it } from "vitest";
import {
  blocksAccountWithdrawal,
  isAccountWithdrawalConfirmation,
  type WithdrawalSubscription,
} from "./account-withdrawal";

const base: WithdrawalSubscription = {
  status: "active",
  billingCycle: "monthly",
  paymentMethodId: "method-1",
  cancelAtPeriodEnd: false,
  providerScheduleStatus: "active",
};

describe("account withdrawal subscription guard", () => {
  it("blocks an active recurring charge and an in-flight subscription", () => {
    expect(blocksAccountWithdrawal(base)).toBe(true);
    expect(blocksAccountWithdrawal({ ...base, status: "pending" })).toBe(true);
  });

  it("allows withdrawal after recurring billing is canceled and paused", () => {
    expect(blocksAccountWithdrawal({
      ...base,
      cancelAtPeriodEnd: true,
      providerScheduleStatus: "paused",
    })).toBe(false);
  });

  it("allows forfeiting a non-recurring package", () => {
    expect(blocksAccountWithdrawal({
      ...base,
      billingCycle: "yearly",
      paymentMethodId: null,
    })).toBe(false);
  });
});

describe("account withdrawal confirmation", () => {
  it("requires the full localized destructive-action phrase", () => {
    expect(isAccountWithdrawalConfirmation("회원탈퇴")).toBe(true);
    expect(isAccountWithdrawalConfirmation(" DELETE ACCOUNT ")).toBe(true);
    expect(isAccountWithdrawalConfirmation("アカウント削除")).toBe(true);
  });

  it("rejects shortened, boolean, and case-mismatched confirmations", () => {
    expect(isAccountWithdrawalConfirmation("탈퇴")).toBe(false);
    expect(isAccountWithdrawalConfirmation("delete account")).toBe(false);
    expect(isAccountWithdrawalConfirmation(true)).toBe(false);
  });
});
