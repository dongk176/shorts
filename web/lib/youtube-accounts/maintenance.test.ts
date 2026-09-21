import { beforeEach,afterEach,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("./runtime",()=>({accountConfig:vi.fn(),accountServices:vi.fn()}));
import { accountConfig,accountServices } from "./runtime";
import { maintenancePost } from "./maintenance";
const run=vi.fn();
const secret='test-maintenance-secret-with-32-characters';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('YOUTUBE_ACCOUNTS_MAINTENANCE_SECRET',secret);vi.mocked(accountServices).mockReturnValue({retention:{run}} as never);run.mockResolvedValue({checked:0});});
afterEach(()=>vi.unstubAllEnvs());
it.each(['','Bearer wrong','Bearer '+secret+'extra'])("denies invalid maintenance authorization without database work: %s",async authorization=>{
  const r=await maintenancePost(new Request('http://localhost:3001/api/youtube/accounts/maintenance',{method:'POST',headers:{authorization}}));
  expect(r.status).toBe(401);expect(accountServices).not.toHaveBeenCalled();
});
it("requires a configured strong secret even if an empty token matches",async()=>{
  vi.stubEnv('YOUTUBE_ACCOUNTS_MAINTENANCE_SECRET','');
  expect((await maintenancePost(new Request('http://localhost',{headers:{authorization:'Bearer '}}))).status).toBe(401);
});
it("retains the environment guard even with the correct token",async()=>{
  vi.mocked(accountConfig).mockImplementation(()=>{throw Error('production rejected');});
  expect((await maintenancePost(new Request('http://localhost',{headers:{authorization:'Bearer '+secret}}))).status).toBe(503);
  expect(run).not.toHaveBeenCalled();
});
it("runs with a correct token and forbids response caching",async()=>{
  const r=await maintenancePost(new Request('http://localhost',{headers:{authorization:'Bearer '+secret}}));
  expect(r.status).toBe(200);expect(await r.json()).toEqual({checked:0});expect(r.headers.get('Cache-Control')).toBe('private, no-store');
});
it("does not expose a database or provider exception",async()=>{
  run.mockRejectedValue(Error('sensitive-token'));const r=await maintenancePost(new Request('http://localhost',{headers:{authorization:'Bearer '+secret}}));
  expect(r.status).toBe(503);expect(await r.text()).not.toContain('sensitive-token');
});
