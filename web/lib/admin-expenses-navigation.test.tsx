import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminShell } from "@/app/admin/easycutcutcutcutcutcut/admin-shell";
describe("expense menu visibility",()=>{
  it("shows the expense menu to finance users on existing admin tabs",()=>{
    const html=renderToStaticMarkup(<AdminShell activeTab="billing" expenseAccess><div>결제 내역</div></AdminShell>);
    expect(html).toContain("?tab=expenses");expect(html).toContain("?tab=refunds");expect(html).toContain("비즈니스 현황을 한눈에.");
  });
  it("hides the expense menu for ordinary admins and gives expenses its own summary",()=>{
    const ordinary=renderToStaticMarkup(<AdminShell activeTab="billing"><div>결제 내역</div></AdminShell>);
    expect(ordinary).not.toContain("?tab=expenses");expect(ordinary).toContain("?tab=refunds");
    const finance=renderToStaticMarkup(<AdminShell activeTab="expenses" expenseAccess><div>비용 요약</div></AdminShell>);
    expect(finance).toContain("비용 요약");expect(finance).not.toContain("비즈니스 현황을 한눈에.");
  });
});
