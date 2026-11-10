import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),load:vi.fn(),db:vi.fn()}));
vi.mock("@/lib/db",()=>({ensureReadDbReady:mocks.db}));
vi.mock("@/lib/admin-overseas-auth",()=>({requireOverseasAdminUser:mocks.auth}));
vi.mock("@/lib/admin-overseas-billing",()=>({loadOverseasBilling:mocks.load}));
import { HttpError } from "@/lib/http";
import { GET } from "./route";
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({id:"overseas"});});
describe("overseas billing calendar API",()=>{
  it.each([401,403])("rejects unauthorized access before touching data (%i)",async status=>{
    mocks.auth.mockRejectedValue(new HttpError(status,"권한이 필요합니다."));
    const r=await GET(new Request("http://localhost/api/admin/overseas/billing?month=2026-11"));
    expect(r.status).toBe(status);expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.load).not.toHaveBeenCalled();expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(["currency=KRW","provider=toss","month=2026-13","day=2026-10-31","day=2026-11-31","page=0"])("rejects unsupported scope or dates: %s",async query=>{
    const params=new URLSearchParams("month=2026-11");new URLSearchParams(query).forEach((v,k)=>params.set(k,v));
    expect((await GET(new Request(`http://localhost/api/admin/overseas/billing?${params}`))).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("shows both foreign currencies by default",async()=>{
    mocks.load.mockResolvedValue({days:[],rows:[],total:0});
    const r=await GET(new Request("http://localhost/api/admin/overseas/billing?month=2026-11"));
    expect(r.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({currency:"all",provider:"all"}));
  });
  it("passes validated native currency/day filters and disables caching",async()=>{
    mocks.load.mockResolvedValue({days:[],rows:[],total:0});
    const r=await GET(new Request("http://localhost/api/admin/overseas/billing?month=2026-11&day=2026-11-10&currency=JPY&provider=paddle&page=2"));
    expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({month:"2026-11",day:"2026-11-10",currency:"JPY",provider:"paddle",page:2}));
  });
});
