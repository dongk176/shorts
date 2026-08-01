import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("administrator page local database health check", () => {
  it("repairs a stale development pool before administrator authentication", () => {
    expect(pageSource).toContain(
      'import { ensureLocalDbReady, getDb } from "@/lib/db";',
    );

    const healthCheck = pageSource.indexOf("await ensureLocalDbReady();");
    const administratorAuthentication = pageSource.indexOf(
      "admin = await requireAdminUser();",
    );

    expect(healthCheck).toBeGreaterThan(-1);
    expect(administratorAuthentication).toBeGreaterThan(healthCheck);
  });
});
