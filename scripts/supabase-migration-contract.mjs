import {
  FIXED_PRODUCTION_DATABASE_FINGERPRINT,
  requireDatabaseUrlFingerprint,
  requireProductionDatabaseUrl,
} from "./production-database-identity.mjs";

export function parseMigrationArguments(argv = []) {
  let environment = null;
  const migrationFiles = [];
  for (const argument of argv) {
    if (argument === "--production" || argument === "--non-production") {
      const selected = argument === "--production" ? "production" : "non-production";
      if (environment && environment !== selected) {
        throw new Error("운영과 비운영 migration 모드를 동시에 선택할 수 없습니다.");
      }
      if (environment === selected) {
        throw new Error(`migration 모드가 중복됐습니다: ${argument}`);
      }
      environment = selected;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new Error(`알 수 없는 migration 옵션입니다: ${argument}`);
    }
    migrationFiles.push(argument);
  }
  if (!environment) {
    throw new Error(
      "migration 대상 환경을 --production 또는 --non-production으로 명시해야 합니다.",
    );
  }
  return { environment, migrationFiles };
}

export function requireMigrationDatabaseUrl(mode, environment = process.env) {
  const databaseUrl = String(environment.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL이 필요합니다.");
  }
  if (mode === "production") {
    return requireProductionDatabaseUrl(environment);
  }
  if (mode !== "non-production") {
    throw new Error("migration 환경 계약이 올바르지 않습니다.");
  }
  if (
    String(environment.DEPLOY_ENV || "").trim().toLowerCase() === "production"
  ) {
    throw new Error(
      "운영 신호가 있는 환경에서 --non-production migration을 실행할 수 없습니다.",
    );
  }
  const expected = String(
    environment.NON_PRODUCTION_DATABASE_FINGERPRINT || "",
  ).trim().toLowerCase();
  if (expected === FIXED_PRODUCTION_DATABASE_FINGERPRINT) {
    throw new Error("비운영 DB fingerprint가 운영 DB fingerprint와 같아 중단합니다.");
  }
  return requireDatabaseUrlFingerprint(
    databaseUrl,
    expected,
    "NON_PRODUCTION_DATABASE_FINGERPRINT",
  );
}
