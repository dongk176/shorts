import { z } from 'zod';
import { paddlePlans } from '@/lib/paddle/catalog';
import { assertBillingMutationRequest } from '@/lib/billing-request';
import { requireAuthenticatedMvpSession } from '@/lib/session';
import { quotePaddleChange,confirmPaddleChange } from '@/lib/paddle/changes';
import { paddleJson,paddleError } from '@/lib/paddle/http';
import { HttpError } from '@/lib/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const schema=z.union([
 z.object({action:z.literal('preview'),planCode:z.enum(paddlePlans.map(p=>p.code))}).strict(),
 z.object({action:z.literal('confirm'),quoteId:z.string().uuid()}).strict(),
]);
export async function POST(request:Request) {
 try {
  assertBillingMutationRequest(request);
  const session=await requireAuthenticatedMvpSession();
  if(session.isEnterprise) throw new HttpError(409,'Managed account');
  const body=schema.parse(await request.json());
  const change=body.action==='preview' ? await quotePaddleChange(session.userId,body.planCode) : await confirmPaddleChange(session.userId,body.quoteId);
  return paddleJson({change});
 } catch(error) {return paddleError(error);}
}
