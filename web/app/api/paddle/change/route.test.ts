import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('@/lib/session',()=>({requireAuthenticatedMvpSession:vi.fn()}));
vi.mock('@/lib/paddle/changes',()=>({quotePaddleChange:vi.fn(),confirmPaddleChange:vi.fn()}));
import {requireAuthenticatedMvpSession} from '@/lib/session';
import {quotePaddleChange,confirmPaddleChange} from '@/lib/paddle/changes';
import {HttpError} from '@/lib/http';
import {POST} from './route';
const request=(body:unknown,origin='https://www.easycut.co.kr')=>new Request('https://www.easycut.co.kr/api/paddle/change',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(requireAuthenticatedMvpSession).mockResolvedValue({userId:'owner'} as Awaited<ReturnType<typeof requireAuthenticatedMvpSession>>)});
it('requires authentication and same-origin JSON before preview or mutation',async()=>{
 expect((await POST(request({action:'preview',planCode:'paddle_lite'},'https://evil.test'))).status).toBe(403);
 vi.mocked(requireAuthenticatedMvpSession).mockRejectedValue(new HttpError(401,'Login required'));
 expect((await POST(request({action:'preview',planCode:'paddle_lite'}))).status).toBe(401);
 expect(quotePaddleChange).not.toHaveBeenCalled();expect(confirmPaddleChange).not.toHaveBeenCalled();
});
it('takes ownership from the session and rejects price or owner tampering',async()=>{
 expect((await POST(request({action:'preview',planCode:'paddle_pro_6m'}))).status).toBe(200);
 expect(quotePaddleChange).toHaveBeenCalledWith('owner','paddle_pro_6m');
 const id='00000000-0000-4000-8000-000000000003';
 expect((await POST(request({action:'confirm',quoteId:id,userId:'other',amountMinor:1}))).status).toBe(400);
 expect(confirmPaddleChange).not.toHaveBeenCalled();
 const response=await POST(request({action:'confirm',quoteId:id}));
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(confirmPaddleChange).toHaveBeenCalledWith('owner',id);
});
