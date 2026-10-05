import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { connect } from "node:http2";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { apnsConfigured, nativeDeviceSchema } from "@/lib/admin-native-contract";
import type { PushPayload } from "@/lib/admin-mobile-push";

export function apnsJwt(keyId: string, teamId: string, pem: string, now = Date.now()) {
  const head = Buffer.from(JSON.stringify({alg:"ES256",kid:keyId})).toString("base64url");
  const body = Buffer.from(JSON.stringify({iss:teamId,iat:Math.floor(now/1000)})).toString("base64url");
  const unsigned = head + "." + body;
  const key = createPrivateKey(pem.replace(/\\n/g,"\n"));
  if (key.asymmetricKeyType!=="ec" || key.asymmetricKeyDetails?.namedCurve!=="prime256v1") throw new Error("Invalid APNs signing key");
  return unsigned + "." + sign("sha256",Buffer.from(unsigned),{key,dsaEncoding:"ieee-p1363"}).toString("base64url");
}
let cachedJwt: { identity: string; token: string; expires: number } | null = null;
function providerToken() {
  const identity = [process.env.ADMIN_APNS_KEY_ID,process.env.ADMIN_APNS_TEAM_ID,process.env.ADMIN_APNS_PRIVATE_KEY].join(":");
  if (cachedJwt?.identity===identity && cachedJwt.expires>Date.now()) return cachedJwt.token;
  const token = apnsJwt(process.env.ADMIN_APNS_KEY_ID!,process.env.ADMIN_APNS_TEAM_ID!,process.env.ADMIN_APNS_PRIVATE_KEY!);
  cachedJwt = {identity,token,expires:Date.now()+45*60*1000};
  return token;
}
export async function sendNativePush(token: string, environment: string, payload: PushPayload) {
  if (!apnsConfigured()) throw new HttpError(503,"iPhone 알림 연결을 준비하고 있어요.");
  nativeDeviceSchema.shape.token.parse(token);
  nativeDeviceSchema.shape.environment.parse(environment);
  const jwt = providerToken();
  const origin = environment==="development" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const body = JSON.stringify({aps:{alert:{title:payload.title,body:payload.body},sound:"default", "thread-id":"easycut-admin"},eventId:payload.eventId});
  return new Promise<void>((resolve,reject) => {
    const client = connect(origin);
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return; finished = true; clearTimeout(timer); client.destroy();
      if(error) reject(error); else resolve();
    };
    const timer = setTimeout(()=>finish(Object.assign(new Error("APNs timeout"),{statusCode:503})),8000);
    client.on("error",()=>finish(Object.assign(new Error("APNs connection failed"),{statusCode:503})));
    const request = client.request({":method":"POST",":path":"/3/device/"+token,
      authorization:"bearer "+jwt,"apns-topic":process.env.ADMIN_APNS_TOPIC!,"apns-push-type":"alert",
      "apns-priority":"10","apns-expiration":String(Math.floor(Date.now()/1000)+3600),
      "apns-collapse-id":payload.eventId.slice(0,64)});
    let status = 0, response = "";
    request.on("response",headers=>{status=Number(headers[":status"]);});
    request.on("data",chunk=>{if(response.length<4096)response+=chunk.toString();});
    request.on("error",()=>finish(Object.assign(new Error("APNs request failed"),{statusCode:503})));
    request.on("end",()=>{
      if(status===200) return finish();
      let reason = ""; try { reason=JSON.parse(response).reason; } catch { /* Keep provider details private. */ }
      const expired = status===410 || (status===400 && reason==="BadDeviceToken");
      finish(Object.assign(new Error("APNs rejected notification"),{statusCode:expired?410:status||503}));
    });
    request.end(body);
  });
}
export async function registerNativeDevice(adminId: string, input: unknown) {
  const device = nativeDeviceSchema.parse(input);
  if (!apnsConfigured()) throw new HttpError(503,"iPhone 알림 서버를 연결하고 있어요. 설정이 완료되면 켤 수 있어요.");
  return getDb().begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtext(${"admin-mobile:"+adminId}))`;
    const [count] = await tx`select count(*)::int as n from shorts_mvp.admin_mobile_subscriptions
      where admin_id=${adminId} and active and installation_id is distinct from ${device.installationId}::uuid`;
    if(Number(count.n)>=10)throw new HttpError(409,"연결된 기기가 많아요. 기존 기기 알림을 먼저 꺼주세요.");
    const endpoint = "apns://"+device.environment+"/"+device.token;
    const [owner] = await tx`select admin_id,installation_id from shorts_mvp.admin_mobile_subscriptions where endpoint=${endpoint}`;
    if(owner && owner.adminId!==adminId) throw new HttpError(409,"다른 관리자 계정에 연결된 기기예요.");
    if(owner && owner.installationId!==device.installationId) {
      const [existing]=await tx`select id from shorts_mvp.admin_mobile_subscriptions where installation_id=${device.installationId}`;
      if(existing)throw new HttpError(409,"기기 연결이 중복됐어요. 기존 연결을 확인해주세요.");
      await tx`update shorts_mvp.admin_mobile_subscriptions set installation_id=${device.installationId} where endpoint=${endpoint} and admin_id=${adminId}`;
    }
    const [row] = await tx`insert into shorts_mvp.admin_mobile_subscriptions
      (admin_id,endpoint,transport,installation_id,apns_token,apns_environment)
      values(${adminId},${endpoint},'apns',${device.installationId},${device.token},${device.environment})
      on conflict(installation_id) where installation_id is not null do update set
        endpoint=excluded.endpoint,apns_token=excluded.apns_token,apns_environment=excluded.apns_environment,
        active=true,active_from=case when shorts_mvp.admin_mobile_subscriptions.active then shorts_mvp.admin_mobile_subscriptions.active_from else now() end,updated_at=now()
      where shorts_mvp.admin_mobile_subscriptions.admin_id=excluded.admin_id returning id`;
    if(!row)throw new HttpError(409,"다른 관리자 계정에 연결된 기기예요.");
    return row.id;
  });
}
export async function testNativePush(adminId: string, installationId: string) {
  const db=getDb();
  const [row]=await db`update shorts_mvp.admin_mobile_subscriptions set last_test_at=now()
    where admin_id=${adminId} and installation_id=${installationId} and transport='apns' and active
    and (last_test_at is null or last_test_at<now()-interval '1 minute') returning id,apns_token,apns_environment`;
  if(!row)throw new HttpError(429,"연결을 확인하거나 1분 후 다시 시도해주세요.");
  try { await sendNativePush(row.apnsToken,row.apnsEnvironment,{eventId:"test",title:"EasyCut · 연결 완료",body:"이 iPhone으로 결제와 운영 알림을 받을 수 있어요."}); }
  catch(error) {
    if(Number((error as {statusCode?:number}).statusCode)===410) await db`update shorts_mvp.admin_mobile_subscriptions set active=false,updated_at=now() where id=${row.id} and apns_token=${row.apnsToken}`;
    throw new HttpError(503,"알림 발송을 확인하지 못했어요. 잠시 후 다시 시도해주세요.");
  }
}
