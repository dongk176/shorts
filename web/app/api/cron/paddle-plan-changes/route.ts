import { timingSafeEqual } from 'node:crypto';
import { paddleJson } from '@/lib/paddle/http';
import { paddleEnabled } from '@/lib/paddle/config';
import { reconcilePendingPaddleChanges } from '@/lib/paddle/changes';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request) {
 const expected=Buffer.from(`Bearer ${process.env.CRON_SECRET||''}`),actual=Buffer.from(request.headers.get('authorization')||'');
 if(!process.env.CRON_SECRET || expected.length!==actual.length || !timingSafeEqual(expected,actual)) return paddleJson({error:'Unauthorized'},401);
 if(!paddleEnabled()) return paddleJson({disabled:true});
 try {const result=await reconcilePendingPaddleChanges();return paddleJson(result,result.failures?500:200);}
 catch {return paddleJson({error:'Paddle change reconciliation failed'},500);}
}
