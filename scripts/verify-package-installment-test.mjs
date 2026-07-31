import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postgres from "../web/node_modules/postgres/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
const envFile = path.join(root, ".env.local");
if (fs.existsSync(envFile)) {
  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    process.env[key] ||= value;
  }
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL이 필요합니다.");
const requireComplete = process.argv.includes("--require-complete");
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 15,
  idle_timeout: 5,
  transform: postgres.camel,
});

try {
  const requiredColumns = await sql`
    select table_name,column_name
    from information_schema.columns
    where table_schema='shorts_mvp' and (
      (
        table_name='billing_card_verifications'
        and column_name in (
          'provider_credential_scope','provider_merchant_id','provider_terminal_id'
        )
      )
      or (
        table_name='payment_method_registrations'
        and column_name in (
          'provider_credential_scope','provider_merchant_id','provider_terminal_id'
        )
      )
      or (
        table_name='payment_provider_installment_capabilities'
        and column_name='credential_scope'
      )
    )
    order by table_name,column_name
  `;
  assert.equal(requiredColumns.length, 7, "패키지 할부 스냅샷 컬럼이 모두 적용되지 않았습니다.");

  const [ledgerTable] = await sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema='shorts_mvp'
      and table_name='payment_test_package_orders'
  `;
  assert.equal(ledgerTable.count, 1, "패키지 결제 테스트 원장 테이블이 없습니다.");
  const ledgerColumns = await sql`
    select column_name,is_nullable
    from information_schema.columns
    where table_schema='shorts_mvp'
      and table_name='payment_test_package_orders'
      and column_name in (
        'payment_input_mode','provider_response_issuer',
        'provider_response_card_type','provider_response_card_last4','registration_id'
      )
    order by column_name
  `;
  assert.equal(ledgerColumns.length, 5, "수기결제 직접 승인 원장 컬럼이 모두 적용되지 않았습니다.");
  assert.equal(
    ledgerColumns.find((row) => row.columnName === "registration_id")?.isNullable,
    "YES",
    "수기결제 원장의 registration_id가 nullable이 아닙니다.",
  );

  const scenarios = await sql`
    select scenario,payment_input_mode,status,refund_status,count(*)::int as count
    from shorts_mvp.payment_test_package_orders
    group by scenario,payment_input_mode,status,refund_status
    order by scenario,payment_input_mode,status,refund_status
  `;
  const [legacyMismatch] = await sql`
    select count(*)::int as count
    from shorts_mvp.billing_orders
    where product_code='starter_3m'
      and amount_krw=70965
      and failure_code='PAYMENT_MISMATCH'
  `;
  const [activePackageRegistrations] = await sql`
    select (
      (
        select count(*)
        from shorts_mvp.payment_method_registrations
        where provider_credential_scope='package'
          and status in ('active','revoking','revoke_failed','unknown')
      )
      +
      (
        select count(*)
        from shorts_mvp.billing_card_verifications
        where provider_credential_scope='package'
          and status in ('active','pending','consuming','revoke_failed','unknown')
      )
    )::int as count
  `;
  const [packagePaymentMethods] = process.env.THEPAYONE_PACKAGE_TERMINAL_ID
    ? await sql`
        select count(*)::int as count
        from shorts_mvp.billing_payment_methods
        where provider='thepayone'
          and provider_terminal_id=${process.env.THEPAYONE_PACKAGE_TERMINAL_ID}
      `
    : [{ count: 0 }];
  const packageCapabilities = await sql`
    select installment_months,enabled
    from shorts_mvp.payment_provider_installment_capabilities
    where provider='thepayone' and credential_scope='package'
    order by installment_months
  `;
  const [refundedStarter] = await sql`
    select count(*)::int as count
    from shorts_mvp.billing_orders
    where product_code='starter_3m'
      and amount_krw=70965
      and status='succeeded'
      and refund_status='full'
      and installment_months=3
  `;

  const summary = {
    schemaReady: true,
    preservedLegacyPaymentMismatchOrders: legacyMismatch.count,
    packageTestScenarios: scenarios.map((row) => ({
      scenario: row.scenario,
      paymentInputMode: row.paymentInputMode,
      status: row.status,
      refundStatus: row.refundStatus,
      count: row.count,
    })),
    packageCapabilities: packageCapabilities.map((row) => ({
      installmentMonths: Number(row.installmentMonths),
      enabled: Boolean(row.enabled),
    })),
    refundedStarterThreeMonthOrders: refundedStarter.count,
    activeTemporaryPackageRegistrations: activePackageRegistrations.count,
    storedPackagePaymentMethods: packagePaymentMethods.count,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (requireComplete) {
    const completed = new Set(
      scenarios
        .filter((row) => (
          row.paymentInputMode === "manual_direct"
          && row.status === "succeeded"
          && row.refundStatus === "succeeded"
        ))
        .map((row) => row.scenario),
    );
    assert(completed.has("cash_1000"), "1,000원 일시불 승인·전액환불이 완료되지 않았습니다.");
    assert(
      completed.has("installment_50000_3m"),
      "50,000원 3개월 승인·전액환불이 완료되지 않았습니다.",
    );
    const [creditInstallment] = await sql`
      select count(*)::int as count
      from shorts_mvp.payment_test_package_orders
      where scenario='installment_50000_3m'
        and payment_input_mode='manual_direct'
        and status='succeeded' and refund_status='succeeded'
        and lower(
          regexp_replace(provider_response_card_type, '[[:space:]_-]+', '', 'g')
        ) in ('신용','신용카드','credit','creditcard')
    `;
    assert(
      creditInstallment.count > 0,
      "50,000원 3개월 검증 거래가 신용카드 응답으로 확인되지 않았습니다.",
    );
    assert(
      packageCapabilities.some(
        (row) => Number(row.installmentMonths) === 3 && row.enabled,
      ),
      "패키지 터미널 3개월 capability가 활성화되지 않았습니다.",
    );
    assert(refundedStarter.count > 0, "스타터 3개월 70,965원 할부·전액환불이 없습니다.");
    assert.equal(
      activePackageRegistrations.count,
      0,
      "활성 또는 확인이 필요한 패키지 테스트 cardId가 남아 있습니다.",
    );
    assert.equal(
      packagePaymentMethods.count,
      0,
      "패키지 수기결제 터미널로 저장된 결제수단이 남아 있습니다.",
    );
  }
} finally {
  await sql.end({ timeout: 3 });
}
