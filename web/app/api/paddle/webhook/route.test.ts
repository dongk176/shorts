import { beforeEach, describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
vi.mock("@/lib/paddle/service", () => ({ processPaddleEvent: vi.fn() }));
import { processPaddleEvent } from "@/lib/paddle/service";
import { POST } from "./route";
const secret = "test-webhook-secret";
function request(event: unknown, valid = true) {
  const raw = JSON.stringify(event),
    ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", valid ? secret : "other")
    .update(`${ts}:${raw}`)
    .digest("hex");
  return new Request("https://easycut.test/api/paddle/webhook", {
    method: "POST",
    headers: { "paddle-signature": `ts=${ts};h1=${signature}` },
    body: raw,
  });
}
const event = {
  event_id: "evt_" + "a".repeat(26),
  event_type: "transaction.completed",
  occurred_at: "2026-09-26T00:00:00Z",
  data: { id: "txn_" + "b".repeat(26) },
};
beforeEach(() => {
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", secret);
  vi.stubEnv("PADDLE_ENABLED", "false");
  vi.mocked(processPaddleEvent).mockReset();
});
describe("Paddle webhook ingress", () => {
  it("does not touch billing on invalid signatures", async () => {
    expect((await POST(request(event, false))).status).toBe(401);
    expect(processPaddleEvent).not.toHaveBeenCalled();
  });
  it("keeps syncing existing subscriptions when new checkout is disabled", async () => {
    expect((await POST(request(event))).status).toBe(200);
    expect(processPaddleEvent).toHaveBeenCalledWith(event);
  });
  it("responds with retryable failure when persistence or provider lookup fails", async () => {
    vi.mocked(processPaddleEvent).mockRejectedValue(Error("db unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(request(event))).status).toBe(503);
    log.mockRestore();
  });
  it("rejects mismatched object types and ignores unrelated events", async () => {
    expect(
      (await POST(request({ ...event, data: { id: "sub_" + "b".repeat(26) } })))
        .status,
    ).toBe(400);
    expect(
      (await POST(request({ ...event, event_type: "customer.created" })))
        .status,
    ).toBe(200);
    expect(processPaddleEvent).not.toHaveBeenCalled();
  });
});
