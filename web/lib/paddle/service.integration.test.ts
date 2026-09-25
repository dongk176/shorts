import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Sql } from "postgres";
import { PGlite } from "../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
vi.mock("@/lib/paddle/api", () => ({ paddleRequest: vi.fn() }));
import { paddleRequest } from "./api";
import {
  processPaddleEvent,
  preparePaddleCheckout,
  createPaddlePortal,
  resumePaddleCheckout,
  cancelPaddleCheckout,
} from "./service";
import type {
  PaddleTransaction,
  PaddleSubscription,
  PaddleAdjustment,
} from "./models";
let pg: PGlite;
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const checkout = "00000000-0000-4000-8000-000000000003";
const txn = "txn_" + "a".repeat(26);
const sub = "sub_" + "a".repeat(26);
const price = "pri_" + "a".repeat(26);
const customer = "ctm_" + "a".repeat(26);
function tag(engine: Pick<PGlite, "query">): Sql {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((t, p, i) => t + (i ? `$${i}` : "") + p, "");
    const result = await engine.query<Record<string, unknown>>(query, values);
    return result.rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k.replace(/_([a-z])/g, (_, l) => l.toUpperCase()),
          v,
        ]),
      ),
    );
  };
  return Object.assign(sql, {
    begin: (fn: (tx: Sql) => Promise<unknown>) =>
      pg.transaction((tx) => fn(tag(tx))),
  }) as unknown as Sql;
}
let transaction: PaddleTransaction;
let subscription: PaddleSubscription;
let adjustment: PaddleAdjustment;
const event = (type = "transaction.completed", id = txn, sequence = 1) => ({
  event_id: "evt_" + String(sequence).padStart(26, "0"),
  event_type: type,
  occurred_at: "2026-09-26T00:00:00Z",
  data: { id },
});
const rows = async (table: string) =>
  (await pg.query<Record<string, unknown>>(`select * from shorts_mvp.${table}`))
    .rows;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema shorts_mvp;create role anon;create role authenticated;create role service_role;
 create table shorts_mvp.app_users(id uuid primary key,withdrawn_at timestamptz);
 create table shorts_mvp.billing_orders(id uuid primary key default gen_random_uuid(),user_id uuid,status text,checkout_expires_at timestamptz);
 create table shorts_mvp.billing_toss_checkout_intents(id uuid primary key default gen_random_uuid(),user_id uuid,status text,expires_at timestamptz);
 create table shorts_mvp.plans(code text primary key constraint plans_code_check check(code in ('free','easycut_pro_v2')),display_name text,monthly_source_seconds int,retention_days int,sort_order int,monthly_price_krw int,yearly_price_krw int,max_active_jobs int,is_active boolean,prepaid_months int);
 create table shorts_mvp.user_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid references shorts_mvp.app_users(id),plan_code text references shorts_mvp.plans(code),status text,billing_cycle text,payment_provider text constraint user_subscriptions_payment_provider_check check(payment_provider in ('toss','thepayone','nicepay')),current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean default false,next_charge_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
 create unique index one_current on shorts_mvp.user_subscriptions(user_id) where status in ('pending','trialing','active','past_due') and billing_cycle='monthly';
 create table shorts_mvp.usage_grants(id uuid primary key default gen_random_uuid(),user_id uuid references shorts_mvp.app_users(id),subscription_id uuid references shorts_mvp.user_subscriptions(id),kind text,product_code text,total_seconds int not null check(total_seconds>0),credited_seconds int,carried_seconds int,reserved_seconds int not null default 0,consumed_seconds int not null default 0,valid_from timestamptz,expires_at timestamptz,status text default 'active',updated_at timestamptz default now(),check(reserved_seconds+consumed_seconds<=total_seconds),check(expires_at>valid_from));
 create unique index base_once on shorts_mvp.usage_grants(subscription_id,valid_from,kind) where subscription_id is not null and kind='base';`);
  const migration = fs.readFileSync(
    path.resolve("../supabase/migrations/202609260010_paddle_billing.sql"),
    "utf8",
  );
  await pg.exec(migration);
  await pg.exec(migration);
}, 30000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T00:00:00Z"));
  vi.stubEnv("PADDLE_ENABLED", "true");
  vi.stubEnv("PADDLE_ENVIRONMENT", "sandbox");
  vi.stubEnv("PADDLE_PRICE_LITE_USD", price);
  vi.stubEnv("PADDLE_PRICE_LITE_JPY", "pri_" + "j".repeat(26));
  await pg.exec(
    `truncate shorts_mvp.app_users cascade;truncate shorts_mvp.paddle_webhook_events,shorts_mvp.paddle_adjustments,shorts_mvp.billing_orders,shorts_mvp.billing_toss_checkout_intents;insert into shorts_mvp.app_users(id) values('${user}'),('${other}');insert into shorts_mvp.paddle_checkouts(id,user_id,environment,plan_code,currency,price_id,transaction_id,status) values('${checkout}','${user}','sandbox','paddle_lite','USD','${price}','${txn}','ready');`,
  );
  transaction = {
    id: txn,
    status: "completed",
    subscription_id: sub,
    customer_id: customer,
    discount_id: null,
    currency_code: "USD",
    billing_period: {
      starts_at: "2026-09-26T00:00:00Z",
      ends_at: "2026-10-26T00:00:00Z",
    },
    custom_data: { easycut_checkout_id: checkout },
    items: [
      {
        quantity: 1,
        proration: null,
        price: {
          id: price,
          unit_price: { amount: "990", currency_code: "USD" },
          tax_mode: "internal",
          billing_cycle: { interval: "month", frequency: 1 },
        },
      },
    ],
    details: {
      totals: { total: "990", subtotal: "990", tax: "0", discount: "0" },
      line_items: [{ totals: { total: "990" } }],
    },
  };
  subscription = {
    id: sub,
    customer_id: customer,
    status: "active",
    updated_at: "2026-09-26T00:00:00Z",
    current_billing_period: transaction.billing_period,
    next_billed_at: "2026-10-26T00:00:00Z",
    scheduled_change: null,
    items: [{ price: { id: price }, quantity: 1 }],
  };
  adjustment = {
    id: "adj_" + "a".repeat(26),
    transaction_id: txn,
    status: "approved",
    action: "refund",
    updated_at: "2026-09-27T00:00:00Z",
    totals: { total: "990", subtotal: "990" },
  };
  vi.mocked(paddleRequest)
    .mockReset()
    .mockImplementation(async (p) =>
      p.startsWith("/subscriptions/")
        ? subscription
        : p.startsWith("/adjustments?")
          ? [adjustment]
          : transaction,
    );
});
afterAll(async () => {
  await pg.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("Paddle ledger using real SQL and migration", () => {
  it("blocks account withdrawal while a checkout is payable and rejects withdrawn buyers", async () => {
    await expect(
      pg.exec(
        `update shorts_mvp.app_users set withdrawn_at=now() where id='${user}'`,
      ),
    ).rejects.toThrow("Cancel Paddle");
    transaction.status = "canceled";
    await cancelPaddleCheckout(user, tag(pg));
    await pg.exec(
      `update shorts_mvp.app_users set withdrawn_at=now() where id='${user}'`,
    );
    await expect(
      preparePaddleCheckout(user, "paddle_lite", "USD", tag(pg)),
    ).rejects.toThrow("Account not available");
  });
  it("blocks domestic charges while a Paddle checkout is payable, releases after cancellation", async () => {
    await expect(
      pg.exec(
        `insert into shorts_mvp.billing_orders(user_id,status) values('${user}','pending')`,
      ),
    ).rejects.toThrow("Paddle");
    transaction.status = "canceled";
    await cancelPaddleCheckout(user, tag(pg));
    await pg.exec(
      `insert into shorts_mvp.billing_orders(user_id,status) values('${user}','processing')`,
    );
    await expect(
      preparePaddleCheckout(user, "paddle_lite", "USD", tag(pg)),
    ).rejects.toThrow("pending");
  });
  it("handles JPY zero-decimal amounts without multiplying by 100", async () => {
    const jpy = "pri_" + "j".repeat(26);
    await pg.exec(
      `update shorts_mvp.paddle_checkouts set currency='JPY',price_id='${jpy}'`,
    );
    transaction.currency_code = "JPY";
    transaction.items[0].price.id = jpy;
    transaction.items[0].price.unit_price = {
      amount: "1480",
      currency_code: "JPY",
    };
    transaction.details.totals.total = "1480";
    transaction.details.totals.subtotal = "1480";
    subscription.items[0].price.id = jpy;
    await processPaddleEvent(event(), tag(pg));
    expect((await rows("paddle_payments"))[0].amount_minor).toBe(1480);
    expect((await rows("usage_grants"))[0].total_seconds).toBe(3600);
  });
  it("accepts canonical tax-exempt totals without changing the fixed product price", async () => {
    transaction.details.totals = {
      total: "900",
      subtotal: "900",
      tax: "0",
      discount: "0",
    };
    await processPaddleEvent(event(), tag(pg));
    expect((await rows("paddle_payments"))[0].amount_minor).toBe(900);
    expect((await rows("usage_grants"))[0].total_seconds).toBe(3600);
  });
  it("keeps management available while checkout is disabled", async () => {
    await processPaddleEvent(event(), tag(pg));
    vi.stubEnv("PADDLE_ENABLED", "false");
    vi.mocked(paddleRequest).mockResolvedValue({
      urls: {
        general: {
          overview: "https://customer-portal.paddle.com/test?token=temporary",
        },
      },
    });
    expect(await createPaddlePortal(user, tag(pg))).toContain(
      "customer-portal.paddle.com",
    );
    await expect(
      preparePaddleCheckout(user, "paddle_lite", "USD", tag(pg)),
    ).rejects.toThrow("not available");
  });
  it("grants only after completed payment, deduplicates different notifications for the same transaction", async () => {
    await processPaddleEvent(event("subscription.created", sub), tag(pg));
    expect(await rows("usage_grants")).toHaveLength(0);
    await processPaddleEvent(event(undefined, txn, 2), tag(pg));
    await processPaddleEvent(event(undefined, txn, 2), tag(pg));
    await processPaddleEvent(event(undefined, txn, 3), tag(pg));
    expect(await rows("usage_grants")).toHaveLength(1);
    expect((await rows("usage_grants"))[0].total_seconds).toBe(3600);
    expect(await rows("paddle_payments")).toHaveLength(1);
  });
  it("adds exactly one monthly allowance on renewal and does not move dates backwards on old events", async () => {
    await processPaddleEvent(event(), tag(pg));
    const original = structuredClone(transaction);
    transaction = {
      ...transaction,
      id: "txn_" + "b".repeat(26),
      billing_period: {
        starts_at: "2026-10-26T00:00:00Z",
        ends_at: "2026-11-26T00:00:00Z",
      },
    };
    await processPaddleEvent(event(undefined, transaction.id, 2), tag(pg));
    transaction = original;
    await processPaddleEvent(event(undefined, txn, 3), tag(pg));
    expect(await rows("usage_grants")).toHaveLength(2);
    expect(
      String((await rows("user_subscriptions"))[0].current_period_end),
    ).toContain("2026");
    expect(
      new Date(
        String((await rows("user_subscriptions"))[0].current_period_end),
      ).toISOString(),
    ).toBe("2026-11-26T00:00:00.000Z");
  });
  it("keeps paid access on scheduled cancellation, revokes on actual cancellation, ignores stale status", async () => {
    await processPaddleEvent(event(), tag(pg));
    subscription.scheduled_change = {
      action: "cancel",
      effective_at: "2026-10-26T00:00:00Z",
    };
    subscription.updated_at = "2026-09-27T00:00:00Z";
    await processPaddleEvent(event("subscription.updated", sub, 2), tag(pg));
    expect((await rows("usage_grants"))[0].status).toBe("active");
    expect((await rows("user_subscriptions"))[0].cancel_at_period_end).toBe(
      true,
    );
    subscription.status = "canceled";
    subscription.updated_at = "2026-10-26T00:00:00Z";
    await processPaddleEvent(event("subscription.canceled", sub, 3), tag(pg));
    subscription.status = "active";
    subscription.updated_at = "2026-09-26T00:00:00Z";
    await processPaddleEvent(event("subscription.updated", sub, 4), tag(pg));
    expect((await rows("user_subscriptions"))[0].status).toBe("canceled");
    expect((await rows("usage_grants"))[0].status).toBe("revoked");
  });
  it("applies an early refund when its payment arrives later", async () => {
    await processPaddleEvent(
      event("adjustment.updated", adjustment.id),
      tag(pg),
    );
    expect(await rows("usage_grants")).toHaveLength(0);
    await processPaddleEvent(event(undefined, txn, 2), tag(pg));
    expect((await rows("usage_grants"))[0].status).toBe("revoked");
  });
  it("does not revoke pending refunds, handles proportional refunds without breaking consumed/reserved usage", async () => {
    await processPaddleEvent(event(), tag(pg));
    adjustment.status = "pending_approval";
    await processPaddleEvent(
      event("adjustment.created", adjustment.id, 2),
      tag(pg),
    );
    expect((await rows("usage_grants"))[0].total_seconds).toBe(3600);
    await pg.exec(
      "update shorts_mvp.usage_grants set consumed_seconds=1200,reserved_seconds=1000",
    );
    adjustment.status = "approved";
    adjustment.totals.total = "495";
    adjustment.totals.subtotal = "495";
    await processPaddleEvent(
      event("adjustment.updated", adjustment.id, 3),
      tag(pg),
    );
    expect((await rows("usage_grants"))[0].total_seconds).toBe(2200);
    adjustment.totals.total = "990";
    adjustment.totals.subtotal = "990";
    await processPaddleEvent(
      event("adjustment.updated", adjustment.id, 4),
      tag(pg),
    );
    expect((await rows("usage_grants"))[0].status).toBe("revoked");
  });
  it("tax-only refunds preserve minutes; reversing a chargeback does not undo a separate refund", async () => {
    transaction.details.totals.subtotal = "900";
    transaction.details.totals.tax = "90";
    await processPaddleEvent(event(), tag(pg));
    adjustment.totals = { total: "90", subtotal: "0" };
    await processPaddleEvent(
      event("adjustment.updated", adjustment.id, 2),
      tag(pg),
    );
    expect((await rows("usage_grants"))[0].total_seconds).toBe(3600);
    const refund = {
      ...structuredClone(adjustment),
      id: "adj_" + "b".repeat(26),
      totals: { total: "450", subtotal: "450" },
    };
    const original = {
      ...structuredClone(adjustment),
      id: "adj_" + "c".repeat(26),
      action: "chargeback",
      status: "reversed",
      totals: { total: "990", subtotal: "900" },
    };
    adjustment = {
      ...structuredClone(adjustment),
      id: "adj_" + "d".repeat(26),
      action: "chargeback_reverse",
      totals: { total: "990", subtotal: "900" },
    };
    vi.mocked(paddleRequest).mockImplementation(async (p) =>
      p.includes("transaction_id=")
        ? [refund, original, adjustment]
        : [adjustment],
    );
    await processPaddleEvent(
      event("adjustment.created", adjustment.id, 3),
      tag(pg),
    );
    expect((await rows("usage_grants"))[0].total_seconds).toBe(1800);
  });
  it("blocks withdrawal while the remote subscription is active and rejects unknown statuses", async () => {
    await processPaddleEvent(event(), tag(pg));
    await expect(
      pg.exec(
        `update shorts_mvp.app_users set withdrawn_at=now() where id='${user}'`,
      ),
    ).rejects.toThrow("Cancel Paddle");
    subscription.status = "unexpected";
    await expect(
      processPaddleEvent(event("subscription.updated", sub, 2), tag(pg)),
    ).rejects.toThrow("Unsupported");
    expect((await rows("user_subscriptions"))[0].status).toBe("active");
  });
  it("rejects wrong currency, price, quantity, amount and ownership atomically", async () => {
    for (const mutate of [
      (t: PaddleTransaction) => (t.currency_code = "JPY"),
      (t: PaddleTransaction) => (t.items[0].price.id = "pri_wrong"),
      (t: PaddleTransaction) => (t.items[0].quantity = 2),
      (t: PaddleTransaction) => (t.details.totals.total = "1"),
      (t: PaddleTransaction) => (t.customer_id = "ctm_other"),
    ]) {
      const before = structuredClone(transaction);
      mutate(transaction);
      await expect(processPaddleEvent(event(), tag(pg))).rejects.toThrow();
      transaction = before;
      expect(await rows("usage_grants")).toHaveLength(0);
      expect(await rows("paddle_webhook_events")).toHaveLength(0);
    }
  });
  it("rejects environment mismatch", async () => {
    vi.stubEnv("PADDLE_ENVIRONMENT", "live");
    await expect(processPaddleEvent(event(), tag(pg))).rejects.toThrow(
      "ownership",
    );
    expect(await rows("usage_grants")).toHaveLength(0);
  });
  it("cannot resume another user’s checkout or access their portal", async () => {
    await expect(resumePaddleCheckout(other, txn, tag(pg))).rejects.toThrow();
    await expect(createPaddlePortal(other, tag(pg))).rejects.toThrow();
    expect(paddleRequest).not.toHaveBeenCalled();
  });
  it("reuses a payable transaction, never retries an unknown creation outcome", async () => {
    expect(
      await preparePaddleCheckout(user, "paddle_lite", "USD", tag(pg)),
    ).toBe(txn);
    expect(paddleRequest).not.toHaveBeenCalled();
    await pg.exec("truncate shorts_mvp.paddle_checkouts");
    vi.mocked(paddleRequest).mockRejectedValue(Error("timeout"));
    await expect(
      preparePaddleCheckout(user, "paddle_lite", "USD", tag(pg)),
    ).rejects.toThrow();
    await expect(
      preparePaddleCheckout(user, "paddle_lite", "USD", tag(pg)),
    ).rejects.toThrow();
    expect(paddleRequest).toHaveBeenCalledTimes(1);
    expect((await rows("paddle_checkouts"))[0].status).toBe("unknown");
  });
  it("does not cancel a payment that is already completed", async () => {
    await expect(cancelPaddleCheckout(user, tag(pg))).rejects.toThrow(
      "processed",
    );
    expect((await rows("paddle_checkouts"))[0].status).toBe("ready");
  });
  it("rejects a second subscription while the first is live", async () => {
    await processPaddleEvent(event(), tag(pg));
    await expect(
      preparePaddleCheckout(user, "paddle_lite", "USD", tag(pg)),
    ).rejects.toThrow("existing");
  });
});
