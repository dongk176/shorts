import { describe, expect, it, vi } from "vitest";
import { recordPopularFilterUsage } from "./popular-filter-usage";

function databaseWithResponses(...responses: Array<Array<Record<string, unknown>>>) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(responses.shift() || []);
  });
  return { db, calls };
}

describe("popular filter usage evidence", () => {
  it("attributes use to the selected active entitlement and stores the filter snapshot", async () => {
    const { db, calls } = databaseWithResponses(
      [{ subscriptionId: "subscription-a", billingOrderId: "order-a" }],
      [{ id: "event-a", occurredAt: new Date("2026-07-26T00:00:00.000Z") }],
    );

    const result = await recordPopularFilterUsage(db as never, {
      interactionId: "7d85357e-68d4-45fe-846d-b9988eb66374",
      userId: "user-a",
      type: "views",
      category: "gaming",
      reusableOnly: true,
      longFormOnly: true,
      koreanOnly: true,
      resultCount: 12,
    });

    expect(result).toMatchObject({ id: "event-a" });
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain("order by s.current_period_end");
    expect(calls[1].text).toContain("on conflict (user_id,interaction_id) do nothing");
    expect(calls[1].values).toEqual([
      "7d85357e-68d4-45fe-846d-b9988eb66374",
      "user-a",
      "subscription-a",
      "order-a",
      "views",
      "gaming",
      true,
      true,
      true,
      12,
    ]);
  });

  it("fails closed when no paid order can be tied to the active entitlement", async () => {
    const { db } = databaseWithResponses([]);

    await expect(recordPopularFilterUsage(db as never, {
      userId: "user-a",
      type: "views",
      category: "all",
      reusableOnly: false,
      longFormOnly: false,
      koreanOnly: false,
      resultCount: 0,
    })).rejects.toThrow("POPULAR_FILTER_ENTITLEMENT_SOURCE_MISSING");
  });
});
