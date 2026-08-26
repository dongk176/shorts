import crypto from "node:crypto";

export const FIXED_PRODUCTION_DATABASE_FINGERPRINT =
  "sha256:be47955061a9c7b2204ea3bd2e950c7dae6d31f6a484f1780c6b69630744f20a";

export function productionDatabaseFingerprint(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(String(databaseUrl || "").trim());
  } catch {
    throw new Error("DATABASE_URL 형식이 올바르지 않습니다.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("DATABASE_URL은 PostgreSQL URL이어야 합니다.");
  }
  const username = decodeURIComponent(parsed.username || "");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!username || !parsed.hostname || !database) {
    throw new Error("DATABASE_URL에서 운영 DB identity를 확인할 수 없습니다.");
  }
  const identity = JSON.stringify({
    protocol: "postgresql:",
    username,
    hostname: parsed.hostname.toLowerCase().replace(/\.$/, ""),
    port: parsed.port || "5432",
    database,
  });
  return `sha256:${crypto.createHash("sha256").update(identity).digest("hex")}`;
}

export function requireDatabaseUrlFingerprint(databaseUrl, expectedValue, label) {
  const expected = String(expectedValue || "").trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(expected)) {
    throw new Error(`${label}가 필요합니다. DB identity 검증을 생략할 수 없습니다.`);
  }
  const actual = productionDatabaseFingerprint(databaseUrl);
  if (!crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    throw new Error(`DATABASE_URL이 고정된 ${label}와 다릅니다.`);
  }
  return String(databaseUrl).trim();
}

export function requireProductionDatabaseUrl(environment = process.env) {
  const databaseUrl = String(environment.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL이 필요합니다. 운영 DB 검증을 생략할 수 없습니다.");
  }
  const acknowledged = String(
    environment.PRODUCTION_DATABASE_FINGERPRINT || "",
  ).trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(acknowledged)) {
    throw new Error(
      "PRODUCTION_DATABASE_FINGERPRINT가 필요합니다. 운영 DB identity 검증을 생략할 수 없습니다.",
    );
  }
  if (!crypto.timingSafeEqual(
    Buffer.from(acknowledged),
    Buffer.from(FIXED_PRODUCTION_DATABASE_FINGERPRINT),
  )) {
    throw new Error("PRODUCTION_DATABASE_FINGERPRINT가 코드에 고정된 운영 DB identity와 다릅니다.");
  }
  return requireDatabaseUrlFingerprint(
    databaseUrl,
    FIXED_PRODUCTION_DATABASE_FINGERPRINT,
    "운영 DB fingerprint",
  );
}
