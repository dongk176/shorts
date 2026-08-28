#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import postgres from "../web/node_modules/postgres/src/index.js";
import { requireProductionDatabaseUrl } from "./production-database-identity.mjs";

const checks = new Set([
  "admin_end_to_end",
  "render_parity",
  "upload_1gb",
  "upload_5gb",
  "source_cleanup",
  "usage_integrity",
  "runtime_identity",
  "no_proxy_environment",
  "no_stuck_sessions",
]);

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

const check = option("check");
const passedText = option("passed");
const evidenceOption = option("evidence");
const evidencePath = evidenceOption ? path.resolve(evidenceOption) : "";
const adminUserId = String(
  option("admin-user-id") || process.env.FILE_UPLOAD_VERIFIER_ADMIN_USER_ID || "",
).trim();

if (!checks.has(check)) throw new Error("검증 항목이 올바르지 않습니다.");
if (!new Set(["true", "false"]).has(passedText)) {
  throw new Error("--passed=true 또는 --passed=false가 필요합니다.");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
  adminUserId,
)) {
  throw new Error("검증을 기록할 정확한 어드민 사용자 ID가 필요합니다.");
}
if (!evidencePath || !fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
  throw new Error("검증 증거 JSON 파일이 필요합니다.");
}
const source = fs.readFileSync(evidencePath);
if (source.byteLength > 16_384) throw new Error("검증 증거가 너무 큽니다.");
const evidence = JSON.parse(source.toString("utf8"));
if (
  !evidence
  || typeof evidence !== "object"
  || Array.isArray(evidence)
  || typeof evidence.evidenceId !== "string"
  || !evidence.evidenceId.trim()
  || !/^[0-9a-f]{40}$/.test(String(evidence.sourceGitSha || ""))
  || !Number.isFinite(new Date(evidence.observedAt).getTime())
) {
  throw new Error("검증 증거에는 evidenceId, sourceGitSha, observedAt이 필요합니다.");
}

const databaseUrl = requireProductionDatabaseUrl();
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  idle_timeout: 5,
  connection: {
    application_name: "easycut-file-upload-release-check-recorder",
    statement_timeout: 15_000,
  },
  transform: postgres.camel,
});

try {
  const rows = await sql`
    select check_key,passed,verified_at
    from shorts_mvp.record_file_upload_release_check(
      ${check},${passedText === "true"},${sql.json(evidence)},${adminUserId}
    )
  `;
  if (rows.length !== 1) throw new Error("검증 결과가 저장되지 않았습니다.");
  process.stdout.write(JSON.stringify(rows[0]) + "\n");
} finally {
  await sql.end({ timeout: 5 });
}
