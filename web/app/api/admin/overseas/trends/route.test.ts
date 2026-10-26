import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db",()=>({ensureReadDbReady:vi.fn()}));
const mocks=vi.hoisted(()=>({auth:vi.fn(),trend:vi.fn()}));
vi.mock("@/lib/admin-overseas-auth",()=>({requireOverseasAdminUser:mocks.auth}));
vi.mock("@/lib/admin-overseas",()=>({loadAdminOverseasTrend:mocks.trend}));
import { HttpError } from "@/lib/http";
import { GET } from "./route";
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({id:"overseas"});});
describe("overseas-only graph API",()=>{
  it.each([401,403])("checks the overseas role before reading data (%i)",async(status)=>{
    mocks.auth.mockRejectedValue(new HttpError(status,"권한이 필요합니다."));
    const r=await GET(new Request("http://localhost/api/admin/overseas/trends?metric=sales&period=all&currency=USD"));
    expect(r.status).toBe(status);expect(r.headers.get("cache-control")).toBe("private, no-store");expect(mocks.trend).not.toHaveBeenCalled();
  });
  it.each(["7d","30d","6m","all"])("returns scoped native currency data for %s",async(period)=>{
    const data={metric:"sales",period,points:[{date:"2026-10-27",value:590}]};mocks.trend.mockResolvedValue(data);
    const r=await GET(new Request(`http://localhost/api/admin/overseas/trends?metric=sales&period=${period}&currency=JPY`));
    expect(r.status).toBe(200);expect(mocks.trend).toHaveBeenCalledWith("sales",period,"JPY");expect(await r.json()).toEqual(data);
  });
  it.each(["metric=sales&period=all&currency=KRW","metric=all&period=all","metric=sales&period=100y"])("rejects unsupported scope: %s",async(query)=>{
    expect((await GET(new Request(`http://localhost/api/admin/overseas/trends?${query}`))).status).toBe(400);expect(mocks.trend).not.toHaveBeenCalled();
  });
});
