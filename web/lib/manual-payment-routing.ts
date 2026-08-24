import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";
import {
  thePayOneAddonPaymentMode,
  thePayOnePackageBillingEnabled,
  thePayOnePackagePaymentMode,
  type ThePayOnePaymentMode,
} from "@/lib/thepayone";

export type ManualPaymentProductKind = "package" | "addon";
export type OneTimePaymentFlow = "legacy" | "manual_direct" | "disabled";

export const MANUAL_PAYMENT_FLAG_KEYS = {
  package: "package_manual_billing",
  addon: "addon_manual_billing",
} as const;

type BillingDb = Sql | TransactionSql;

export function oneTimePaymentMode(
  productKind: ManualPaymentProductKind,
): ThePayOnePaymentMode {
  return productKind === "package"
    ? thePayOnePackagePaymentMode()
    : thePayOneAddonPaymentMode();
}

export async function manualPaymentRuntimeEnabled(
  db: BillingDb,
  productKind: ManualPaymentProductKind,
) {
  const rows = await db`
    select enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key=${MANUAL_PAYMENT_FLAG_KEYS[productKind]}
    limit 1
  `;
  return Boolean(rows[0]?.enabled);
}

export async function resolveOneTimePaymentFlow(
  db: BillingDb,
  productKind: ManualPaymentProductKind,
): Promise<OneTimePaymentFlow> {
  const mode = oneTimePaymentMode(productKind);
  if (mode !== "manual") return mode;
  if (!thePayOnePackageBillingEnabled()) return "disabled";
  return await manualPaymentRuntimeEnabled(db, productKind)
    ? "manual_direct"
    : "disabled";
}

export async function assertManualPaymentAvailable(
  db: BillingDb,
  productKind: ManualPaymentProductKind,
) {
  const flow = await resolveOneTimePaymentFlow(db, productKind);
  if (flow === "manual_direct") return;
  const productLabel = productKind === "package" ? "패키지" : "추가시간";
  if (flow === "legacy") {
    throw new HttpError(
      409,
      `${productLabel} 수기결제가 아직 전환되지 않았습니다.`,
      "MANUAL_PAYMENT_NOT_SELECTED",
    );
  }
  throw new HttpError(
    503,
    `${productLabel} 수기결제가 현재 중지되어 있습니다.`,
    productKind === "package"
      ? "PACKAGE_MANUAL_BILLING_DISABLED"
      : "ADDON_MANUAL_BILLING_DISABLED",
  );
}
