import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({query:vi.fn(),registry:vi.fn()}));
vi.mock("./ranking-proxy-registry",()=>({currentRankingProxyRegistry:state.registry}));
vi.mock("./db",()=>({getDb:()=>Object.assign(state.query,{json:(v:unknown)=>JSON.stringify(v)})}));
import {leaseRankingVercelRoute} from "./ranking-vercel-egress";
beforeEach(()=>{
 vi.clearAllMocks();
 state.registry.mockResolvedValue({registryVersion:"new-version",routes:[{id:"webshare-01",egress_class:"webshare_isp",proxy_url:"http://user:password@8.8.8.8:8000"}]});
 state.query.mockImplementation(async(strings:TemplateStringsArray)=>strings.join("?").includes("claim_route_beta")?[{routeId:"webshare-01"}]:[]);
});
it("uses shared admission and stores version diagnostics without credentials or IP",async()=>{
 expect(await leaseRankingVercelRoute("operation","task")).toContain("8.8.8.8");
 const claim=state.query.mock.calls.find(([s])=>s.join("").includes("claim_route_beta"));
 expect(claim).toBeDefined();
 const update=state.query.mock.calls.find(([s])=>s.join("").includes("jsonb_set"));
 expect(update).toBeDefined();
 const detail=update![1] as string;
 expect(detail).toContain("new-version");
 expect(detail).not.toMatch(/8\.8\.8\.8|password|user/);
});
it("does not bypass a busy shared route pool",async()=>{
 state.query.mockResolvedValue([]);
 expect(await leaseRankingVercelRoute("operation","task")).toBeNull();
 expect(state.query.mock.calls.some(([s])=>s.join("").includes("jsonb_set"))).toBe(false);
});
