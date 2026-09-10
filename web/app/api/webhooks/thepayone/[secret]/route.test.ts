import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getPaidPlan: vi.fn(),
  getRemediation: vi.fn(),
  setDefaultPaymentMethod: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing")>()),
  getPaidPlan: mocks.getPaidPlan,
}));
vi.mock("@/lib/billing-payment-method-remediation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing-payment-method-remediation")>()),
  getReconcilableRemediationByMethod: mocks.getRemediation,
}));
vi.mock("@/lib/default-payment-method", () => ({
  setDefaultPaymentMethod: mocks.setDefaultPaymentMethod,
}));

import { cardTokenHash } from "@/lib/thepayone";
import { getBillingSummary, type BillingDb } from "@/lib/billing";
import { POST } from "./route";

it.each(["manual_review", "completed"])("reconciles a delayed upgrade refund in %s without touching the upgraded plan or quota", async (status) => {
  const queries: RecordedQuery[] = [];
  const queued = {
    id: "refund-ledger", status, sourceOrderId: "old-pro-payment",
    subscriptionId: "upgraded-subscription", providerMerchantId: "merchant-1",
    providerTerminalId: "terminal-1", refundAmountKrw: 9900,
  };
  const query = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = compactSql(strings, values);
    queries.push({ text, values });
    if (text.startsWith("insert into shorts_mvp.billing_payment_events")) return [{ id: "refund-event" }];
    if (text.includes("from shorts_mvp.subscription_upgrade_refunds")) return [queued];
    return [];
  });
  const db = Object.assign(query, { begin: (run: (tx: typeof query) => Promise<unknown>) => run(query) });
  mocks.getDb.mockReturnValue(db);
  const payload = flatPayload().replace("trxType=pay", "trxType=refund").replace("rootTrxId=", "rootTrxId=old-pro-transaction");
  const response = await POST(new Request(`http://localhost/api/webhooks/thepayone/${webhookSecret}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: payload,
  }), context());
  expect(response.status).toBe(200);
  const paymentWrites = queries.filter((q) => q.text.startsWith("update shorts_mvp.billing_orders"));
  expect(paymentWrites).toHaveLength(status === "completed" ? 0 : 1);
  if (status !== "completed") expect(paymentWrites[0].values).toContain("old-pro-payment");
  expect(queries.some((q) => /update shorts_mvp.user_subscriptions|update shorts_mvp.usage_grants|insert into shorts_mvp.usage_grants/.test(q.text))).toBe(false);
  expect(queries.some((q) => q.text.includes("upgrade_refund_reconciled"))).toBe(true);
});

type RecordedQuery = { text: string; values: unknown[] };

const webhookSecret = "test-webhook-secret-value-123456";
const transactionId = "T260821000001";
const trackId = "EC-SUB-TEST";
const cardId = "card_test_token";

function compactSql(strings: TemplateStringsArray, values: unknown[]) {
  return strings.reduce(
    (text, part, index) => `${text}${part}${index < values.length ? `$${index + 1}` : ""}`,
    "",
  ).replace(/\s+/g, " ").trim();
}

function flatPayload() {
  return "last4=*017&rootTrxId=&authCd=30006532&tmnId=terminal-1"
    + "&regDate=2026%2F08%2F21+13%3A44%3A21.342&trxType=pay"
    + `&prodName=Easy+Cut+Pro&amount=9900&trackId=${trackId}`
    + `&trxId=${transactionId}&regDay=20260821&trxDay=20260821&regTime=134418`
    + `&installment=00&cardId=${cardId}&mchtId=merchant-1`;
}

function recurringPayload(recurringTrackId: string, recurringTransactionId: string) {
  return "last4=*017&rootTrxId=&authCd=30006533&tmnId=terminal-1&trxType=pay"
    + `&amount=9900&trackId=${recurringTrackId}&trxId=${recurringTransactionId}`
    + "&regDay=20260825&trxDay=20260825&regTime=194500"
    + `&installment=00&cardId=${cardId}&mchtId=merchant-1`;
}

function request() {
  return new Request(`http://localhost/api/webhooks/thepayone/${webhookSecret}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: flatPayload(),
  });
}

function recurringRequest(recurringTrackId: string, recurringTransactionId: string) {
  return new Request(`http://localhost/api/webhooks/thepayone/${webhookSecret}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: recurringPayload(recurringTrackId, recurringTransactionId),
  });
}

function context() {
  return { params: Promise.resolve({ secret: webhookSecret }) };
}

function replayDatabase() {
  const queries: RecordedQuery[] = [];
  let inserted = false;
  let validationStatus = "received";
  let processingResult: string | null = null;
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = compactSql(strings, values);
    queries.push({ text, values });
    if (text.startsWith("insert into shorts_mvp.billing_payment_events")) {
      if (inserted) return [];
      inserted = true;
      processingResult = "processing";
      return [{ id: "event-a" }];
    }
    if (text.includes("from shorts_mvp.billing_payment_events")) return [{
      id: "event-a",
      merchantId: "merchant-1",
      terminalId: "terminal-1",
      trackId,
      transactionType: "pay",
      amountKrw: 9_900,
      cardIdHash: cardTokenHash(cardId),
      validationStatus,
      processingResult,
    }];
    if (text.includes("from shorts_mvp.billing_orders")) return [{
      id: "order-a",
      userId: "user-a",
      subscriptionId: "subscription-a",
      paymentMethodId: "method-a",
      kind: "subscription_initial",
      status: "succeeded",
      amountKrw: 9_900,
      providerMerchantId: "merchant-1",
      providerTerminalId: "terminal-1",
      providerCardIdHash: cardTokenHash(cardId),
      providerTransactionId: transactionId,
      installmentMonths: 0,
    }];
    if (text.includes("processing_result='server_payment_reconciled'")) {
      validationStatus = "processed";
      processingResult = "server_payment_reconciled";
    }
    return [];
  });
  return Object.assign(db, { queries });
}

function recurringReplayDatabase(options: {
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  chargeDueAt?: Date;
  billingAnchorDay?: number;
} = {}) {
  const queries: RecordedQuery[] = [];
  const transactionQueries: RecordedQuery[] = [];
  const storedTrackId = "EC-AUTH-260725-0123456789abcdef0123";
  const recurringTrackId = `${storedTrackId}194500`;
  const recurringTransactionId = "T260825000001";
  const chargeDueAt = options.chargeDueAt ?? new Date(Date.now() - 60_000);
  const currentPeriodEnd = options.currentPeriodEnd ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
  let inserted = false;
  let validationStatus = "received";
  let processingResult: string | null = null;
  const method = {
    id: "method-a",
    status: "active",
    providerScheduleStatus: "active",
    billingKeyHash: cardTokenHash(cardId),
    providerMerchantId: "merchant-1",
    providerTerminalId: "terminal-1",
  };
  const subscription = {
    id: "subscription-a",
    userId: "user-a",
    paymentMethodId: method.id,
    status: "active",
    billingCycle: "monthly",
    cancelAtPeriodEnd: false,
    scheduledPlanCode: null,
    planCode: "easycut_pro_v2",
    billingAnchorDay: options.billingAnchorDay ?? 25,
    nextChargeAt: chargeDueAt,
    currentPeriodStart: options.currentPeriodStart ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    currentPeriodEnd,
    displayName: "이지컷 프로",
    monthlySourceSeconds: 3_600,
    maxActiveJobs: 1,
    retentionDays: 30,
  };
  const tx = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = compactSql(strings, values);
    transactionQueries.push({ text, values });
    if (text.includes("from shorts_mvp.user_subscriptions") && text.includes("for update")) {
      return [{ ...subscription }];
    }
    if (text.startsWith("insert into shorts_mvp.billing_orders")) {
      return [{ id: "renewal-order-a" }];
    }
    if (text.startsWith("update shorts_mvp.user_subscriptions set status='active'")) {
      // Persist the handler's bound date values so the real billing summary
      // evaluates the resulting access, rather than mocking that decision.
      for (const [column, field] of [
        ["current_period_start", "currentPeriodStart"],
        ["current_period_end", "currentPeriodEnd"],
        ["next_charge_at", "nextChargeAt"],
      ] as const) {
        const parameter = text.match(new RegExp(`${column}=\\$(\\d+)`));
        if (!parameter) throw new Error(`Missing subscription update: ${column}`);
        subscription[field] = values[Number(parameter[1]) - 1] as Date;
      }
    }
    if (text.includes("processing_result='subscription_renewed'")) {
      validationStatus = "processed";
      processingResult = "subscription_renewed";
    }
    return [];
  });
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = compactSql(strings, values);
    queries.push({ text, values });
    if (text.startsWith("insert into shorts_mvp.billing_payment_events")) {
      if (inserted) return [];
      inserted = true;
      processingResult = "processing";
      return [{ id: "event-recurring-a" }];
    }
    if (text.includes("from shorts_mvp.billing_payment_events")) return [{
      id: "event-recurring-a",
      merchantId: "merchant-1",
      terminalId: "terminal-1",
      trackId: recurringTrackId,
      transactionType: "pay",
      amountKrw: 9_900,
      cardIdHash: cardTokenHash(cardId),
      validationStatus,
      processingResult,
    }];
    if (text.includes("from shorts_mvp.billing_orders")) return [];
    if (text.includes("from shorts_mvp.billing_payment_methods")) return [method];
    if (text.includes("from shorts_mvp.user_subscriptions")) return [subscription];
    return [];
  });
  return Object.assign(db, {
    begin: vi.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    queries,
    recurringTrackId,
    recurringTransactionId,
    storedTrackId,
    transactionQueries,
    subscription,
  });
}

async function recurringBillingSummary(db: ReturnType<typeof recurringReplayDatabase>) {
  const responses = [
    [{ hasPaymentHistory: true, purchasedPackageCodes: [] }],
    [{ ...db.subscription }],
  ];
  const summaryDb = (async () => responses.shift() || []) as unknown as BillingDb;
  return getBillingSummary(summaryDb, "user-a");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("THEPAYONE_WEBHOOK_SECRET", webhookSecret);
  vi.stubEnv("THEPAYONE_MID", "merchant-1");
  vi.stubEnv("THEPAYONE_TERMINAL_ID", "terminal-1");
  mocks.getPaidPlan.mockResolvedValue({
    code: "easycut_pro_v2",
    displayName: "이지컷 프로",
    monthlySourceSeconds: 3_600,
    monthlyPriceKrw: 9_900,
    yearlyPriceKrw: 119_400,
    retentionDays: 30,
    maxActiveJobs: 1,
  });
  mocks.getRemediation.mockResolvedValue(null);
  mocks.setDefaultPaymentMethod.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("POST /api/webhooks/thepayone/[secret]", () => {
  it("accepts the provider flat payload and acknowledges eleven deliveries once", async () => {
    const db = replayDatabase();
    mocks.getDb.mockReturnValue(db);

    const responses = [];
    for (let delivery = 0; delivery < 11; delivery += 1) {
      responses.push(await POST(request(), context()));
    }

    expect(responses.every((response) => response.status === 200)).toBe(true);
    await expect(Promise.all(responses.map((response) => response.text())))
      .resolves.toEqual(Array.from({ length: 11 }, () => "result=0000"));
    expect(db.queries.filter(({ text }) => (
      text.includes("from shorts_mvp.billing_orders")
    ))).toHaveLength(1);
    expect(db.queries.filter(({ text }) => (
      text.includes("processing_result='server_payment_reconciled'")
    ))).toHaveLength(1);
    expect(db.queries[0].text).toContain("validation_status,processing_result");
  });

  it("matches HHmmss recurring IDs and grants exactly 3,600 seconds once", async () => {
    const db = recurringReplayDatabase();
    mocks.getDb.mockReturnValue(db);

    const responses = [];
    for (let delivery = 0; delivery < 11; delivery += 1) {
      responses.push(await POST(
        recurringRequest(db.recurringTrackId, db.recurringTransactionId),
        context(),
      ));
    }

    expect(responses.every((response) => response.status === 200)).toBe(true);
    await expect(Promise.all(responses.map((response) => response.text())))
      .resolves.toEqual(Array.from({ length: 11 }, () => "result=0000"));
    const methodQueries = db.queries.filter(({ text }) => (
      text.includes("from shorts_mvp.billing_payment_methods")
    ));
    expect(methodQueries).toHaveLength(1);
    expect(methodQueries[0].values).toEqual(expect.arrayContaining([
      db.recurringTrackId,
      db.storedTrackId,
    ]));
    const renewalOrders = db.transactionQueries.filter(({ text }) => (
      text.startsWith("insert into shorts_mvp.billing_orders")
    ));
    const usageGrants = db.transactionQueries.filter(({ text }) => (
      text.startsWith("insert into shorts_mvp.usage_grants")
    ));
    expect(renewalOrders).toHaveLength(1);
    expect(usageGrants).toHaveLength(1);
    expect(usageGrants[0].values).toEqual(expect.arrayContaining([3_600]));
    expect(db.transactionQueries.filter(({ text }) => (
      text.includes("processing_result='subscription_renewed'")
    ))).toHaveLength(1);
  });

  it("keeps paid access when the 08:00 renewal precedes the 11:20 anniversary", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const renewedAt = new Date("2026-09-07T08:00:06+09:00");
    vi.setSystemTime(renewedAt);
    const oldStart = new Date("2026-08-07T11:20:40+09:00");
    const anniversary = new Date("2026-09-07T11:20:40+09:00");
    const nextAnniversary = new Date("2026-10-07T11:20:40+09:00");
    const db = recurringReplayDatabase({
      currentPeriodStart: oldStart,
      currentPeriodEnd: anniversary,
      chargeDueAt: anniversary,
      billingAnchorDay: 7,
    });
    mocks.getDb.mockReturnValue(db);

    for (let delivery = 0; delivery < 11; delivery += 1) {
      const response = await POST(
        recurringRequest(db.recurringTrackId, db.recurringTransactionId), context(),
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("result=0000");
    }

    expect(db.subscription.currentPeriodStart).toEqual(renewedAt);
    expect(db.subscription.currentPeriodEnd).toEqual(nextAnniversary);
    expect(db.subscription.nextChargeAt).toEqual(nextAnniversary);
    for (const time of [
      "2026-09-07T08:00:07+09:00",
      "2026-09-07T10:59:57+09:00",
      "2026-09-07T11:20:40+09:00",
    ]) {
      vi.setSystemTime(new Date(time));
      const summary = await recurringBillingSummary(db);
      expect(summary.canCreateJobs).toBe(true);
      expect(summary.activeProducts).toHaveLength(1);
      expect(summary.activeProducts[0].planCode).toBe("easycut_pro_v2");
    }
    const grants = db.transactionQueries.filter(({ text }) => (
      text.startsWith("insert into shorts_mvp.usage_grants")
    ));
    expect(grants).toHaveLength(1);
    expect(grants[0].values.slice(-2)).toEqual([anniversary, nextAnniversary]);
    expect(grants[0].values[5]).toBe(3_600);
    expect(db.transactionQueries.filter(({ text }) => (
      text.startsWith("insert into shorts_mvp.billing_orders")
    ))).toHaveLength(1);
    expect(db.transactionQueries.some(({ text }) => (
      /^(update|delete from) shorts_mvp.usage_grants/.test(text)
    ))).toBe(false);
  });

  it.each([
    ["on-time", "2026-09-07T11:20:40+09:00"],
    ["late", "2026-09-07T14:19:22+09:00"],
  ])("keeps the scheduled billing cycle for an %s renewal", async (_label, time) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(time));
    const anniversary = new Date("2026-09-07T11:20:40+09:00");
    const nextAnniversary = new Date("2026-10-07T11:20:40+09:00");
    const db = recurringReplayDatabase({
      currentPeriodStart: new Date("2026-08-07T11:20:40+09:00"),
      currentPeriodEnd: anniversary,
      chargeDueAt: anniversary,
      billingAnchorDay: 7,
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(
      recurringRequest(db.recurringTrackId, db.recurringTransactionId), context(),
    );

    expect(response.status).toBe(200);
    expect(db.subscription.currentPeriodStart).toEqual(anniversary);
    expect(db.subscription.currentPeriodEnd).toEqual(nextAnniversary);
    expect(db.subscription.nextChargeAt).toEqual(nextAnniversary);
    expect((await recurringBillingSummary(db)).canCreateJobs).toBe(true);
    const grant = db.transactionQueries.find(({ text }) => (
      text.startsWith("insert into shorts_mvp.usage_grants")
    ));
    expect(grant?.values.slice(-2)).toEqual([anniversary, nextAnniversary]);
  });

  it.each([
    ["expired", "2026-08-07T11:20:40+09:00", "2026-09-07T07:00:00+09:00"],
    ["not started", "2026-09-07T09:00:00+09:00", "2026-09-07T11:20:40+09:00"],
  ])("does not invent early access when the previous period has %s", async (_label, start, end) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-07T08:00:06+09:00"));
    const anniversary = new Date("2026-09-07T11:20:40+09:00");
    const db = recurringReplayDatabase({
      currentPeriodStart: new Date(start),
      currentPeriodEnd: new Date(end),
      chargeDueAt: anniversary,
      billingAnchorDay: 7,
    });
    mocks.getDb.mockReturnValue(db);

    const response = await POST(
      recurringRequest(db.recurringTrackId, db.recurringTransactionId), context(),
    );

    expect(response.status).toBe(200);
    expect(db.subscription.currentPeriodStart).toEqual(anniversary);
    const summary = await recurringBillingSummary(db);
    expect(summary.canCreateJobs).toBe(false);
    expect(summary.activeProducts).toEqual([]);
  });
});
