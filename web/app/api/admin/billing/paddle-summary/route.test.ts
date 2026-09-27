import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({admin:vi.fn(),ready:vi.fn(),sales:vi.fn()}));
vi.mock("@/lib/admin",()=>({requireAdminUser:m.admin}));
vi.mock("@/lib/db",()=>({ensureReadDbReady:m.ready}));
vi.mock("@/lib/admin-paddle",()=>({loadAdminPaddleSales:m.sales}));
import { GET } from "./route";
import { HttpError } from "@/lib/http";
beforeEach(()=>{vi.clearAllMocks();m.ready.mockResolvedValue(undefined);m.admin.mockResolvedValue({id:"admin"});m.sales.mockResolvedValue([]);});
describe("Paddle admin summary access",()=>{
 it("rejects a non-admin before reading payments",async()=>{m.admin.mockRejectedValue(new HttpError(403,"Forbidden"));expect((await GET()).status).toBe(403);expect(m.sales).not.toHaveBeenCalled();});
 it("returns private uncached totals for admins",async()=>{const r=await GET();expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toContain("private, no-store");expect(await r.json()).toEqual({totals:[]});});
 it("returns an error rather than zero sales on failure",async()=>{m.sales.mockRejectedValue(new Error("offline"));expect((await GET()).status).toBeGreaterThanOrEqual(400);});
});
