import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({getAuthenticatedUser:vi.fn()}));
vi.mock("@/lib/db",()=>({getDb:vi.fn()}));
vi.mock("@/lib/ranking-semantic-search",()=>({searchRankingShortVideos:vi.fn()}));
import {getAuthenticatedUser} from "@/lib/supabase/server";
import {getDb} from "@/lib/db";
import {searchRankingShortVideos} from "@/lib/ranking-semantic-search";
import {HttpError} from "@/lib/http";
import {POST} from "./route";
const admin={id:'admin',authUserId:'auth',email:'a@example.test',displayName:null};
function request(body:unknown={q:'웃긴 동물'},origin='https://www.easycut.co.kr'){
  return new Request('https://www.easycut.co.kr/api/ranking-shorts/discover',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(getDb).mockReturnValue(vi.fn().mockResolvedValue([admin]) as unknown as ReturnType<typeof getDb>);vi.stubEnv('RANKING_SHORTS_ENABLED','1');});
afterEach(()=>vi.unstubAllEnvs());
it.each([401,403])('rejects unauthenticated and invalid accounts before search or DB work (%i)',async status=>{
  vi.mocked(getAuthenticatedUser).mockRejectedValue(new HttpError(status,'denied'));
  const response=await POST(request());expect(response.status).toBe(status);expect(getDb).not.toHaveBeenCalled();expect(searchRankingShortVideos).not.toHaveBeenCalled();
});
it('preserves the ranking release gate and same-origin boundary',async()=>{
  vi.stubEnv('RANKING_SHORTS_ENABLED','0');expect((await POST(request())).status).toBe(404);expect(getAuthenticatedUser).not.toHaveBeenCalled();
  vi.stubEnv('RANKING_SHORTS_ENABLED','1');vi.mocked(getAuthenticatedUser).mockResolvedValue({id:"auth"} as Awaited<ReturnType<typeof getAuthenticatedUser>>);
  expect((await POST(request(undefined,'https://other.example'))).status).toBe(403);expect(searchRankingShortVideos).not.toHaveBeenCalled();
});
it.each([{q:'x'},{q:'aa',cursor:'invalid'},{q:'aa',language:'xx'},{q:'aa',unexpected:'payload'}])('rejects invalid input before embedding %j',async body=>{
  vi.mocked(getAuthenticatedUser).mockResolvedValue({id:"auth"} as Awaited<ReturnType<typeof getAuthenticatedUser>>);expect((await POST(request(body))).status).toBe(400);expect(searchRankingShortVideos).not.toHaveBeenCalled();
});
it('returns only authorized search results with private no-store caching',async()=>{
  vi.mocked(getAuthenticatedUser).mockResolvedValue({id:"auth"} as Awaited<ReturnType<typeof getAuthenticatedUser>>);vi.mocked(searchRankingShortVideos).mockResolvedValue({items:[],updatedAt:'now',searchMode:'related'});
  const response=await POST(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(await response.json()).toMatchObject({searchMode:'related'});
});
