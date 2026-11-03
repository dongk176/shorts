import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/session',()=>({requireAuthenticatedMvpSession:vi.fn()}));
vi.mock('@/lib/paypal/one-time',()=>({prepareOneTimeOrder:vi.fn(),confirmOneTimeOrder:vi.fn(),cancelOneTimeOrder:vi.fn()}));
import {requireAuthenticatedMvpSession} from '@/lib/session';
import {prepareOneTimeOrder,confirmOneTimeOrder} from '@/lib/paypal/one-time';
import {HttpError} from '@/lib/http';
import {POST,PATCH} from './route';
const req=(body:unknown,origin='https://www.easycut.co.kr')=>new Request('https://www.easycut.co.kr/api/paypal/orders',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
beforeEach(()=>vi.resetAllMocks());
it('requires explicit purchase consent before calling the provider',async()=>{
 expect((await POST(req({planCode:'pro_1m',locale:'en',consent:false}))).status).toBe(400);
 expect(prepareOneTimeOrder).not.toHaveBeenCalled();
});
it('blocks cross-origin payment requests',async()=>{
 expect((await POST(req({planCode:'pro_1m',locale:'en',consent:true},'https://other.example'))).status).toBe(403);
 expect(prepareOneTimeOrder).not.toHaveBeenCalled();
});
it('requires an authenticated owner for creation and confirmation',async()=>{
 vi.mocked(requireAuthenticatedMvpSession).mockRejectedValue(new HttpError(401,'Sign in'));
 expect((await POST(req({planCode:'pro_1m',locale:'ja',consent:true}))).status).toBe(401);
 expect((await PATCH(req({checkoutId:'00000000-0000-4000-8000-000000000001'}))).status).toBe(401);
 expect(prepareOneTimeOrder).not.toHaveBeenCalled();expect(confirmOneTimeOrder).not.toHaveBeenCalled();
});
