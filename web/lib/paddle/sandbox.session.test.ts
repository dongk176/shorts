/** Opt-in interactive sandbox contract check. Never loads live or remote DB settings. */
import { it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { PGlite } from "../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import {
  preparePaddleCheckout,
  processPaddleEvent,
  createPaddlePortal,
} from "./service";
import { paddleRequest } from "./api";
import type {
  PaddleTransaction,
  PaddleSubscription,
  PaddleAdjustment,
} from "./models";

it.skipIf(process.env.RUN_PADDLE_SANDBOX !== "1")(
  "real sandbox checkout and local billing ledger session",
  async () => {
    if (process.env.DATABASE_URL || process.env.VERCEL_ENV)
      throw new Error("Run without database/deployment environment");
    const env = Object.fromEntries(
      readFileSync("../.secrets/paddle-sandbox.env", "utf8")
        .trim()
        .split("\n")
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    if (
      Object.keys(env).some((key) => !key.startsWith("PADDLE_")) ||
      env.PADDLE_ENVIRONMENT !== "sandbox" ||
      !env.PADDLE_API_KEY?.startsWith("pdl_sdbx_apikey_") ||
      !env.PADDLE_CLIENT_TOKEN?.startsWith("test_")
    )
      throw new Error("Sandbox credentials required");
    const previousEnv = Object.fromEntries(
      [...Object.keys(env), "PADDLE_ENABLED"].map((key) => [
        key,
        process.env[key],
      ]),
    );
    mkdirSync("../.tmp/paddle-sandbox", { recursive: true, mode: 0o700 });
    Object.assign(process.env, env, { PADDLE_ENABLED: "true" });
    const pg = new PGlite();
    const tag = (engine: Pick<PGlite, "query">): Sql =>
      Object.assign(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const result = await engine.query<Record<string, unknown>>(
            strings.reduce((s, p, i) => s + (i ? `$${i}` : "") + p, ""),
            values,
          );
          return result.rows.map((r) =>
            Object.fromEntries(
              Object.entries(r).map(([k, v]) => [
                k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
                v,
              ]),
            ),
          );
        },
        {
          begin: (fn: (tx: Sql) => Promise<unknown>) =>
            pg.transaction((tx) => fn(tag(tx))),
        },
      ) as unknown as Sql;
    const db = tag(pg);
    const txns: Record<string, string> = {};
    const refunds: Record<string, string> = {};
    const checked = new Set<string>();
    let sequence = 0;
    const user = (currency: string) =>
      currency === "USD"
        ? "00000000-0000-4000-8000-000000000011"
        : "00000000-0000-4000-8000-000000000012";
    const evidence: Array<Record<string, unknown>> = [];
    const record = (value: Record<string, unknown>) => {
      evidence.push(value);
      writeFileSync(
        "../.tmp/paddle-sandbox/results.json",
        JSON.stringify(evidence, null, 2) + "\n",
        { mode: 0o600 },
      );
      console.log(JSON.stringify(value));
    };
    const apply = async (type: string, id: string) => {
      const event = {
        event_id: "evt_" + String(++sequence).padStart(26, "0"),
        event_type: type,
        occurred_at: new Date().toISOString(),
        data: { id },
      };
      expect(await processPaddleEvent(event, db)).toBe("processed");
      expect(await processPaddleEvent(event, db)).toBe("duplicate");
    };
    let finish!: () => void;
    const finished = new Promise<void>((r) => (finish = r));
    const session = randomBytes(24).toString("hex");
    const host = "127.0.0.1:3419";
    const server = createServer(async (req, res) => {
      if (req.headers.host !== host) {
        res.writeHead(403);
        res.end();
        return;
      }
      const url = new URL(req.url || "/", `http://${host}`);
      try {
        if (req.method === "GET" && url.pathname === "/") {
          res.setHeader(
            "Set-Cookie",
            `sandbox_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
          );
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(
            `<!doctype html><html><meta charset="utf-8"><title>EasyCut sandbox contract check</title><style>body{font:18px system-ui;max-width:800px;margin:50px auto}button{padding:14px;margin:8px}pre{white-space:pre-wrap}</style><h1>EasyCut — sandbox only</h1><p>Real Paddle test checkout. Local fictional users and billing ledger. No production database. Event envelopes are locally generated for reconciliation; this does not verify Paddle webhook delivery.</p><button onclick="start('USD')">English · $9.90</button><button onclick="start('JPY')">日本語 · ¥1,480</button><div>${["USD", "JPY"].map((c) => ["sync", "portal", "cancel", "refund"].map((a) => `<button onclick="action('${a}','${c}')">${c} ${a}</button>`).join("")).join("")}</div><button onclick="action('finish','USD')">Finish checks</button><pre id="result">Ready</pre><script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script><script>Paddle.Environment.set('sandbox');Paddle.Initialize({token:${JSON.stringify(env.PADDLE_CLIENT_TOKEN)},eventCallback:e=>{if(e.name==='checkout.completed')document.querySelector('#result').textContent='Checkout completed; use sync to verify server ledger.';}});async function call(a,c){const r=await fetch('/action?a='+a+'&currency='+c,{method:'POST'});const d=await r.json();document.querySelector('#result').textContent=JSON.stringify(d,null,2);return d;}async function start(c){const d=await call('create',c);if(d.transactionId)Paddle.Checkout.open({transactionId:d.transactionId,settings:{locale:c==='JPY'?'ja':'en',showAddDiscounts:false,allowLogout:false}});}async function action(a,c){const d=await call(a,c);if(d.portal)window.open(d.portal,'_blank','noopener');}</script></html>`,
          );
          return;
        }
        if (
          req.method !== "POST" ||
          url.pathname !== "/action" ||
          req.headers.origin !== `http://${host}` ||
          !req.headers.cookie?.includes("sandbox_session=" + session)
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        const currency = url.searchParams.get("currency");
        if (currency !== "USD" && currency !== "JPY")
          throw new Error("Invalid currency");
        const action = url.searchParams.get("a");
        let output: unknown;
        if (action === "create") {
          txns[currency] = await preparePaddleCheckout(
            user(currency),
            "paddle_lite",
            currency,
            db,
          );
          output = { transactionId: txns[currency] };
          record({
            check: "checkout-created",
            currency,
            transactionId: txns[currency],
          });
        } else if (action === "finish") {
          expect([...checked].sort()).toEqual([
            "JPY-cancel",
            "JPY-paid",
            "JPY-refund",
            "USD-cancel",
            "USD-paid",
            "USD-refund",
          ]);
          output = { finished: true };
          finish();
        } else {
          const id = txns[currency];
          if (!id) throw new Error("Create checkout first");
          const txn = await paddleRequest<PaddleTransaction>(
            "/transactions/" + id,
          );
          if (action === "sync") {
            if (txn.status !== "completed") output = { status: txn.status };
            else {
              await apply("transaction.completed", id);
              const grants = (
                await pg.query<{ total_seconds: number }>(
                  "select total_seconds from shorts_mvp.usage_grants where user_id=$1",
                  [user(currency)],
                )
              ).rows;
              expect(grants).toEqual([{ total_seconds: 3600 }]);
              checked.add(currency + "-paid");
              output = {
                status: "paid",
                grants: 1,
                minutes: 60,
                duplicateIgnored: true,
              };
              record({ check: "paid-ledger", currency, ...(output as object) });
            }
          } else if (action === "portal") {
            output = { portal: await createPaddlePortal(user(currency), db) };
            record({ check: "portal-created", currency });
          } else if (action === "cancel") {
            if (!checked.has(currency + "-paid"))
              throw new Error("Verify paid ledger first");
            const sub = await paddleRequest<PaddleSubscription>(
              "/subscriptions/" + txn.subscription_id + "/cancel",
              { effective_from: "next_billing_period" },
            );
            expect(sub.scheduled_change?.action).toBe("cancel");
            await apply("subscription.updated", sub.id);
            const state = (
              await pg.query<{ cancel_at_period_end: boolean; status: string }>(
                "select cancel_at_period_end,status from shorts_mvp.user_subscriptions where user_id=$1",
                [user(currency)],
              )
            ).rows[0];
            expect(state.cancel_at_period_end).toBe(true);
            expect(state.status).toBe("active");
            checked.add(currency + "-cancel");
            output = { scheduledCancel: true, paidPeriodPreserved: true };
            record({ check: "cancel", currency, ...(output as object) });
          } else if (action === "refund") {
            if (!checked.has(currency + "-cancel"))
              throw new Error("Schedule cancellation first");
            const adjustment = refunds[currency]
              ? (
                  await paddleRequest<PaddleAdjustment[]>(
                    "/adjustments?id=" + refunds[currency],
                  )
                )[0]
              : await paddleRequest<PaddleAdjustment>("/adjustments", {
                  action: "refund",
                  transaction_id: id,
                  reason: "EasyCut sandbox integration test only",
                  type: "full",
                });
            refunds[currency] = adjustment.id;
            await apply("adjustment.created", adjustment.id);
            const grant = (
              await pg.query<{ status: string }>(
                "select status from shorts_mvp.usage_grants where user_id=$1",
                [user(currency)],
              )
            ).rows[0];
            if (adjustment.status === "approved") {
              expect(grant.status).not.toBe("active");
              checked.add(currency + "-refund");
            }
            output = {
              refundStatus: adjustment.status,
              grantStatus: grant.status,
            };
            record({ check: "refund", currency, ...(output as object) });
          } else throw new Error("Unknown action");
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(output));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed";
        record({ check: "error", message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    });
    try {
      await pg.exec(
        readFileSync(
          "../test-fixtures/paddle-production-schema-20260926.sql",
          "utf8",
        ),
      );
      await pg.exec(
        readFileSync(
          "../supabase/migrations/202609260010_paddle_billing.sql",
          "utf8",
        ),
      );
      await pg.exec(
        "insert into shorts_mvp.plans(code,display_name,monthly_source_seconds,sort_order) values('free','Free',0,0)",
      );
      await pg.query("insert into shorts_mvp.app_users(id) values($1),($2)", [
        user("USD"),
        user("JPY"),
      ]);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(3419, "127.0.0.1", resolve);
      });
      console.log("SANDBOX READY http://127.0.0.1:3419");
      await finished;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pg.close();
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
  1200000,
);
