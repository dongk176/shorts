import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),load:vi.fn(),db:vi.fn()}));
vi.mock("@/lib/db",()=>({ensureReadDbReady:mocks.db}));
vi.mock("@/lib/admin",()=>({requireAdminUser:mocks.auth}));
vi.mock("@/lib/admin-billing-calendar-server",()=>({loadBillingCalendar:mocks.load}));
import { HttpError } from "@/lib/http";
import { GET } from "./route";
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({id:"admin"});});
describe("administrator monthly sales API",()=>{
  it.each([401,403])("requires administrator access before loading data (%i)",async status=>{
    mocks.auth.mockRejectedValue(new HttpError(status,"권한이 필요합니다."));
    const response=await GET(new Request("http://localhost/api/admin/billing/calendar?month=2026-11"));
    expect(response.status).toBe(status);expect(mocks.db).not.toHaveBeenCalled();expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each(["month=2026-13","month=invalid","month=2026-11&currency=EUR","month=2026-11&provider=unknown"])("rejects invalid filters: %s",async query=>{
    expect((await GET(new Request(`http://localhost/api/admin/billing/calendar?${query}`))).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("returns approved monthly totals with private no-store caching",async()=>{
    mocks.load.mockResolvedValue({month:"2026-11",currency:"KRW",days:[]});
    const response=await GET(new Request("http://localhost/api/admin/billing/calendar?month=2026-11&provider=toss&q=alex"));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({month:"2026-11",currency:"KRW",provider:"toss",query:"alex"}));
  });
  it("returns a failure instead of an empty month when the ledger is unavailable",async()=>{
    mocks.load.mockRejectedValue(new HttpError(503,"매출 조회 불가"));
    const response=await GET(new Request("http://localhost/api/admin/billing/calendar?month=2026-11"));
    expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).not.toHaveProperty("days");
  });
});
