import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(
  new URL("./admin-shell.tsx", import.meta.url),
  "utf8",
);
const shellStyles = readFileSync(
  new URL("./admin-shell.module.css", import.meta.url),
  "utf8",
);

describe("administrator overview", () => {
  it("presents approved payment amounts as sales without subtracting refunds", () => {
    expect(pageSource).toContain(
      "coalesce(sum(amount_krw),0)::bigint as sales",
    );
    expect(pageSource).toContain("and amount_krw>0");
    expect(shellSource).toContain('label: "누적 매출"');
    expect(shellSource).toContain('label: "오늘 매출"');
    expect(shellSource).toContain("최근 14일 매출");
    expect(shellSource).not.toContain("순매출");
  });

  it("builds a fourteen-day member signup trend", () => {
    expect(pageSource).toContain("daily_members as (");
    expect(pageSource).toContain("from shorts_mvp.app_users");
    expect(pageSource).toContain(
      "'memberCount',coalesce(daily_members.member_count,0)",
    );
    expect(shellSource).toContain("최근 14일 회원 수 추이");
    expect(shellSource).toContain("일별 신규 회원");
  });

  it("keeps the subscription status card narrower than the trend cards", () => {
    expect(shellStyles).toContain("minmax(210px, 0.55fr)");
    expect(shellStyles).toContain(".subscriptionCard");
    expect(shellStyles).toContain("width: min(100%, 380px);");
  });

  it("uses readable date labels and exact-value hover targets", () => {
    expect(shellSource).toContain("className={styles.chartHoverLayer}");
    expect(shellSource).toContain("className={styles.chartTooltip}");
    expect(shellSource).toContain("tabIndex={0}");
    expect(shellSource).toContain("valueLabel: money(point.sales)");
    expect(shellSource).toContain(
      "valueLabel: `${point.memberCount.toLocaleString(\"ko-KR\")}명`",
    );
    expect(shellSource).toContain(
      '"--chart-tooltip-top": `${(point.y / height) * 100}%`',
    );
    expect(shellStyles).toMatch(
      /\.chartDateLabel\s*\{[\s\S]*?font-size:\s*12px;/,
    );
    expect(shellStyles).toContain(".chartHitColumn:hover .chartTooltip");
    expect(shellStyles).toContain("top: var(--chart-tooltip-top);");
    expect(shellStyles).toContain(
      "translate(-50%, calc(-100% - 12px))",
    );
  });
});
