import postgres, { type Sql } from "postgres";

let client: Sql | null = null;

export function getDb(): Sql {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
    client = postgres(connectionString, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      transform: postgres.camel,
    });
  }
  return client;
}
