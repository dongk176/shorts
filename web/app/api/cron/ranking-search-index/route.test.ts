import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/db',()=>({getDb:vi.fn()}));vi.mock('@/lib/short-video-embeddings.mjs',()=>({indexShortVideoBatch:vi.fn()}));
import {indexShortVideoBatch} from '@/lib/short-video-embeddings.mjs';import {GET} from './route';
const request=(token='test-secret')=>new Request('https://www.easycut.co.kr/api/cron/ranking-search-index',{headers:{authorization:`Bearer ${token}`}});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CRON_SECRET','test-secret');vi.stubEnv('OPENAI_API_KEY','test');vi.stubEnv('RANKING_SEMANTIC_SEARCH_ENABLED','1');});
afterEach(()=>vi.unstubAllEnvs());
it('never indexes for an unauthenticated cron request',async()=>{expect((await GET(request('wrong'))).status).toBe(401);expect(indexShortVideoBatch).not.toHaveBeenCalled();});
it('stops when disabled or the AI key is missing',async()=>{
  vi.stubEnv('RANKING_SEMANTIC_SEARCH_ENABLED','0');expect(await (await GET(request())).json()).toEqual({skipped:true});
  vi.stubEnv('RANKING_SEMANTIC_SEARCH_ENABLED','1');vi.stubEnv('OPENAI_API_KEY','');await GET(request());expect(indexShortVideoBatch).not.toHaveBeenCalled();
});
it('bounds recurring work and stops early when all eligible metadata is indexed',async()=>{
  vi.mocked(indexShortVideoBatch).mockResolvedValueOnce({claimed:100,saved:100,tokens:5000}).mockResolvedValue({claimed:0,saved:0,tokens:0});
  expect(await (await GET(request())).json()).toEqual({saved:100,tokens:5000});expect(indexShortVideoBatch).toHaveBeenCalledTimes(2);
  vi.mocked(indexShortVideoBatch).mockClear().mockResolvedValue({claimed:128,saved:128,tokens:5000});await GET(request());expect(indexShortVideoBatch).toHaveBeenCalledTimes(8);
});
