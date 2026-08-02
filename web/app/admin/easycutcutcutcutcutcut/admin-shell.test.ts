import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(
  new URL("./admin-shell.tsx", import.meta.url),
  "utf8",
);

describe("administrator shell recovery", () => {
  it("restores the latest administrator navigation and overview", () => {
    expect(shellSource).toContain("Admin Console");
    expect(shellSource).toContain("비즈니스 현황을 한눈에.");
    expect(shellSource).toContain("최근 14일 매출");
    expect(shellSource).toContain("최근 14일 회원 수 추이");
    expect(pageSource).toContain("<AdminShell");
  });

  it("keeps the editor release controls in the recovered shell", () => {
    expect(shellSource).toContain('tab: "editor-releases"');
    expect(shellSource).toContain('label: "편집기 릴리스"');
    expect(pageSource).toContain('tab === "editor-releases"');
    expect(pageSource).toContain("<AdminEditorReleases");
  });

  it("repairs a stalled local database pool before admin authentication", () => {
    const healthCheck = pageSource.indexOf("await ensureLocalDbReady();");
    const authentication = pageSource.indexOf("admin = await requireAdminUser();");

    expect(healthCheck).toBeGreaterThan(-1);
    expect(authentication).toBeGreaterThan(healthCheck);
  });

  it("presents approved positive payment amounts as sales", () => {
    expect(pageSource).toContain(
      "coalesce(sum(amount_krw),0)::bigint as sales",
    );
    expect(pageSource).toContain("and amount_krw>0");
  });

  it("bounds the billing table and tolerates historical orders without a product code", () => {
    expect(pageSource).toContain('productCode: row.productCode || "unknown"');
    expect(pageSource).toContain("order by o.created_at desc\n      limit 500");
  });
});
