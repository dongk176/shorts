import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  billing: vi.fn(),
  db: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireMvpSession: mocks.session }));
vi.mock("@/lib/billing", () => ({ getBillingSummary: mocks.billing }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
import { getStrategyLibraryAccess } from "./library-access";
const user = { id: "identity-provider-id" } as User;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.mockReturnValue("db");
  mocks.session.mockResolvedValue({ userId: "application-user-id" });
});
describe("library entitlement presentation", () => {
  it("does not connect to billing or sessions for guests", async () => {
    expect(await getStrategyLibraryAccess(null)).toBe("guest");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("resolves the internal billing user ID without creating or mutating sessions", async () => {
    mocks.billing.mockResolvedValue({
      hasPaymentHistory: true,
      activeProducts: [
        {
          planCode: "pro",
          currentPeriodStart: "2020-01-01",
          currentPeriodEnd: "2099-01-01",
        },
      ],
    });
    expect(await getStrategyLibraryAccess(user)).toBe("paid");
    expect(mocks.session).toHaveBeenCalledWith(user, {
      readOnly: true,
      createIfMissing: false,
    });
    expect(mocks.billing).toHaveBeenCalledWith("db", "application-user-id");
  });
  it("distinguishes a free account from an unavailable billing service", async () => {
    mocks.billing
      .mockResolvedValueOnce({ hasPaymentHistory: false, activeProducts: [] })
      .mockRejectedValueOnce(new Error("unavailable"));
    expect(await getStrategyLibraryAccess(user)).toBe("free");
    expect(await getStrategyLibraryAccess(user)).toBe("unavailable");
  });
});
