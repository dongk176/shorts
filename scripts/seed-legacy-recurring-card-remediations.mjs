import fs from "node:fs";
import path from "node:path";
import postgres from "../web/node_modules/postgres/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
const envPath = path.join(root, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ||= value;
  }
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const CAMPAIGN_KEY = "legacy_easycut_pro_202608";
const CUTOFF = "2026-08-04T05:38:23.085Z";
const EXPECTED_COUNT = 148;
const apply = process.argv.includes("--apply");
const enableAll = process.argv.includes("--enable-all");
const enableUserArgument = process.argv.find((argument) => argument.startsWith("--enable-user="));
const enableUserId = enableUserArgument?.slice("--enable-user=".length) || null;
const disableClaims = process.argv.includes("--disable-claims");
const selectedModes = [apply, enableAll, Boolean(enableUserId), disableClaims].filter(Boolean).length;
if (selectedModes > 1) {
  throw new Error("Choose only one of --apply, --enable-all, --enable-user, or --disable-claims");
}
if (enableUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(enableUserId)) {
  throw new Error("--enable-user must be a UUID");
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 15,
  prepare: false,
  transform: postgres.camel,
  connection: {
    application_name: "legacy-recurring-card-remediation-seed",
    statement_timeout: 30_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 30_000,
  },
});

async function candidates(tx) {
  return tx`
    select
      s.user_id,
      s.id as subscription_id,
      s.payment_method_id as legacy_payment_method_id,
      s.next_charge_at as original_next_charge_at,
      s.current_period_end as original_current_period_end,
      s.billing_anchor_day,
      m.created_at as payment_method_created_at,
      to_char(s.next_charge_at at time zone 'Asia/Seoul','YYYY-MM-DD') as kst_charge_date
    from shorts_mvp.user_subscriptions s
    join shorts_mvp.app_users u
      on u.id=s.user_id and u.default_payment_method_id=s.payment_method_id
    join shorts_mvp.billing_payment_methods m
      on m.id=s.payment_method_id and m.user_id=s.user_id
    join shorts_mvp.plans p
      on p.code=s.plan_code and p.monthly_price_krw=9900
    where s.status='active'
      and s.plan_code='easycut_pro_v2'
      and s.billing_cycle='monthly'
      and s.payment_provider='thepayone'
      and s.provider_schedule_status='active'
      and s.cancel_at_period_end=false
      and s.scheduled_plan_code is null
      and s.scheduled_billing_cycle is null
      and s.next_charge_at is not null
      and s.next_charge_at=s.current_period_end
      and s.billing_anchor_day between 1 and 28
      and extract(day from s.next_charge_at at time zone 'Asia/Seoul')::integer=s.billing_anchor_day
      and m.provider='thepayone'
      and m.status='active'
      and m.provider_schedule_status='active'
      and m.registration_order_id is not null
      and m.created_at<${CUTOFF}::timestamptz
      and exists (
        select 1
        from shorts_mvp.billing_orders initial_order
        where initial_order.user_id=s.user_id
          and initial_order.subscription_id=s.id
          and initial_order.payment_method_id=m.id
          and initial_order.kind='subscription_initial'
          and initial_order.product_code='easycut_pro_v2'
          and initial_order.billing_cycle='monthly'
          and initial_order.amount_krw=9900
          and initial_order.status='succeeded'
      )
    order by s.next_charge_at,s.user_id
  `;
}

function assertCandidateInvariants(rows) {
  if (rows.length !== EXPECTED_COUNT) {
    throw new Error(`Expected ${EXPECTED_COUNT} candidates, found ${rows.length}`);
  }
  for (const key of ["userId", "subscriptionId", "legacyPaymentMethodId"]) {
    if (new Set(rows.map((row) => row[key])).size !== EXPECTED_COUNT) {
      throw new Error(`${key} is not one-to-one across all ${EXPECTED_COUNT} candidates`);
    }
  }
}

try {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${CAMPAIGN_KEY},0))`;
    if (disableClaims) {
      await tx`
        update shorts_mvp.runtime_feature_flags
        set enabled=false
        where flag_key='legacy_recurring_card_claims'
      `;
      const reconciliationRows = await tx`
        select enabled from shorts_mvp.runtime_feature_flags
        where flag_key='legacy_recurring_card_reconciliation'
      `;
      return {
        mode: "disable-claims",
        reconciliationRemainsEnabled: reconciliationRows[0]?.enabled === true,
      };
    }

    if (enableAll || enableUserId) {
      const seededRows = await tx`
        select r.id,r.user_id,r.state,
          to_char(r.original_next_charge_at at time zone 'Asia/Seoul','YYYY-MM-DD') as kst_charge_date,
          (
            s.status='active'
            and s.plan_code=r.expected_product_code
            and s.billing_cycle='monthly'
            and s.payment_method_id=r.legacy_payment_method_id
            and s.next_charge_at=r.original_next_charge_at
            and s.current_period_end=r.original_current_period_end
            and s.billing_anchor_day=r.billing_anchor_day
            and s.cancel_at_period_end=false
            and s.scheduled_plan_code is null
            and u.default_payment_method_id=r.legacy_payment_method_id
            and m.status='active'
            and m.provider_schedule_status='active'
            and (clock_timestamp() at time zone 'Asia/Seoul')::date
              < (r.original_next_charge_at at time zone 'Asia/Seoul')::date
          ) as snapshot_matches
        from shorts_mvp.billing_payment_method_remediations r
        join shorts_mvp.user_subscriptions s on s.id=r.subscription_id
        join shorts_mvp.billing_payment_methods m on m.id=r.legacy_payment_method_id
        join shorts_mvp.app_users u on u.id=r.user_id
        where r.campaign_key=${CAMPAIGN_KEY}
        order by r.original_next_charge_at,r.user_id
      `;
      if (seededRows.length !== EXPECTED_COUNT) {
        throw new Error(`Expected ${EXPECTED_COUNT} seeded rows before enable, found ${seededRows.length}`);
      }
      const rowsToEnable = seededRows.filter((row) => (
        row.state === "required"
        && (enableAll || row.userId === enableUserId)
      ));
      if (rowsToEnable.some((row) => row.snapshotMatches !== true)) {
        throw new Error("One or more rows selected for enable no longer match their immutable snapshot");
      }
      if (enableUserId && rowsToEnable.length !== 1) {
        throw new Error(`Expected one required canary row for ${enableUserId}, found ${rowsToEnable.length}`);
      }
      const enabled = enableAll
        ? await tx`
            update shorts_mvp.billing_payment_method_remediations
            set enabled_at=coalesce(enabled_at,now())
            where campaign_key=${CAMPAIGN_KEY} and state='required'
            returning id
          `
        : await tx`
            update shorts_mvp.billing_payment_method_remediations
            set enabled_at=coalesce(enabled_at,now())
            where campaign_key=${CAMPAIGN_KEY} and state='required' and user_id=${enableUserId}
            returning id
          `;
      await tx`
        update shorts_mvp.runtime_feature_flags
        set enabled=true
        where flag_key in (
          'legacy_recurring_card_claims',
          'legacy_recurring_card_reconciliation'
        )
      `;
      const dueDates = Object.fromEntries(
        [...new Set(seededRows.map((row) => row.kstChargeDate))]
          .sort()
          .map((date) => [date, seededRows.filter((row) => row.kstChargeDate === date).length]),
      );
      return {
        mode: enableAll ? "enable-all" : "enable-user",
        seededCount: seededRows.length,
        enabledCount: enabled.length,
        dueDates,
      };
    }

    const rows = await candidates(tx);
    assertCandidateInvariants(rows);
    const dueDates = Object.fromEntries(
      [...new Set(rows.map((row) => row.kstChargeDate))]
        .sort()
        .map((date) => [date, rows.filter((row) => row.kstChargeDate === date).length]),
    );

    if (apply) {
      for (const row of rows) {
        await tx`
          insert into shorts_mvp.billing_payment_method_remediations (
            campaign_key,user_id,subscription_id,legacy_payment_method_id,
            original_next_charge_at,original_current_period_end,billing_anchor_day,
            expected_product_code,expected_amount_krw,eligibility_cutoff
          ) values (
            ${CAMPAIGN_KEY},${row.userId},${row.subscriptionId},${row.legacyPaymentMethodId},
            ${row.originalNextChargeAt},${row.originalCurrentPeriodEnd},${row.billingAnchorDay},
            'easycut_pro_v2',9900,${CUTOFF}::timestamptz
          )
          on conflict (campaign_key,user_id) do nothing
        `;
      }
      const seeded = await tx`
        select count(*)::integer as count
        from shorts_mvp.billing_payment_method_remediations
        where campaign_key=${CAMPAIGN_KEY}
      `;
      if (Number(seeded[0]?.count) !== EXPECTED_COUNT) {
        throw new Error(`Seed transaction would leave ${seeded[0]?.count || 0} campaign rows`);
      }
    }

    return {
      mode: apply ? "apply" : "dry-run",
      candidateCount: rows.length,
      dueDates,
      firstPaymentMethodCreatedAt: rows[0]?.paymentMethodCreatedAt || null,
      lastPaymentMethodCreatedAt: rows.at(-1)?.paymentMethodCreatedAt || null,
    };
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!selectedModes) {
    process.stdout.write("Dry run only. Use --apply to create disabled snapshots after the migration is live.\n");
  }
} finally {
  await sql.end({ timeout: 3 });
}
