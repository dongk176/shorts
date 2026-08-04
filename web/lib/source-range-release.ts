import type { Sql, TransactionSql } from "postgres";

export const SOURCE_RANGE_FLAG_KEY = "source_range_selection";

export async function isSourceRangeReleaseEnabled(db: Sql | TransactionSql) {
  const rows = await db`
    select enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key=${SOURCE_RANGE_FLAG_KEY}
    limit 1
  `;
  return rows[0]?.enabled === true;
}

export async function lockSourceRangeReleaseEnabled(db: TransactionSql) {
  const rows = await db`
    select enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key=${SOURCE_RANGE_FLAG_KEY}
    for share
  `;
  return rows[0]?.enabled === true;
}
