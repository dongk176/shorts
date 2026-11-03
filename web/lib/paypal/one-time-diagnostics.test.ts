import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));vi.mock('@/lib/db',()=>({getDb:vi.fn()}));
vi.mock('./api',()=>({paypalEnvironment:()=> 'live',paypalRequest:vi.fn()}));vi.mock('./one-time-config',()=>({oneTimeReturnOrigin:()=> 'https://www.easycut.co.kr'}));
import {paypalRequest} from './api';import {configureOneTimeWebhook,oneTimeWebhookEvents} from './one-time-diagnostics';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('PAYPAL_WEBHOOK_ID','WEBHOOK123456');});
it('preserves old recurring notifications while adding one-time notifications',async()=>{
 let events=[{name:'BILLING.SUBSCRIPTION.CANCELLED'}];vi.mocked(paypalRequest).mockImplementation(async(_path,body)=>{
 if(body)events=(body as {value:{name:string}[]}[])[0].value;
 return {id:'WEBHOOK123456',url:'https://www.easycut.co.kr/api/paypal/webhook',event_types:events} as never;
 });
 expect((await configureOneTimeWebhook()).verified).toBe(true);
 expect(events.map(e=>e.name)).toEqual(expect.arrayContaining(['BILLING.SUBSCRIPTION.CANCELLED',...oneTimeWebhookEvents]));
});
it('refuses to change a webhook whose existing recipient differs',async()=>{
 vi.mocked(paypalRequest).mockResolvedValue({id:'WEBHOOK123456',url:'https://other.example/webhook',event_types:[]});
 await expect(configureOneTimeWebhook()).rejects.toThrow('destination mismatch');
 expect(paypalRequest).toHaveBeenCalledTimes(1);
});
