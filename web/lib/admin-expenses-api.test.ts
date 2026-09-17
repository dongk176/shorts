import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HttpError } from "./http";
const mocks=vi.hoisted(()=>({admin:vi.fn(),list:vi.fn(),save:vi.fn(),detail:vi.fn(),receipt:vi.fn()}));
vi.mock("@/lib/admin-expenses-access",()=>({requireExpenseAdmin:mocks.admin}));
vi.mock("@/lib/admin-expenses-store",()=>({listExpenses:mocks.list,mutateExpense:mocks.save,expenseDetail:mocks.detail,loadExpenseReceipt:mocks.receipt}));
import { GET, POST } from "@/app/api/admin/expenses/route";
import { GET as detail, DELETE } from "@/app/api/admin/expenses/[id]/route";
import { GET as receipt } from "@/app/api/admin/expenses/[id]/receipts/[receiptId]/route";
import { emptyExpense } from "./admin-expenses-model";
const origin="http://localhost:3218";
function req(method="GET",body?:unknown,headers:Record<string,string>={}){return new NextRequest(`${origin}/api/admin/expenses?month=2026-09`,{method,headers:{origin,"Content-Type":"application/json",...headers},...(body?{body:JSON.stringify(body)}:{})});}
beforeEach(()=>{vi.clearAllMocks();mocks.admin.mockResolvedValue({id:crypto.randomUUID()});mocks.list.mockResolvedValue([]);});
describe("expense API boundaries",()=>{
  it.each([401,403])("denies every read/write/download without finance access (%s)",async status=>{
    mocks.admin.mockRejectedValue(new HttpError(status,"권한 없음"));
    const id=crypto.randomUUID();const params=Promise.resolve({id});
    const responses=await Promise.all([GET(req()),POST(req("POST",{})),detail(req(),{params}),DELETE(req("DELETE",{}),{params}),receipt(req(),{params:Promise.resolve({id,receiptId:crypto.randomUUID()})})]);
    for(const response of responses){expect(response.status).toBe(status);expect(response.headers.get("Cache-Control")).toContain("no-store");}
    expect(mocks.list).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();expect(mocks.detail).not.toHaveBeenCalled();expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("blocks cross-origin writes and malformed or oversized bodies before store mutations",async()=>{
    expect((await POST(req("POST",{},{origin:"https://other.example"}))).status).toBe(403);
    expect((await POST(req("POST",{},{"content-length":"4000000"}))).status).toBe(413);
    expect((await POST(req("POST",{expense:{amount:-3}}))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("uses validated manual data and an idempotency key",async()=>{
    const expense={...emptyExpense("2026-09"),name:"서버 비용",vendor:"업체",amount:10000};const requestId=crypto.randomUUID();
    mocks.save.mockResolvedValue({...expense,version:1});
    const response=await POST(req("POST",{requestId,expense}));
    expect(response.status).toBe(200);expect(mocks.save).toHaveBeenCalledWith(expect.anything(),requestId,expense,"save");
  });
  it("downloads receipts privately as attachments",async()=>{
    mocks.receipt.mockResolvedValue({name:"급여.pdf",type:"application/pdf",body:Buffer.from("%PDF-1.4")});
    const response=await receipt(req(),{params:Promise.resolve({id:crypto.randomUUID(),receiptId:crypto.randomUUID()})});
    expect(response.status).toBe(200);expect(response.headers.get("Content-Disposition")).toContain("attachment;");expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
