import { AsyncLocalStorage } from "node:async_hooks";
import type { Sql } from "postgres";

// Opt-in read requests must never recycle the pool used by payment mutations.
export const readDbContext = new AsyncLocalStorage<{
  db: Sql;
  active: boolean;
}>();
