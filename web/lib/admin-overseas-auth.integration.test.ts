import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
vi.mock("server-only",()=>({}));
const identity = vi.hoisted(()=>({read:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({getAuthenticatedUser:identity.read}));
vi.mock("@/lib/db",()=>({getDb:()=>sql}));
import { requireOverseasAdminUser } from "./admin-overseas-auth";
import { requireAdminUser } from "./admin";

let pg:PGlite;
let reads=0;
const sql=async(strings:TemplateStringsArray,...values:unknown[])=>{
  reads++;
  const query=strings.reduce((text,part,index)=>text+(index?`$${index}`:"")+part,"");
  const {rows}=await pg.query<Record<string,unknown>>(query,values);
  return rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v])));
};
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
beforeAll(async()=>{
  pg=new PGlite();
  await pg.exec(`create schema shorts_mvp;create role anon;create role authenticated;create role service_role;
    create table shorts_mvp.app_users(id uuid primary key,auth_user_id uuid,email text,display_name text,is_admin boolean,withdrawn_at timestamptz);`);
  await pg.exec(readFileSync(new URL("../../supabase/migrations/20261026181035_overseas_admin_role.sql",import.meta.url),"utf8"));
});
afterAll(async()=>{await pg.close();});
beforeEach(async()=>{
  await pg.exec(`truncate shorts_mvp.admin_role_assignments,shorts_mvp.app_users;
    insert into shorts_mvp.app_users values('${uid(1)}','${uid(11)}','owner@example.test','Owner',true,null),
    ('${uid(2)}','${uid(12)}','operator@example.test','Overseas',false,null),
    ('${uid(3)}','${uid(13)}','regular@example.test','Regular',false,null);
    insert into shorts_mvp.admin_role_assignments(user_id,role,granted_by_user_id) values('${uid(2)}','overseas_admin','${uid(1)}');`);
  identity.read.mockReset();reads=0;
});
describe("separate overseas administrator role",()=>{
  it("requires authentication before any database lookup",async()=>{
    identity.read.mockResolvedValue(null);
    await expect(requireOverseasAdminUser()).rejects.toMatchObject({status:401});expect(reads).toBe(0);
  });
  it("allows only overseas data for the overseas operator",async()=>{
    identity.read.mockResolvedValue({id:uid(12)});
    await expect(requireOverseasAdminUser()).resolves.toMatchObject({id:uid(2)});
    await expect(requireAdminUser()).rejects.toMatchObject({status:403});
  });
  it("adds the overseas role without removing the existing full-admin permission",async()=>{
    identity.read.mockResolvedValue({id:uid(11)});
    await expect(requireOverseasAdminUser()).rejects.toMatchObject({status:403});
    await pg.exec(`insert into shorts_mvp.admin_role_assignments(user_id,role,granted_by_user_id) values('${uid(1)}','overseas_admin','${uid(1)}');`);
    await expect(requireOverseasAdminUser()).resolves.toMatchObject({id:uid(1)});
    await expect(requireAdminUser()).resolves.toMatchObject({id:uid(1)});
  });
  it("ignores user-editable metadata, email and spoofed role claims",async()=>{
    identity.read.mockResolvedValue({id:uid(13),email:"dmsthaalcls@gmail.com",user_metadata:{is_admin:true,role:"overseas_admin"},app_metadata:{role:"overseas_admin"}});
    await expect(requireOverseasAdminUser()).rejects.toMatchObject({status:403});
    await expect(requireAdminUser()).rejects.toMatchObject({status:403});
  });
  it("enforces revocation and withdrawal on the next request",async()=>{
    identity.read.mockResolvedValue({id:uid(12)});
    await pg.exec(`update shorts_mvp.app_users set withdrawn_at=now() where id='${uid(2)}';`);
    await expect(requireOverseasAdminUser()).rejects.toMatchObject({status:403});
    await pg.exec(`update shorts_mvp.app_users set withdrawn_at=null where id='${uid(2)}';delete from shorts_mvp.admin_role_assignments where user_id='${uid(2)}';`);
    await expect(requireOverseasAdminUser()).rejects.toMatchObject({status:403});
  });
  it("prevents anonymous and signed-in clients from reading or assigning roles",async()=>{
    const {rows}=await pg.query<{rls:boolean;anonymous:boolean;signedin:boolean;selfgrant:boolean}>(`select c.relrowsecurity as rls,
      has_table_privilege('anon',c.oid,'select') as anonymous,
      has_table_privilege('authenticated',c.oid,'select') as signedin,
      has_table_privilege('authenticated',c.oid,'insert') as selfgrant
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='shorts_mvp' and c.relname='admin_role_assignments'`);
    expect(rows[0]).toEqual({rls:true,anonymous:false,signedin:false,selfgrant:false});
  });
});
