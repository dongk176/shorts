import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";

it("applies twice to observed production billing constraints without validating unrelated legacy rows", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      fs.readFileSync(
        path.resolve("../test-fixtures/paddle-production-schema-20260926.sql"),
        "utf8",
      ),
    );
    const boundary = (
      await pg.query<{ definition: string }>(
        "select pg_get_constraintdef(oid) as definition from pg_constraint where conname='plans_code_check'",
      )
    ).rows[0].definition;
    await pg.exec(`alter table shorts_mvp.plans drop constraint plans_code_check;
      insert into shorts_mvp.plans(code,display_name,monthly_source_seconds,sort_order) values('legacy_fixture','Legacy fixture',0,-1);
      alter table shorts_mvp.plans add constraint plans_code_check ${boundary};`);
    const migration = fs.readFileSync(
      path.resolve("../supabase/migrations/202609260010_paddle_billing.sql"),
      "utf8",
    );
    await pg.exec(migration);
    await pg.exec(migration);
    const packages = fs.readFileSync(path.resolve("../supabase/migrations/202609260020_paddle_packages.sql"), "utf8");
    await pg.exec(packages);
    await pg.exec(packages);
    expect(
      (
        await pg.query(
          "select code from shorts_mvp.plans where code like 'paddle_%'",
        )
      ).rows,
    ).toHaveLength(9);
    expect(
      (
        await pg.query(
          "select code from shorts_mvp.plans where code='legacy_fixture'",
        )
      ).rows,
    ).toHaveLength(1);
    const before = await pg.query("select * from shorts_mvp.plans order by code");
    const repricing = fs.readFileSync(path.resolve("../supabase/migrations/20261020152718_paddle_jpy_new_subscriptions.sql"), "utf8");
    await pg.exec(repricing); await pg.exec(repricing);
    expect((await pg.query("select * from shorts_mvp.plans where code not like '%_jpy_20261021' order by code")).rows).toEqual(before.rows);
    expect((await pg.query("select code from shorts_mvp.plans where code like '%_jpy_20261021'")).rows).toHaveLength(7);
    const states = await pg.query<{ convalidated: boolean }>(
      "select convalidated from pg_constraint where conname in ('plans_code_check','user_subscriptions_payment_provider_check')",
    );
    expect(states.rows).toEqual([
      { convalidated: false },
      { convalidated: false },
    ]);
    await expect(
      pg.exec(
        "insert into shorts_mvp.plans(code,display_name,monthly_source_seconds,sort_order) values('invalid_new','Invalid',0,-2)",
      ),
    ).rejects.toThrow("plans_code_check");
    await pg.exec(`insert into shorts_mvp.plans(code,display_name,monthly_source_seconds,sort_order) values('free','Free',0,0);
      insert into shorts_mvp.app_users(id) values('00000000-0000-4000-8000-000000000001');
      insert into shorts_mvp.user_subscriptions(id,user_id,plan_code,status,billing_cycle,payment_provider,current_period_start,current_period_end)
      values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','paddle_lite','active','monthly','paddle','2026-09-26','2026-10-26');
      insert into shorts_mvp.usage_grants(user_id,subscription_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,valid_from,expires_at)
      values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','base','paddle_lite',3600,3600,0,'2026-09-26','2026-10-26');`);
    expect(
      (await pg.query("select total_seconds from shorts_mvp.usage_grants"))
        .rows,
    ).toEqual([{ total_seconds: 3600 }]);
  } finally {
    await pg.close();
  }
}, 30000);
