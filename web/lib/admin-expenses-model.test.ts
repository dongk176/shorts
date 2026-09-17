import { describe, expect, it } from "vitest";
import { copyExpense, emptyExpense, expenseSchema, paidAmount, paymentStatus, summarizeExpenses, type Expense } from "./admin-expenses-model";
import { parseReceipt } from "./admin-expenses-store";
import { csvText } from "@/app/admin/easycutcutcutcutcutcut/expenses/export";
const expense = (): Expense => ({...emptyExpense("2026-08"),name:"8월 급여",vendor:"직원 A",category:"인건비",amount:3000000,version:1,updatedAt:"2026-09-01T00:00:00Z",deletedAt:null,payments:[{id:crypto.randomUUID(),date:"2026-09-01",amount:2700000,method:"계좌이체",note:"실수령액"}]});
describe("manual expense accounting",()=>{
  it("separates incurred cost, payments by date, partial balances and draft estimates",()=>{
    const item=expense();
    const draft={...expense(),id:crypto.randomUUID(),stage:"draft" as const,payments:[],amount:500000};
    expect(summarizeExpenses([item,draft],"2026-08")).toEqual({confirmed:3000000,paid:0,unpaid:300000,missing:1,draft:500000});
    expect(summarizeExpenses([item,draft],"2026-09")).toEqual({confirmed:0,paid:2700000,unpaid:0,missing:0,draft:0});
    expect(paymentStatus(item)).toBe("일부 지급");
    item.payments.push({...item.payments[0],id:crypto.randomUUID(),amount:300000,note:"공제액 납부"});
    expect(paidAmount(item)).toBe(3000000);expect(paymentStatus(item)).toBe("지급 완료");
    expect(summarizeExpenses([{...item,deletedAt:"2026-09-02"}],"2026-08").confirmed).toBe(0);
  });
  it("copies December to next year without payments, receipt data or server metadata",()=>{
    const original={...expense(),month:"2026-12",receipts:[{id:crypto.randomUUID(),name:"급여.pdf",type:"application/pdf" as const,size:10}]};
    const copy=copyExpense(original);
    expect(copy).toMatchObject({month:"2027-01",version:0,stage:"draft",payments:[],receipts:[],dueOn:""});
    expect(copy.id).not.toBe(original.id);expect(copy).not.toHaveProperty("deletedAt");expect(expenseSchema.safeParse(copy).success).toBe(true);
  });
  it("rejects invalid dates, overpayments, paid drafts, duplicates and incomplete currencies",()=>{
    const valid=copyExpense(expense());valid.stage="confirmed";
    for(const patch of [{month:"2026-13"},{amount:1.5},{dueOn:"2026-02-30"},{payments:[{...expense().payments[0],amount:3000001}]},{foreignCurrency:"USD",foreignAmount:""},{foreignAmount:"12.00"},{stage:"draft",payments:expense().payments}]) expect(expenseSchema.safeParse({...valid,...patch}).success).toBe(false);
    const payment=expense().payments[0];expect(expenseSchema.safeParse({...valid,payments:[payment,payment]}).success).toBe(false);
  });
  it("checks receipt signatures and sizes rather than trusting extensions",()=>{
    const data=Buffer.from("%PDF-1.4\nfixture\n%%EOF");
    const receipt={id:crypto.randomUUID(),name:"영수증.pdf",type:"application/pdf" as const,size:data.length,data:data.toString("base64")};
    expect(parseReceipt(receipt).body).toEqual(data);
    expect(()=>parseReceipt({...receipt,size:3})).toThrow();
    expect(()=>parseReceipt({...receipt,data:Buffer.from("<script>bad</script>").toString("base64")})).toThrow();
    expect(()=>parseReceipt({...receipt,name:"receipt.html"})).toThrow();
    expect(()=>parseReceipt({...receipt,data:"%%%"})).toThrow();
  });
  it("does not export user-entered spreadsheet formulas",()=>{
    const csv=csvText({name:"비용",headers:["항목"],rows:[["=HYPERLINK(\"https://example.com\")"],["\t+1"],[-200]]});
    expect(csv).toContain("'=HYPERLINK");expect(csv).toContain("'\t+1");expect(csv).toContain('"-200"');
  });
});
