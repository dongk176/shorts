import "server-only";
import type { TransactionSql } from "postgres";
import { assertEnterpriseServiceAccess } from "./enterprise-access";
import { HttpError } from "./http";

export async function reserveRankingUsage(tx: TransactionSql, operationId: string, owner: string) {
  const access = await assertEnterpriseServiceAccess(tx, owner);
  try {
    await tx`select shorts_mvp.reserve_ranking_render_usage(${operationId},${owner},${access.accountType === "enterprise"})`;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P0001"
      && /부족|활성 구독|체험시간|서비스 기간/.test(error.message)) {
      throw new HttpError(402, "사용량이 부족합니다. 랭킹 쇼츠 1개당 3분이 필요해요.");
    }
    throw error;
  }
}
