import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/db",()=>({getDb:vi.fn()}));
import { ipRecommendation } from "./admin-ip-routes";

describe("IP replacement advice",()=>{
  it("requires a long trend, a peer gap, and recent deterioration for replacement advice",()=>{
    expect(ipRecommendation(true,{1:[8,20],24:[15,40]},5,.8).recommendation).toBe("교체 검토");
    expect(ipRecommendation(true,{1:[8,20],24:[15,40]},5,.4).recommendation).toBe("관찰");
    expect(ipRecommendation(true,{1:[8,20],24:[3,5]},5,.9).recommendation).toBe("관찰");
    expect(ipRecommendation(true,{1:[20,20],24:[15,40]},0,.8).recommendation).toBe("관찰");
  });
  it("uses a sufficient daily sample when hourly traffic is low",()=>{
    expect(ipRecommendation(true,{1:[1,2],6:[4,12],24:[9,32]},1,.8).recommendation).toBe("교체 검토");
    expect(ipRecommendation(true,{1:[2,2],6:[9,12],24:[9,32]},0,.8).recommendation).toBe("관찰");
    expect(ipRecommendation(true,{1:[2,2],24:[30,32]},0,.8).recommendation).toBe("유지");
  });
  it("does not turn no traffic, unknown failures, or an excluded route into a bad IP",()=>{
    expect(ipRecommendation(true,{1:[0,0]},0,null).recommendation).toBe("표본 부족");
    expect(ipRecommendation(true,{1:null},null,null).recommendation).toBe("미확인");
    expect(ipRecommendation(false,{1:[0,20]},20,.9).recommendation).toBe("일시 제외");
  });
});
