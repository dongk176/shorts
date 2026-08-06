import type { BillingSummary } from "@/lib/contracts";
import { HttpError } from "@/lib/http";
import type { Sql, TransactionSql } from "postgres";

export type PaidProjectAction = "edit" | "download";

export const paidProjectActionMessages: Record<PaidProjectAction, string> = {
  edit: "편집은 유료 회원만 이용할 수 있습니다.",
  download: "다운로드는 유료 회원만 이용할 수 있습니다.",
};

export function billingSupportsPaidProjectActions(
  billing: Pick<BillingSummary, "activeProducts">,
) {
  return billing.activeProducts.length > 0;
}

export function assertPaidProjectActionAccess(
  billing: Pick<BillingSummary, "activeProducts">,
  action: PaidProjectAction,
) {
  if (!billingSupportsPaidProjectActions(billing)) {
    throw new HttpError(
      402,
      paidProjectActionMessages[action],
      "PAID_PROJECT_ACTION_REQUIRED",
    );
  }
}

type ProjectActionDb = Sql | TransactionSql;

export async function userSupportsProjectActions(
  db: ProjectActionDb,
  billing: Pick<BillingSummary, "activeProducts">,
  userId: string,
) {
  if (billingSupportsPaidProjectActions(billing)) return true;
  const rows = await db`
    select exists (
      select 1
      from shorts_mvp.managed_login_accounts
      where app_user_id=${userId}
        and is_active=true
    ) as allowed
  `;
  return Boolean(rows[0]?.allowed);
}

export async function assertProjectActionAccess(
  db: ProjectActionDb,
  billing: Pick<BillingSummary, "activeProducts">,
  userId: string,
  action: PaidProjectAction,
) {
  if (!await userSupportsProjectActions(db, billing, userId)) {
    throw new HttpError(
      402,
      paidProjectActionMessages[action],
      "PAID_PROJECT_ACTION_REQUIRED",
    );
  }
}
