import { beforeEach,describe,it,expect,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),ready:vi.fn(),load:vi.fn()}));
vi.mock('@/lib/admin',()=>({requireAdminUser:mocks.auth}));vi.mock('@/lib/db',()=>({ensureReadDbReady:mocks.ready}));vi.mock('@/lib/admin-meeting-server',()=>({loadMeeting:mocks.load}));
import { GET } from '@/app/api/admin/meeting-dashboard/route';
import { HttpError } from './http';
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({id:'admin'});mocks.load.mockResolvedValue({daily:[]});});
describe('meeting dashboard authorization',()=>{
 it('rejects unauthenticated requests before any database work',async()=>{mocks.auth.mockRejectedValue(new HttpError(401,'로그인 필요'));const r=await GET(new Request('https://example.test/api/admin/meeting-dashboard'));expect(r.status).toBe(401);expect(mocks.ready).not.toHaveBeenCalled();expect(mocks.load).not.toHaveBeenCalled();expect(r.headers.get('cache-control')).toContain('no-store');});
 it('rejects unrecognized filter input',async()=>{const r=await GET(new Request('https://example.test/api/admin/meeting-dashboard?period=999&locale=xx'));expect(r.status).toBe(400);expect(mocks.load).not.toHaveBeenCalled();});
 it('uses allowlisted filters and disables shared HTTP caching',async()=>{const r=await GET(new Request('https://example.test/api/admin/meeting-dashboard?period=90&locale=ja'));expect(r.status).toBe(200);expect(mocks.load).toHaveBeenCalledWith('90','ja');expect(r.headers.get('cache-control')).toBe('private, no-store');});
});
