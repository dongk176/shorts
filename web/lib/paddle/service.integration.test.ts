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
  const packages = fs.readFileSync(path.resolve("../supabase/migrations/202609260020_paddle_packages.sql"), "utf8");
  await pg.exec(packages);
  await pg.exec(packages);
  await pg.exec(fs.readFileSync(path.resolve("../supabase/migrations/20261020152718_paddle_jpy_new_subscriptions.sql"),"utf8"));
  const changes=fs.readFileSync(path.resolve("../supabase/migrations/202609260030_paddle_plan_changes.sql"),"utf8");
  await pg.exec(changes); await pg.exec(changes);
  const cancellation=fs.readFileSync(path.resolve("../supabase/migrations/202609260040_paddle_change_cancellation.sql"),"utf8");
  await pg.exec(cancellation); await pg.exec(cancellation);
}, 30000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T00:00:00Z"));
  vi.stubEnv("PADDLE_ENABLED", "true");
  vi.stubEnv("PADDLE_ENVIRONMENT", "sandbox");
  vi.stubEnv("PADDLE_PRICE_LITE_USD", price);
  vi.stubEnv("PADDLE_PRICE_LITE_JPY", "pri_" + "j".repeat(26));
  vi.stubEnv("PADDLE_PRICE_LITE_JPY_20261021_JPY", "pri_" + "n".repeat(26));
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
          unit_price: { amount: "399", currency_code: "USD" },
          tax_mode: "internal",
          billing_cycle: { interval: "month", frequency: 1 },
        },
      },
    ],
    details: {
      totals: { total: "399", subtotal: "399", tax: "0", discount: "0" },
      line_items: [{ totals: { total: "399" } }],
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
    totals: { total: "399", subtotal: "399" },
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
  it("does not overlap an uncertain domestic payment or a review intent whose checkout expired", async () => {
    await pg.exec("truncate shorts_mvp.paddle_checkouts");
    await pg.exec(
      `insert into shorts_mvp.billing_orders(user_id,status) values('${user}','unknown')`,
    );
    await expect(
      preparePaddleCheckout(user, "paddle_lite", "USD", tag(pg)),
    ).rejects.toThrow("pending");
    await pg.exec(`truncate shorts_mvp.billing_orders;
      insert into shorts_mvp.billing_toss_checkout_intents(user_id,status,expires_at) values('${user}','manual_review',now()-interval '1 day')`);
    await expect(
      preparePaddleCheckout(user, "paddle_lite", "USD", tag(pg)),
    ).rejects.toThrow("pending");
    expect(paddleRequest).not.toHaveBeenCalled();
  });
  it("handles JPY zero-decimal amounts without multiplying by 100", async () => {
    const jpy = "pri_" + "j".repeat(26);
    await pg.exec(
      `update shorts_mvp.paddle_checkouts set currency='JPY',price_id='${jpy}'`,
    );
    transaction.currency_code = "JPY";
    transaction.items[0].price.id = jpy;
    transaction.items[0].price.unit_price = {
      amount: "590",
      currency_code: "JPY",
    };
    transaction.details.totals.total = "590";
    transaction.details.totals.subtotal = "590";
    subscription.items[0].price.id = jpy;
    await processPaddleEvent(event(), tag(pg));
    expect((await rows("paddle_payments"))[0].amount_minor).toBe(590);
    expect((await rows("usage_grants"))[0].total_seconds).toBe(3600);
  });
  it("accepts canonical tax-exempt totals without changing the fixed product price", async () => {
    transaction.details.totals = {
      total: "360",
      subtotal: "360",
      tax: "0",
      discount: "0",
    };
    await processPaddleEvent(event(), tag(pg));
    expect((await rows("paddle_payments"))[0].amount_minor).toBe(360);
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
    adjustment.totals.total = "199";
    adjustment.totals.subtotal = "199";
    await processPaddleEvent(
      event("adjustment.updated", adjustment.id, 3),
      tag(pg),
    );
    expect((await rows("usage_grants"))[0].total_seconds).toBe(2200);
    adjustment.totals.total = "399";
    adjustment.totals.subtotal = "399";
    await processPaddleEvent(
      event("adjustment.updated", adjustment.id, 4),
      tag(pg),
    );
    expect((await rows("usage_grants"))[0].status).toBe("revoked");
  });
  it("tax-only refunds preserve minutes; reversing a chargeback does not undo a separate refund", async () => {
    transaction.details.totals.subtotal = "360";
    transaction.details.totals.tax = "39";
    await processPaddleEvent(event(), tag(pg));
    adjustment.totals = { total: "39", subtotal: "0" };
    await processPaddleEvent(
      event("adjustment.updated", adjustment.id, 2),
      tag(pg),
    );
    expect((await rows("usage_grants"))[0].total_seconds).toBe(3600);
    const refund = {
      ...structuredClone(adjustment),
      id: "adj_" + "b".repeat(26),
      totals: { total: "180", subtotal: "180" },
    };
    const original = {
      ...structuredClone(adjustment),
      id: "adj_" + "c".repeat(26),
      action: "chargeback",
      status: "reversed",
      totals: { total: "399", subtotal: "360" },
    };
    adjustment = {
      ...structuredClone(adjustment),
      id: "adj_" + "d".repeat(26),
      action: "chargeback_reverse",
      totals: { total: "399", subtotal: "360" },
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
  it.each(["draft", "ready", "canceled"])(
    "switches plan after confirming the previous %s checkout is canceled",
    async (oldStatus) => {
      const nextId = "txn_" + "b".repeat(26);
      const creatorPrice = "pri_" + "c".repeat(26);
      vi.stubEnv("PADDLE_PRICE_CREATOR_USD", creatorPrice);
      vi.mocked(paddleRequest).mockImplementation(async (path, body, method) => {
        if (path === "/transactions") {
          expect((await rows("paddle_checkouts")).find(r => r.id === checkout)?.status).toBe("canceled");
          expect(body).toMatchObject({ items: [{ price_id: creatorPrice, quantity: 1 }] });
          return { id: nextId };
        }
        expect(path).toBe(`/transactions/${txn}`);
        if (method === "PATCH") {
          expect(body).toEqual({ status: "canceled" });
          return { ...transaction, status: "canceled" };
        }
        return { ...transaction, status: oldStatus };
      });
      expect(await preparePaddleCheckout(user, "paddle_creator", "USD", tag(pg))).toBe(nextId);
      const checkouts = await rows("paddle_checkouts");
      expect(checkouts).toHaveLength(2);
      expect(checkouts.find(r => r.id === checkout)?.status).toBe("canceled");
      expect(checkouts.find(r => r.transaction_id === nextId)).toMatchObject({status: "ready", plan_code: "paddle_creator"});
      expect(await rows("usage_grants")).toHaveLength(0);
    },
  );
  it.each(["paid", "billed", "completed", "past_due"])(
    "does not replace a %s payment even before its webhook arrives",
    async (status) => {
      vi.mocked(paddleRequest).mockResolvedValue({ ...transaction, status });
      await expect(preparePaddleCheckout(user, "paddle_lite_jpy_20261021", "JPY", tag(pg))).rejects.toMatchObject({ code: "CHECKOUT_PROCESSING" });
      expect(paddleRequest).toHaveBeenCalledTimes(1);
      expect(await rows("paddle_checkouts")).toHaveLength(1);
      expect((await rows("paddle_checkouts"))[0].status).toBe("ready");
    },
  );
  it("does not create a replacement when cancellation cannot be confirmed", async () => {
    vi.mocked(paddleRequest).mockResolvedValue({ ...transaction, status: "ready" });
    await expect(preparePaddleCheckout(user, "paddle_lite_jpy_20261021", "JPY", tag(pg))).rejects.toThrow("unconfirmed");
    expect(paddleRequest).toHaveBeenCalledTimes(2);
    expect(await rows("paddle_checkouts")).toHaveLength(1);
    expect((await rows("paddle_checkouts"))[0].status).toBe("ready");
  });
  it("keeps an uncertain creation blocked when choosing another plan", async () => {
    await pg.exec("update shorts_mvp.paddle_checkouts set status='unknown',transaction_id=null");
    await expect(preparePaddleCheckout(user, "paddle_lite_jpy_20261021", "JPY", tag(pg))).rejects.toMatchObject({ code: "CHECKOUT_UNCONFIRMED" });
    expect(paddleRequest).not.toHaveBeenCalled();
    expect(await rows("paddle_checkouts")).toHaveLength(1);
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

describe("Paddle recurring packages", () => {
  async function packageCheckout(months: 3 | 6 | 12 = 6) {
    const { paddlePlan } = await import("./catalog");
    const code = `paddle_creator_${months}m`;
    const plan = paddlePlan(code);
    vi.stubEnv(`PADDLE_PRICE_CREATOR_${months}M_USD`, price);
    await pg.query("update shorts_mvp.paddle_checkouts set plan_code=$1 where id=$2", [code, checkout]);
    transaction.items[0].price.unit_price.amount = String(plan.usd);
    transaction.items[0].price.billing_cycle!.frequency = months;
    transaction.billing_period = { starts_at: "2026-01-31T10:15:00Z", ends_at: months === 3 ? "2026-04-30T10:15:00Z" : months === 6 ? "2026-07-31T10:15:00Z" : "2027-01-31T10:15:00Z" };
    transaction.details.totals = {total: String(plan.usd), subtotal: String(plan.usd), tax: "0", discount: "0"};
    subscription.current_billing_period = transaction.billing_period;
    subscription.next_billed_at = transaction.billing_period.ends_at;
    vi.setSystemTime(new Date("2026-02-15T00:00:00Z"));
    return plan;
  }
  it.each([3, 6, 12] as const)("allocates %i separate monthly grants exactly once, never all minutes at once", async months => {
    await packageCheckout(months);
    await processPaddleEvent(event(), tag(pg));
    await processPaddleEvent(event("transaction.completed", txn, 2), tag(pg));
    const grants = await rows("usage_grants");
    expect(grants).toHaveLength(months);
    expect(await rows("paddle_payment_grants")).toHaveLength(months);
    expect(grants.every(g => g.total_seconds === 12000)).toBe(true);
    for (const instant of ["2026-02-15", "2026-02-28T10:15:00Z", "2026-03-31T10:15:00Z"]) {
      const active = (await pg.query<{ seconds: number }>("select sum(total_seconds) as seconds from shorts_mvp.usage_grants where status='active' and valid_from<=$1 and expires_at>$1",[instant])).rows;
      expect(Number(active[0].seconds)).toBe(12000);
    }
    const future = grants.find(g => new Date(g.valid_from as string).toISOString() === "2026-03-31T10:15:00.000Z");
    expect(future).toBeTruthy();
  });
  it("renews a six-month package once and keeps old months unavailable", async () => {
    await packageCheckout();
    await processPaddleEvent(event(), tag(pg));
    transaction.id = "txn_" + "r".repeat(26);
    transaction.billing_period = {starts_at: "2026-07-31T10:15:00Z", ends_at: "2027-01-31T10:15:00Z"};
    subscription.current_billing_period = transaction.billing_period;
    subscription.next_billed_at = transaction.billing_period.ends_at;
    subscription.updated_at = "2026-07-31T10:15:00Z";
    await processPaddleEvent(event("transaction.completed", transaction.id, 2), tag(pg));
    await processPaddleEvent(event("transaction.completed", transaction.id, 3), tag(pg));
    expect(await rows("usage_grants")).toHaveLength(12);
    expect(await rows("paddle_payments")).toHaveLength(2);
    expect((await rows("user_subscriptions"))[0].current_period_end).toEqual(new Date("2027-01-31T10:15:00Z"));
  });
  it("can refund a legacy monthly payment recorded during deployment before the map exists", async () => {
    await processPaddleEvent(event(), tag(pg));
    await pg.exec("delete from shorts_mvp.paddle_payment_grants");
    await processPaddleEvent(event("adjustment.updated", adjustment.id, 2), tag(pg));
    expect((await rows("usage_grants"))[0].status).toBe("revoked");
  });
  it("full refund revokes every current and future allowance, retaining consumed usage", async () => {
    const plan = await packageCheckout();
    await processPaddleEvent(event(), tag(pg));
    await pg.exec("update shorts_mvp.usage_grants set consumed_seconds=60 where valid_from='2026-01-31T10:15:00Z'");
    adjustment.totals = {total: String(plan.usd), subtotal: String(plan.usd)};
    await processPaddleEvent(event("adjustment.updated", adjustment.id, 2), tag(pg));
    const grants = await rows("usage_grants");
    expect(grants).toHaveLength(6);
    expect(grants.every(g => g.status === "revoked")).toBe(true);
    expect(grants.some(g => g.total_seconds === 60 && g.consumed_seconds === 60)).toBe(true);
  });
  it("partial refund reduces each month proportionally and never revives an expired month", async () => {
    const plan = await packageCheckout();
    await processPaddleEvent(event(), tag(pg));
    vi.setSystemTime(new Date("2026-03-15T00:00:00Z"));
    adjustment.totals = {total: String(plan.usd / 2), subtotal: String(plan.usd / 2)};
    await processPaddleEvent(event("adjustment.updated", adjustment.id, 2), tag(pg));
    const grants = await rows("usage_grants");
    expect(grants.every(g => g.total_seconds === 6000)).toBe(true);
    expect(grants.filter(g => g.status === "expired")).toHaveLength(1);
    expect(grants.filter(g => g.status === "active")).toHaveLength(5);
  });
  it("scheduled cancellation keeps paid months; immediate cancellation revokes them", async () => {
    await packageCheckout();
    subscription.scheduled_change = {action: "cancel", effective_at: subscription.next_billed_at!};
    await processPaddleEvent(event(), tag(pg));
    expect((await rows("usage_grants")).every(g => g.status === "active")).toBe(true);
    subscription.status = "canceled";
    subscription.updated_at = "2026-09-27T00:00:00Z";
    await processPaddleEvent(event("subscription.canceled", sub, 2), tag(pg));
    expect((await rows("usage_grants")).every(g => g.status === "revoked")).toBe(true);
  });
  it("rejects a wrong package frequency or a one-month paid period", async () => {
    await packageCheckout();
    transaction.items[0].price.billing_cycle!.frequency = 3;
    await expect(processPaddleEvent(event(), tag(pg))).rejects.toThrow("catalog");
    transaction.items[0].price.billing_cycle!.frequency = 6;
    transaction.billing_period!.ends_at = "2026-02-28T10:15:00Z";
    await expect(processPaddleEvent(event(), tag(pg))).rejects.toThrow("period");
    expect(await rows("usage_grants")).toHaveLength(0);
  });
});

// Exercise the authenticated change service against SQL, including uncertain dispatches.
import { quotePaddleChange, confirmPaddleChange, cancelPaddleChange, reconcileRenewalChange } from './changes';
import { changePayload, changeTiming, upgradeAllowances } from './change-policy';
const creatorPrice='pri_'+'c'.repeat(26);
function installChangeProvider() {
  vi.stubEnv('PADDLE_PRICE_CREATOR_USD',creatorPrice);
  vi.stubEnv('PADDLE_PRICE_CREATOR_3M_USD',creatorPrice);
  vi.mocked(paddleRequest).mockImplementation(async(p,body,method)=>{
    const input=body as {items?:{price_id:string}[];proration_billing_mode?:string;custom_data?:{easycut_change_id:string}}|undefined;
    if(p.endsWith('/preview')) return {...subscription,id:undefined,currency_code:'USD',items:[{price:{id:creatorPrice},quantity:1}],
      next_transaction:{billing_period:{starts_at:subscription.next_billed_at,ends_at:'2027-01-26T00:00:00Z'}},
      immediate_transaction:input?.proration_billing_mode==='prorated_immediately'?{
        ...transaction,billing_period:{starts_at:new Date().toISOString(),ends_at:subscription.next_billed_at},
        details:{totals:{total:'800',subtotal:'800',tax:'0',discount:'0'},line_items:[]},
      }:null};
    if(p===`/subscriptions/${sub}` && method==='PATCH') {
      subscription={...subscription,custom_data:input?.custom_data,items:[{price:{id:input!.items![0].price_id},quantity:1}],updated_at:new Date().toISOString()};
      return subscription;
    }
    return p.startsWith('/subscriptions/')?subscription:p.startsWith('/adjustments?')?[adjustment]:transaction;
  });
}
describe('Plan changes without duplicate charges or lost paid allowances',()=>{
 it('defers term changes and downgrades; only same-term higher tiers are immediate',()=>{
  expect(changeTiming('paddle_lite','paddle_creator_6m')).toBe('renewal');
  expect(changeTiming('paddle_pro_6m','paddle_creator_6m')).toBe('renewal');
  expect(changeTiming('paddle_creator_6m','paddle_pro_6m')).toBe('immediate');
  expect(changePayload('paddle_pro_6m','paddle_lite',price)).toMatchObject({proration_billing_mode:'do_not_bill'});
 });
 it('prorates only the incremental minutes this month; future months get full differences',()=>{
  const grants=upgradeAllowances('paddle_creator_3m','paddle_pro_3m',new Date('2026-09-01Z'),new Date('2026-12-01Z'),new Date('2026-09-16Z'));
  expect(grants.map(g=>g.seconds)).toEqual([12000,24000,24000]);
  expect(grants[1].start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
 });
 it('quotes and confirms next-renewal change without changing paid benefits, then applies exactly once when paid',async()=>{
  await processPaddleEvent(event(),tag(pg)); installChangeProvider();
  const q=await quotePaddleChange(user,'paddle_creator_3m',tag(pg));
  expect(q).toMatchObject({timing:'renewal',amountMinor:0,status:'quoted',currency:'USD'});
  expect(vi.mocked(paddleRequest).mock.calls.filter(([p,,m])=>p===`/subscriptions/${sub}`&&m==='PATCH')).toHaveLength(0);
  await expect(confirmPaddleChange(other,q.id,tag(pg))).rejects.toThrow('not found');
  const result=await confirmPaddleChange(user,q.id,tag(pg));
  expect(result.status).toBe('scheduled');
  await confirmPaddleChange(user,q.id,tag(pg));
  expect(vi.mocked(paddleRequest).mock.calls.filter(([p,,m])=>p===`/subscriptions/${sub}`&&m==='PATCH')).toHaveLength(1);
  expect((await rows('user_subscriptions'))[0].plan_code).toBe('paddle_lite');
  expect((await rows('usage_grants'))).toHaveLength(1);
  await processPaddleEvent(event('subscription.updated',sub,2),tag(pg));
  expect((await rows('user_subscriptions'))[0].plan_code).toBe('paddle_lite');
  await expect(quotePaddleChange(user,'paddle_pro',tag(pg))).rejects.toThrow('already pending');
  transaction={...transaction,id:'txn_'+'b'.repeat(26),origin:'subscription_recurring',billing_period:{starts_at:'2026-10-26T00:00:00Z',ends_at:'2027-01-26T00:00:00Z'},items:[{quantity:1,proration:null,price:{id:creatorPrice,unit_price:{amount:'4497',currency_code:'USD'},tax_mode:'internal',billing_cycle:{interval:'month',frequency:3}}}],details:{totals:{total:'4497',subtotal:'4497',tax:'0',discount:'0'},line_items:[]}};
  subscription.next_billed_at='2027-01-26T00:00:00Z';subscription.updated_at='2026-10-26T00:00:01Z';
  await processPaddleEvent(event('transaction.completed',transaction.id,3),tag(pg));
  await processPaddleEvent(event('transaction.completed',transaction.id,4),tag(pg));
  expect((await rows('user_subscriptions'))[0].plan_code).toBe('paddle_creator_3m');
  expect(await rows('usage_grants')).toHaveLength(4);
  expect((await rows('paddle_plan_changes'))[0].status).toBe('applied');
  // A refund of the old monthly payment must not use the new 200-minute quota.
  adjustment.totals={total:'199',subtotal:'199'};
  await processPaddleEvent(event('adjustment.created',adjustment.id,5),tag(pg));
  const old=(await rows('usage_grants')).find(g=>g.product_code==='paddle_lite')!;
  expect(old.total_seconds).toBe(Math.floor(3600*(1-199/399)));
 });
 it.each([false,true])('restores the paid boundary after a frequency reset, including interrupted writes (%s)',async interrupted=>{
  await processPaddleEvent(event(),tag(pg));installChangeProvider();
  const impl=vi.mocked(paddleRequest).getMockImplementation()!;
  const paidEnd=subscription.next_billed_at;
  let dateWrites=0, itemWrites=0;
  vi.mocked(paddleRequest).mockImplementation(async(p,b,m)=>{
    const body=b as {next_billed_at?:string;items?:{price_id:string}[];proration_billing_mode?:string;custom_data?:{easycut_change_id:string}}|undefined;
    if(p.endsWith('/preview')&&body?.next_billed_at&&!body.items) {
      expect(body.proration_billing_mode).toBe('do_not_bill');
      return {...subscription,id:undefined,next_billed_at:body.next_billed_at,immediate_transaction:null};
    }
    if(p===`/subscriptions/${sub}`&&m==='PATCH') {
      expect(body?.proration_billing_mode).toBe('do_not_bill');
      if(body?.items) {
        itemWrites++;subscription={...subscription,items:[{price:{id:creatorPrice},quantity:1}],custom_data:body.custom_data,next_billed_at:'2026-12-26T00:00:00Z'};
      } else {
        dateWrites++;if(interrupted&&dateWrites===1)throw Error('Network timeout');
        subscription={...subscription,next_billed_at:body!.next_billed_at!};
      }
      return subscription;
    }
    return impl(p,b,m);
  });
  const q=await quotePaddleChange(user,'paddle_creator_3m',tag(pg));
  if(interrupted) {
    await expect(confirmPaddleChange(user,q.id,tag(pg))).rejects.toThrow('Do not repeat');
    expect((await rows('paddle_plan_changes'))[0].status).toBe('unknown');
    await reconcileRenewalChange(q.id,tag(pg));
  } else await confirmPaddleChange(user,q.id,tag(pg));
  expect(+new Date(subscription.next_billed_at!)).toBe(+new Date(paidEnd!));
  expect(itemWrites).toBe(1);expect(dateWrites).toBe(interrupted?2:1);
  expect((await rows('paddle_plan_changes'))[0].status).toBe('scheduled');
  expect((await rows('user_subscriptions'))[0].plan_code).toBe('paddle_lite');
  expect(await rows('usage_grants')).toHaveLength(1);
 });
 it('rejects a larger fresh charge before making any provider mutation',async()=>{
  await processPaddleEvent(event(),tag(pg));installChangeProvider();
  const q=await quotePaddleChange(user,'paddle_creator',tag(pg));
  const impl=vi.mocked(paddleRequest).getMockImplementation()!;
  vi.mocked(paddleRequest).mockImplementation(async(p,b,m)=>{
    const result=await impl(p,b,m);
    if(p.endsWith('/preview')) (result as {immediate_transaction:PaddleTransaction}).immediate_transaction.details.totals.total='801';
    return result;
  });
  await expect(confirmPaddleChange(user,q.id,tag(pg))).rejects.toThrow();
  expect(vi.mocked(paddleRequest).mock.calls.filter(([p,,m])=>p===`/subscriptions/${sub}`&&m==='PATCH')).toHaveLength(0);
 });
 it('does not dispatch an expired/stale quote or charge more than the accepted quote',async()=>{
  await processPaddleEvent(event(),tag(pg));installChangeProvider();
  const q=await quotePaddleChange(user,'paddle_creator',tag(pg));
  subscription.updated_at='2026-09-26T00:00:01Z';
  await expect(confirmPaddleChange(user,q.id,tag(pg))).rejects.toThrow('Refresh');
  subscription.updated_at='2026-09-26T00:00:00Z';
  vi.setSystemTime(new Date('2026-09-26T00:06:00Z'));
  await expect(confirmPaddleChange(user,q.id,tag(pg))).rejects.toThrow('Refresh');
  expect(vi.mocked(paddleRequest).mock.calls.filter(([p,,m])=>p===`/subscriptions/${sub}`&&m==='PATCH')).toHaveLength(0);
 });
 it('uncertain dispatch remains reserved and can never retry the charge',async()=>{
  await processPaddleEvent(event(),tag(pg));installChangeProvider();
  const q=await quotePaddleChange(user,'paddle_creator',tag(pg));
  const impl=vi.mocked(paddleRequest).getMockImplementation()!;
  vi.mocked(paddleRequest).mockImplementation((p,b,m)=>{if(p===`/subscriptions/${sub}`&&m==='PATCH') throw Error('timeout');return impl(p,b,m)});
  await expect(confirmPaddleChange(user,q.id,tag(pg))).rejects.toThrow('Do not repeat');
  const repeat=await confirmPaddleChange(user,q.id,tag(pg));expect(repeat.status).toBe('unknown');
  expect(vi.mocked(paddleRequest).mock.calls.filter(([p,,m])=>p===`/subscriptions/${sub}`&&m==='PATCH')).toHaveLength(1);
  expect((await rows('user_subscriptions'))[0].plan_code).toBe('paddle_lite');
  expect(await rows('usage_grants')).toHaveLength(1);
 });
 it('grants an upgrade only after canonical payment, preserves consumption and refunds only its increment',async()=>{
  await processPaddleEvent(event(),tag(pg));installChangeProvider();
  await pg.exec('update shorts_mvp.usage_grants set consumed_seconds=1800');
  const q=await quotePaddleChange(user,'paddle_creator',tag(pg));
  await confirmPaddleChange(user,q.id,tag(pg));
  expect((await rows('user_subscriptions'))[0].plan_code).toBe('paddle_lite');
  const upgradeId='txn_'+'u'.repeat(26);
  transaction={...transaction,id:upgradeId,origin:'subscription_update',custom_data:{easycut_change_id:q.id},items:[{quantity:-1,proration:{rate:'1',billing_period:transaction.billing_period!},price:{...transaction.items[0].price}},{quantity:1,proration:{rate:'1',billing_period:transaction.billing_period!},price:{id:creatorPrice,unit_price:{amount:'1199',currency_code:'USD'},tax_mode:'internal',billing_cycle:{interval:'month',frequency:1}}}],details:{totals:{total:'800',subtotal:'800',tax:'0',discount:'0'},line_items:[]}};
  await processPaddleEvent(event('transaction.completed',upgradeId,2),tag(pg));
  await processPaddleEvent(event('transaction.completed',upgradeId,3),tag(pg));
  expect((await rows('user_subscriptions'))[0].plan_code).toBe('paddle_creator');
  const grants=await rows('usage_grants');expect(grants).toHaveLength(2);
  expect(grants.find(g=>g.kind==='base')?.consumed_seconds).toBe(1800);
  expect(grants.find(g=>g.kind==='addon')?.total_seconds).toBe(8400);
  adjustment.transaction_id=upgradeId;adjustment.totals={total:'800',subtotal:'800'};
  await processPaddleEvent(event('adjustment.created',adjustment.id,4),tag(pg));
  expect((await rows('usage_grants')).find(g=>g.kind==='addon')?.status).toBe('revoked');
  expect((await rows('usage_grants')).find(g=>g.kind==='base')?.total_seconds).toBe(3600);
 });
 it('rejects an unsolicited or overcharged upgrade instead of granting time',async()=>{
  await processPaddleEvent(event(),tag(pg));installChangeProvider();
  transaction.origin='subscription_update';transaction.id='txn_'+'v'.repeat(26);
  await expect(processPaddleEvent(event('transaction.completed',transaction.id,2),tag(pg))).rejects.toThrow('Unexpected upgrade');
 });
});

describe('Canceling deferred changes',()=>{
 it.each(['none','items','date'])('restores price and paid date without charge; resumes after %s timeout',async failure=>{
  await processPaddleEvent(event(),tag(pg));installChangeProvider();
  const q=await quotePaddleChange(user,'paddle_creator_3m',tag(pg));
  await confirmPaddleChange(user,q.id,tag(pg));
  const before=await rows('usage_grants');
  const paidEnd=subscription.next_billed_at;
  const impl=vi.mocked(paddleRequest).getMockImplementation()!;
  let itemWrites=0,dateWrites=0;
  vi.mocked(paddleRequest).mockImplementation(async(p,b,m)=>{
   const body=b as {next_billed_at?:string;items?:{price_id:string}[];proration_billing_mode?:string;custom_data?:Record<string,unknown>}|undefined;
   if(p.endsWith('/preview')) return {...subscription,items:body?.items?[{price:{id:body.items[0].price_id},quantity:1}]:subscription.items,
     next_billed_at:body?.next_billed_at||subscription.next_billed_at,immediate_transaction:null};
   if(p===`/subscriptions/${sub}`&&m==='PATCH') {
    expect(body?.proration_billing_mode).toBe('do_not_bill');
    if(body?.items) {
     itemWrites++;subscription={...subscription,items:[{price:{id:body.items[0].price_id},quantity:1}],custom_data:body.custom_data,next_billed_at:'2026-11-26T00:00:00Z'};
     if(failure==='items'&&itemWrites===1)throw Error('Response lost after provider accepted');
    } else {
     dateWrites++;
     if(failure==='date'&&dateWrites===1)throw Error('Timeout before date accepted');
     subscription={...subscription,next_billed_at:body!.next_billed_at!};
    }
    return subscription;
   }
   return impl(p,b,m);
  });
  await expect(cancelPaddleChange(other,q.id,tag(pg))).rejects.toThrow('not found');
  if(failure!=='none') {
   await expect(cancelPaddleChange(user,q.id,tag(pg))).rejects.toThrow('being confirmed');
   expect((await rows('paddle_plan_changes'))[0].status).toBe('unknown');
   await expect(quotePaddleChange(user,'paddle_creator',tag(pg))).rejects.toThrow('already pending');
   await reconcileRenewalChange(q.id,tag(pg));
  } else await cancelPaddleChange(user,q.id,tag(pg));
  await cancelPaddleChange(user,q.id,tag(pg));
  expect(itemWrites).toBe(1);expect(dateWrites).toBe(failure==='date'?2:1);
  expect(subscription.items[0].price.id).toBe(price);
  expect(+new Date(subscription.next_billed_at!)).toBe(+new Date(paidEnd!));
  expect(await rows('usage_grants')).toEqual(before);
  expect((await rows('user_subscriptions'))[0].plan_code).toBe('paddle_lite');
  expect((await rows('paddle_plan_changes'))[0].canceled_at).toBeTruthy();
  installChangeProvider();
  expect((await quotePaddleChange(user,'paddle_creator_3m',tag(pg))).status).toBe('quoted');
 });
 it('rejects cancellation near renewal or of an immediate operation',async()=>{
  await processPaddleEvent(event(),tag(pg));installChangeProvider();
  const q=await quotePaddleChange(user,'paddle_creator_3m',tag(pg));await confirmPaddleChange(user,q.id,tag(pg));
  vi.setSystemTime(new Date('2026-10-25T23:40:00Z'));
  await expect(cancelPaddleChange(user,q.id,tag(pg))).rejects.toThrow('Refresh');
  expect((await rows('paddle_plan_changes'))[0].cancel_requested_at).toBeNull();
 });
});

it('uses the actual paid item if renewal arrives after cancellation but before recovery',async()=>{
 await processPaddleEvent(event(),tag(pg));installChangeProvider();
 const q=await quotePaddleChange(user,'paddle_creator_3m',tag(pg));await confirmPaddleChange(user,q.id,tag(pg));
 await pg.query("update shorts_mvp.paddle_plan_changes set cancel_requested_at=now(),status='unknown' where id=$1",[q.id]);
 const {paidPlanCode}=await import('./change-ledger');
 const paid={...transaction,id:'txn_'+'r'.repeat(26),billing_period:{starts_at:'2026-10-26T00:00:00Z',ends_at:'2026-11-26T00:00:00Z'}};
 expect(await paidPlanCode(tag(pg),paid,{paddleId:sub},'paddle_lite')).toEqual({code:'paddle_lite',changeId:null});
 expect((await rows('paddle_plan_changes'))[0].status).toBe('superseded');
});


describe("JPY price cohort renewals", () => {
 it.each([false,true])("preserves the exact original price when renewing new cohort=%s", async newer => {
  const id="pri_"+(newer?"n":"j").repeat(26),amount=newer?750:590;
  const code=newer?"paddle_lite_jpy_20261021":"paddle_lite";
  await pg.query("update shorts_mvp.paddle_checkouts set plan_code=$1,currency='JPY',price_id=$2 where id=$3",[code,id,checkout]);
  transaction.currency_code="JPY";
  transaction.items[0].price.id=id;
  transaction.items[0].price.unit_price={amount:String(amount),currency_code:"JPY"};
  transaction.details.totals={total:String(amount),subtotal:String(amount),tax:"0",discount:"0"};
  subscription.items[0].price.id=id;
  await processPaddleEvent(event(),tag(pg));
  transaction.id="txn_"+"r".repeat(26);
  transaction.billing_period={starts_at:"2026-10-26T00:00:00Z",ends_at:"2026-11-26T00:00:00Z"};
  subscription.current_billing_period=transaction.billing_period;
  subscription.next_billed_at=transaction.billing_period.ends_at;
  subscription.updated_at="2026-10-26T00:00:00Z";
  await processPaddleEvent(event("transaction.completed",transaction.id,2),tag(pg));
  expect((await rows("paddle_payments")).map(p=>Number(p.amount_minor))).toEqual([amount,amount]);
  expect((await rows("user_subscriptions"))[0].plan_code).toBe(code);
  expect(await rows("usage_grants")).toHaveLength(2);
  const {quotePaddleChange}=await import('./changes');
  const target=newer?'paddle_creator_3m':'paddle_creator_3m_jpy_20261021';
  vi.mocked(paddleRequest).mockClear();
  await expect(quotePaddleChange(user,target,tag(pg))).rejects.toMatchObject({code:'CHANGE_CONFLICT'});
  expect(paddleRequest).not.toHaveBeenCalled();
 });
 it("rejects a fresh checkout at the legacy JPY price",async()=>{
  await expect(preparePaddleCheckout(user,"paddle_lite","JPY",tag(pg))).rejects.toMatchObject({code:"PRICE_CHANGED"});
  expect(paddleRequest).not.toHaveBeenCalled();
 });
});
