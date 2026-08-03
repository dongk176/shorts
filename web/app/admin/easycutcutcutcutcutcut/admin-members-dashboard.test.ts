import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { usageMinutes } from "@/lib/admin-member-usage";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(
  new URL("./admin-members-dashboard.tsx", import.meta.url),
  "utf8",
);

describe("administrator member usage column", () => {
  it("formats current usage as whole minutes", () => {
    expect(usageMinutes(0)).toBe("0");
    expect(usageMinutes(59)).toBe("0");
    expect(usageMinutes(60)).toBe("1");
    expect(usageMinutes(72_000)).toBe("1,200");
  });

  it("uses the same current entitlement constraints as member usage", () => {
    expect(pageSource).toContain("from shorts_mvp.usage_grants grant_row");
    expect(pageSource).toContain("grant_row.status='active'");
    expect(pageSource).toContain(
      "active_subscription.current_period_end>clock_timestamp()",
    );
    expect(pageSource).toContain(
      "${ONBOARDING_WELCOME_PRODUCT_CODE}",
    );
    expect(pageSource).toContain(
      "${ADMIN_USAGE_GRANT_PRODUCT_CODE}",
    );
  });

  it("renders usage immediately after the member identity column", () => {
    const memberHeader = dashboardSource.indexOf('>회원</th>');
    const usageHeader = dashboardSource.indexOf('>사용량</th>');
    const joinedHeader = dashboardSource.indexOf('>가입 / 최근 로그인</th>');

    expect(memberHeader).toBeGreaterThan(-1);
    expect(usageHeader).toBeGreaterThan(memberHeader);
    expect(joinedHeader).toBeGreaterThan(usageHeader);
    expect(dashboardSource).toContain(
      "잔여 {usageMinutes(member.usageRemainingSeconds)}분",
    );
  });

  it("supports searching and selecting a member before granting custom usage", () => {
    expect(dashboardSource).toContain("사용량 추가");
    expect(dashboardSource).toContain("/api/admin/members/search");
    expect(dashboardSource).toContain("/api/admin/members/usage");
    expect(dashboardSource).toContain("selectUsageGrantMember(member)");
    expect(dashboardSource).toContain("usageGrantMinutes");
  });
});
