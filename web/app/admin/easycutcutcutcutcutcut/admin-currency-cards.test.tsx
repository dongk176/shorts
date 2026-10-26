import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminSalesCard } from "./admin-sales-card";
import { AdminTrendCard } from "./admin-trend-card";
import { buildAdminTrend } from "@/lib/admin-trends";

describe("shared domestic and overseas administrator cards",()=>{
  it("retains domestic labels and won amounts by default",()=>{
    const html=renderToStaticMarkup(<AdminSalesCard period="all" grossSales={399} refundedSales={100} icon={null}/>);
    expect(html).toContain("누적 국내 매출");expect(html).toContain("399원");expect(html).not.toContain("USD");
  });
  it.each([["USD",399,"3.99"],["JPY",590,"590"]] as const)("formats %s using its native minor units",(currency,amount,formatted)=>{
    const html=renderToStaticMarkup(<AdminSalesCard period="all" currency={currency} grossSales={amount} refundedSales={0} icon={null}/>);
    expect(html).toContain("누적 해외 매출");expect(html).toContain(currency);expect(html).toContain(formatted);expect(html).not.toContain("원");
  });
  it("uses the existing period selection and chart controls with native currency labels",()=>{
    const data=buildAdminTrend("sales","7d","2026-10-27",[{date:"2026-10-27",value:399,orderCount:1}]);
    const html=renderToStaticMarkup(<AdminTrendCard initialData={data} currency="USD" endpoint="/api/admin/overseas/trends" heading="해외 매출 · USD"/>);
    expect(html).toContain("USD");expect(html).toContain("3.99");expect(html).toContain("6개월");expect(html).toContain("전체 보기");expect(html).not.toContain("원");
  });
});
