import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { NextRequest } from "next/server";
const state=vi.hoisted(()=>({db:null as unknown,user:{id:"11111111-1111-4111-8111-111111111111",authUserId:"11111111-1111-4111-8111-111111111111",email:"dmsthaalcls@gmail.com",displayName:"테스트 운영자"}}));
vi.mock("@/lib/db",()=>({getDb:()=>state.db}));
vi.mock("@/lib/admin",()=>({requireAdminUser:async()=>state.user}));
import { listExpenses, mutateExpense, expenseDetail, loadExpenseReceipt } from "./admin-expenses-store";
import { requireExpenseAdmin } from "./admin-expenses-access";
import { emptyExpense, expenseInput, summarizeExpenses } from "./admin-expenses-model";
import { POST } from "@/app/api/admin/expenses/route";
const databaseUrl=process.env.ADMIN_EXPENSES_TEST_DATABASE_URL;
const owner={...state.user};
const regularId="22222222-2222-4222-8222-222222222222";
describe.skipIf(!databaseUrl)("expense ledger against isolated PostgreSQL",()=>{
  let db:ReturnType<typeof postgres>;
  beforeAll(async()=>{
    const url=new URL(databaseUrl!);
    if(!["127.0.0.1","localhost"].includes(url.hostname)||url.pathname!=="/easycut_expenses_test")throw new Error("Only the dedicated loopback test database is permitted");
    db=postgres(databaseUrl!,{transform:postgres.camel,max:4,prepare:false});state.db=db;
    await db.unsafe(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$; create schema if not exists shorts_mvp; create table if not exists shorts_mvp.app_users(id uuid primary key,auth_user_id uuid,email text,display_name text,is_admin boolean);`);
    await db`insert into shorts_mvp.app_users values(${owner.id},${owner.id},${owner.email},${owner.displayName},true),(${regularId},${regularId},'regular@example.test','일반 관리자',true) on conflict(id) do nothing`;
    const existing=await db`select to_regclass('shorts_mvp.admin_expenses') as relation`;
    if(!existing[0].relation)await db.begin(tx=>tx.unsafe(readFileSync(new URL("../../supabase/migrations/202609170010_admin_expenses.sql",import.meta.url),"utf8").replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, "")));
    await db`truncate shorts_mvp.admin_expense_changes,shorts_mvp.admin_expense_receipts,shorts_mvp.admin_expenses`;
  });
  afterAll(async()=>{state.user=owner;await db?.end();});
  it("persists payments/receipts, replays requests, rejects conflicts, and retains deletion history",async()=>{
    const receiptBody=Buffer.from("%PDF-1.4\nlocal-test-only\n%%EOF");
    const receipt={id:crypto.randomUUID(),name:"급여명세.pdf",type:"application/pdf" as const,size:receiptBody.length,data:receiptBody.toString("base64")};
    const input={...emptyExpense("2026-08"),name:"8월 테스트 급여",vendor:"가상 직원",category:"인건비" as const,amount:3000000,payments:[{id:crypto.randomUUID(),date:"2026-09-01",amount:2700000,method:"계좌이체" as const,note:"실수령액"}],receipts:[receipt]};
    const requestId=crypto.randomUUID();
    const [a,b]=await Promise.all([mutateExpense(owner,requestId,input,"save"),mutateExpense(owner,requestId,input,"save")]);
    expect(a).toEqual(b);expect(a.version).toBe(1);expect(a.receipts[0]).not.toHaveProperty("data");
    expect((await expenseDetail(a.id)).history).toHaveLength(1);
    expect((await loadExpenseReceipt(a.id,receipt.id)).body).toEqual(receiptBody);
    expect(summarizeExpenses(await listExpenses("2026-08"),"2026-08")).toMatchObject({confirmed:3000000,unpaid:300000,paid:0});
    expect(summarizeExpenses(await listExpenses("2026-09"),"2026-09").paid).toBe(2700000);
    await expect(mutateExpense(owner,requestId,{...input,amount:4000000},"save")).rejects.toMatchObject({status:409});
    const update={...expenseInput(a),payments:[...a.payments,{...a.payments[0],id:crypto.randomUUID(),amount:300000,note:"공제액 납부"}]};
    const results=await Promise.allSettled([mutateExpense(owner,crypto.randomUUID(),update,"save"),mutateExpense(owner,crypto.randomUUID(),{...update,note:"동시 수정"},"save")]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    const latest=(await expenseDetail(a.id)).expense;expect(latest.version).toBe(2);
    await expect(mutateExpense(owner,crypto.randomUUID(),{...emptyExpense("2026-08"),name:"다른 비용",vendor:"타 업체",amount:100,receipts:[a.receipts[0]]},"save")).rejects.toMatchObject({status:400});
    const removed=await mutateExpense(owner,crypto.randomUUID(),{id:a.id,version:latest.version},"delete");expect(removed.deletedAt).toBeTruthy();
    expect((await expenseDetail(a.id)).history).toHaveLength(3);
    expect(summarizeExpenses(await listExpenses("2026-08"),"2026-08").confirmed).toBe(0);
    await expect(mutateExpense(owner,crypto.randomUUID(),{...expenseInput(latest),version:removed.version},"save")).rejects.toMatchObject({status:409});
  });
  it("rolls back the whole change when a receipt insert fails",async()=>{
    const body=Buffer.from("%PDF-1.4\nfixture\n%%EOF");
    const receipt={id:crypto.randomUUID(),name:"파일.pdf",type:"application/pdf" as const,size:body.length,data:body.toString("base64")};
    const original=await mutateExpense(owner,crypto.randomUUID(),{...emptyExpense("2026-08"),name:"첫 비용",vendor:"업체",amount:100,receipts:[receipt]},"save");
    const duplicate=emptyExpense("2026-08");
    await expect(mutateExpense(owner,crypto.randomUUID(),{...duplicate,name:"중복 파일",vendor:"업체",amount:200,receipts:[receipt]},"save")).rejects.toMatchObject({code:"23505"});
    await expect(expenseDetail(duplicate.id)).rejects.toMatchObject({status:404});
    expect((await expenseDetail(original.id)).expense.amount).toBe(100);
    await mutateExpense(owner,crypto.randomUUID(),{...expenseInput(original),receipts:[]},"save");
    expect((await loadExpenseReceipt(original.id,receipt.id)).body).toEqual(body);
    expect((await expenseDetail(original.id)).history[1].after.receipts[0].name).toBe("파일.pdf");
  });
  it("requires separate finance access and blocks anonymous/authenticated direct database access",async()=>{
    expect(await requireExpenseAdmin()).toMatchObject({id:owner.id});
    state.user={...owner,id:regularId};
    await expect(requireExpenseAdmin()).rejects.toMatchObject({status:403});
    const response=await POST(new NextRequest("http://localhost/api/admin/expenses",{method:"POST",headers:{origin:"http://localhost","Content-Type":"application/json"},body:"{}"}));
    expect(response.status).toBe(403);state.user=owner;
    await db`update shorts_mvp.app_users set is_admin=false where id=${owner.id}`;
    await expect(mutateExpense(owner,crypto.randomUUID(),{...emptyExpense("2026-08"),name:"권한 철회",vendor:"업체",amount:100},"save")).rejects.toMatchObject({status:403});
    await db`update shorts_mvp.app_users set is_admin=true where id=${owner.id}`;
    for(const table of ["admin_expenses","admin_expense_access","admin_expense_receipts","admin_expense_changes"]){
      const privileges=await db`select has_table_privilege('anon',${`shorts_mvp.${table}`},'select') as anon,has_table_privilege('authenticated',${`shorts_mvp.${table}`},'select') as authenticated`;
      expect(privileges[0]).toEqual({anon:false,authenticated:false});
    }
  });
});
