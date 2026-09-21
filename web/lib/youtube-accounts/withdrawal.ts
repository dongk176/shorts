import "server-only";
import type { Sql, TransactionSql } from "postgres";
import type { RemovedConnections, YoutubeAccountStore } from "./store";
import type { YoutubeAccounts } from "./service";

export async function withYoutubeWithdrawal(
  db: Sql, userId: string,
  youtube: { store: YoutubeAccountStore; service: YoutubeAccounts } | undefined,
  withdraw: (tx: TransactionSql) => Promise<void>,
) {
  let removed: RemovedConnections | undefined;
  await db.begin(async tx => {
    if (youtube) removed = await youtube.store.removeForWithdrawal(tx, userId);
    await withdraw(tx);
  });
  // Never contact Google before commit: a failed withdrawal must roll back
  // local deletion and leave the grant intact. A remote failure cannot restore it.
  if (!youtube || !removed) return null;
  try { return (await youtube.service.revokeRemoved(userId, removed)).revocation; }
  catch { return "manual_required"; }
}
