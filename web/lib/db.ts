import postgres, { type Sql } from "postgres";

const globalDb = globalThis as typeof globalThis & {
  __shortsMvpDbClient?: Sql;
  __shortsMvpDbHealthCheck?: Promise<void>;
};

let client: Sql | null = globalDb.__shortsMvpDbClient ?? null;
const LOCAL_DB_HEALTH_TIMEOUT_MS = 4_000;

class LocalDbHealthTimeoutError extends Error {
  constructor() {
    super("로컬 DB 연결 확인 시간이 초과되었습니다.");
    this.name = "LocalDbHealthTimeoutError";
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

async function runLocalDbHealthCheck(db: Sql) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db`select 1`,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new LocalDbHealthTimeoutError()),
          LOCAL_DB_HEALTH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function recycleLocalDbClient(expectedClient: Sql) {
  if (client === expectedClient) client = null;
  if (globalDb.__shortsMvpDbClient === expectedClient) {
    delete globalDb.__shortsMvpDbClient;
  }
  await expectedClient.end({ timeout: 1 }).catch(() => undefined);
}

/**
 * Next.js 개발 HMR 뒤 postgres.js 풀이 드물게 응답을 반환하지 않는 경우가
 * 있다. 읽기 API가 실제 조회를 시작하기 전에 무해한 쿼리로 풀을 확인하고,
 * 멈춘 풀만 교체한다. 결제 승인 같은 mutation에는 사용하지 않는다.
 */
export async function ensureLocalDbReady() {
  if (process.env.NODE_ENV === "production") return;
  if (globalDb.__shortsMvpDbHealthCheck) {
    return globalDb.__shortsMvpDbHealthCheck;
  }

  const healthCheck = (async () => {
    const currentClient = getDb();
    try {
      await runLocalDbHealthCheck(currentClient);
    } catch (error) {
      if (!(error instanceof LocalDbHealthTimeoutError)) throw error;
      await recycleLocalDbClient(currentClient);
      await runLocalDbHealthCheck(getDb());
    }
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
