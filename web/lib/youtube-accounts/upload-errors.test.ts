import { describe, expect, it } from "vitest";
import { Google } from "./upload-engine.mjs";
import { providerFailure, uploadDiagnostic, uploadMessages } from "./upload-errors.mjs";
import { youtubeMessage } from "./i18n";
const secret = 'secret-token https://www.googleapis.com/upload/youtube/private-session';
const job = () => ({size:100,channelId:'channel',metadata:{status:{privacyStatus:'private' as const}},status:'queued',sourceKey:'outputs/test.mp4',sourceHash:'test'});
describe('upload diagnostic boundary',()=>{
 it.each([[400,'uploadLimitExceeded','channel_limit'],[403,'quotaExceeded','quota'],[403,'dailyLimitExceeded','quota'],[429,'rateLimitExceeded','rate'],[401,'unauthorized','auth'],[400,'invalid_grant','auth'],[403,'insufficientPermissions','permission'],[503,'unrecognized','provider'],[400,'unrecognized','rejected']] as const)('classifies HTTP %s %s without provider text',async(status,reason,code)=>{
  const diagnostic=uploadDiagnostic(await providerFailure(Response.json({error:{message:secret,errors:[{reason}]}},{status}),'session'),'unknown');
  expect(diagnostic).toMatchObject({code,stage:'session',status});
  expect(JSON.stringify(diagnostic)).not.toContain(secret);
 });
 it('recognizes OAuth errors and ignores malformed bodies',async()=>{
  expect(uploadDiagnostic(await providerFailure(Response.json({error:'invalid_grant',error_description:secret},{status:400}),'token'),'source')).toMatchObject({code:'auth',reason:'invalid_grant',stage:'token'});
  expect(uploadDiagnostic(await providerFailure(new Response(secret,{status:502}),'session'),'source')).toMatchObject({code:'provider',reason:null});
  expect(JSON.stringify(uploadDiagnostic(Error(secret),'source'))).not.toContain(secret);
 });
 it.each(['TimeoutError','TypeError'])('classifies %s without error text',async name=>{
  const engine=new Google({client_id:'fake',client_secret:'fake'},async()=>{const error=Error(secret);error.name=name;throw error;});
  try {await engine.upload(job(),{refreshToken:'fake'},async()=>{},'/unused');throw Error('expected failure');}
  catch(error){const diagnostic=uploadDiagnostic(error,engine.stage||'unknown');expect(diagnostic).toMatchObject({stage:'token',code:name==='TimeoutError'?'timeout':'network'});expect(JSON.stringify(diagnostic)).not.toContain(secret);}
 });
 it('preserves provider stage and does not retry ambiguous session starts',async()=>{
  let starts=0;
  const engine=new Google({client_id:'fake',client_secret:'fake'},async url=>{
   if(String(url).includes('/token'))return Response.json({access_token:'fake'});
   if(String(url).includes('/channels?'))return Response.json({items:[{id:'channel',snippet:{title:'fake'}}]});
   starts++;return Response.json({error:{errors:[{reason:'uploadLimitExceeded'}],message:secret}},{status:400});
  });
  const state=job();
  await expect(engine.upload(state,{refreshToken:'fake'},async()=>{},'/unused')).rejects.toMatchObject({code:'channel_limit',stage:'session',reason:'uploadLimitExceeded'});
  await expect(engine.upload(state,{refreshToken:'fake'},async()=>{},'/unused')).rejects.toMatchObject({code:'uncertain',stage:'resume_guard'});
  expect(starts).toBe(1);
 });
 it('shows every diagnostic in all supported languages rather than generic fallback',()=>{
  for(const message of Object.values(uploadMessages))for(const locale of ['ko','en','ja'] as const) expect(youtubeMessage(message,locale)).not.toBe(youtubeMessage('unknown-provider-detail',locale));
 });
});
