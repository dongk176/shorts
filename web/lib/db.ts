import postgres, { type Sql } from "postgres";

const globalDb = globalThis as typeof globalThis & {
  __shortsMvpDbClient?: Sql;
};

let client: Sql | null = globalDb.__shortsMvpDbClient ?? null;

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
