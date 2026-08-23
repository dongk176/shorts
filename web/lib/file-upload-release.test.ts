import type { Sql, TransactionSql } from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getFileUploadReleaseAccess,
  lockFileUploadReleaseAccess,
  resolveFileUploadReleaseAccess,
} from "@/lib/file-upload-release";

afterEach(() => vi.unstubAllEnvs());

function dbWithRows(...responses: unknown[][]) {
  let index = 0;
  return vi.fn(async (...args: unknown[]) => {
    void args;
    return responses[index++] || [];
  });
}

describe("file upload release access", () => {
  it("keeps the control plane inert when the deployment switch is off", async () => {
    vi.stubEnv("FILE_UPLOAD_ENABLED", "false");
    const db = dbWithRows();

    const access = await getFileUploadReleaseAccess(db as unknown as Sql, "user-a");

    expect(access.enabled).toBe(false);
    expect(access.adminEnabled).toBe(false);
    expect(db).not.toHaveBeenCalled();
  });

  it("requires both the feature flag and administrator role for the admin canary", () => {
    expect(resolveFileUploadReleaseAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: true,
    }).adminEnabled).toBe(true);
    expect(resolveFileUploadReleaseAccess({
      masterEnabled: true,
      featureEnabled: false,
      publicEnabled: false,
      isAdmin: true,
    }).adminEnabled).toBe(false);
    expect(resolveFileUploadReleaseAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: false,
    }).adminEnabled).toBe(false);
  });

  it("does not let the future public flag bypass the admin control-plane gate", () => {
    const access = resolveFileUploadReleaseAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: true,
      isAdmin: false,
    });

    expect(access.enabled).toBe(true);
    expect(access.adminEnabled).toBe(false);
  });

  it("fails closed when either runtime row is absent", async () => {
    vi.stubEnv("FILE_UPLOAD_ENABLED", "true");
    const db = dbWithRows(
      [{ flagKey: "file_upload_public", enabled: false }],
      [{ isAdmin: true }],
    );

    await expect(
      getFileUploadReleaseAccess(db as unknown as Sql, "user-a"),
    ).resolves.toMatchObject({
      enabled: false,
      adminEnabled: false,
    });
  });

  it("locks both flags and the administrator row before a mutation", async () => {
    vi.stubEnv("FILE_UPLOAD_ENABLED", "true");
    const db = dbWithRows(
      [
        { flagKey: "file_upload", enabled: true },
        { flagKey: "file_upload_public", enabled: false },
      ],
      [{ isAdmin: true }],
    );

    await expect(
      lockFileUploadReleaseAccess(db as unknown as TransactionSql, "user-a"),
    ).resolves.toMatchObject({ adminEnabled: true });
    const sql = db.mock.calls
      .map(([strings]) => Array.from(strings as TemplateStringsArray).join(""))
      .join("\n");
    expect(sql.match(/for share/g)).toHaveLength(2);
  });
});
