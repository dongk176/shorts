import postgres, { type Sql } from "postgres";

const globalDb = globalThis as typeof globalThis & {
  __shortsMvpDbClient?: Sql;
  __shortsMvpDbHealthCheck?: Promise<void>;
  __shortsMvpDbHealthyUntil?: number;
};

let client: Sql | null = globalDb.__shortsMvpDbClient ?? null;
const DB_HEALTH_TIMEOUT_MS = 4_000;
const DB_HEALTH_TTL_MS = 15_000;

class DbHealthTimeoutError extends Error {
  constructor() {
    super("DB 연결 확인 시간이 초과되었습니다.");
    this.name = "DbHealthTimeoutError";
  }
}

export function getDb(): Sql {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
    client = postgres(connectionString, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 15,
      max_lifetime: 60 * 15,
      prepare: false,
      connection: {
        application_name: "shorts-maker-web",
        statement_timeout: 10_000,
        lock_timeout: 3_000,
        idle_in_transaction_session_timeout: 10_000,
      },
      transform: postgres.camel,
    });
    if (process.env.NODE_ENV !== "production") {
      globalDb.__shortsMvpDbClient = client;
    }
  }
  return client;
}

async function runDbHealthCheck(db: Sql) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db`select 1`,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new DbHealthTimeoutError()),
          DB_HEALTH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function recycleDbClient(expectedClient: Sql) {
  if (client === expectedClient) client = null;
  if (globalDb.__shortsMvpDbClient === expectedClient) {
    delete globalDb.__shortsMvpDbClient;
  }
  await expectedClient.end({ timeout: 1 }).catch(() => undefined);
}

async function ensureDbReady() {
  if ((globalDb.__shortsMvpDbHealthyUntil ?? 0) > Date.now()) return;
  if (globalDb.__shortsMvpDbHealthCheck) {
    return globalDb.__shortsMvpDbHealthCheck;
  }

  const healthCheck = (async () => {
    const currentClient = getDb();
    try {
      await runDbHealthCheck(currentClient);
    } catch (error) {
      if (!(error instanceof DbHealthTimeoutError)) throw error;
      await recycleDbClient(currentClient);
      await runDbHealthCheck(getDb());
    }
    globalDb.__shortsMvpDbHealthyUntil = Date.now() + DB_HEALTH_TTL_MS;
  })();
  globalDb.__shortsMvpDbHealthCheck = healthCheck;
  try {
    await healthCheck;
  } finally {
    if (globalDb.__shortsMvpDbHealthCheck === healthCheck) {
      delete globalDb.__shortsMvpDbHealthCheck;
    }
  }
}

/**
 * The administrator page performs several read-only queries during its first
 * render. Serverless instances can occasionally resume with a stale postgres
 * pool; unlike a running query, waiting for a free pool slot has no PostgreSQL
 * statement timeout. Probe and recycle only the administrator function's pool
 * before starting those reads so the page never waits for Vercel's 300-second
 * runtime timeout.
 */
export async function ensureAdminDbReady() {
  return ensureDbReady();
}

/**
 * Bounds the stale-pool check for read-only request paths. Mutations deliberately
 * do not use an automatic retry because a write may already have reached the DB.
 */
export async function ensureReadDbReady() {
  return ensureDbReady();
}

/**
 * Next.js development HMR can leave a local postgres.js pool unresponsive.
 * Production call sites keep their previous no-op behavior; the administrator
 * page opts into the bounded production check through ensureAdminDbReady().
 */
export async function ensureLocalDbReady() {
  if (process.env.NODE_ENV === "production") return;
  return ensureDbReady();
}
