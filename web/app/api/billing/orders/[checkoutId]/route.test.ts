import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
import { GET } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ userId: "owner" }); });
describe("ThePayOne upgrade refund status", () => {
  it.each(["manual_review", "completed"])("distinguishes a full deferred refund in %s from the successful new payment", async (status) => {
    mocks.db.mockResolvedValue([{ id, status: "succeeded", amountKrw: 198000, fullUpgradeRefund: true, hasUpgradeRefund: true, upgradeRefundStatus: status, refundAmountKrw: 9900 }]);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ checkoutId: id }) });
    expect(await response.json()).toMatchObject({ status: "succeeded", chargedAmountKrw: 198000, refund: { mode: "manual_full", amountKrw: 9900, status, processingBusinessDays: 0 } });
    expect(mocks.db.mock.calls[0]).toContain("owner");
  });
  it("preserves automatic full-refund reporting without a deferred ledger row", async () => {
    mocks.db.mockResolvedValue([{ id, status: "succeeded", hasUpgradeRefund: false, upgradeRefundStatus: "completed", refundAmountKrw: 9900 }]);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ checkoutId: id }) });
    expect((await response.json()).refund).toMatchObject({ mode: "automatic_full", processingBusinessDays: 0 });
  });
  it("preserves the existing partial-refund path", async () => {
    mocks.db.mockResolvedValue([{ id, status: "succeeded", hasUpgradeRefund: true, fullUpgradeRefund: false, upgradeRefundStatus: "pending", refundAmountKrw: 5000 }]);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ checkoutId: id }) });
    expect((await response.json()).refund).toMatchObject({ mode: "manual_partial", processingBusinessDays: 3 });
  });
});
