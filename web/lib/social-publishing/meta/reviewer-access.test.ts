import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { metaReviewerGrant } from "./reviewer-access";

const grant={userId:"11111111-1111-4111-8111-111111111111",shortId:"22222222-2222-4222-8222-222222222222",expiresAt:"2027-09-21T00:00:00.000Z"};
const env: NodeJS.ProcessEnv={NODE_ENV:"test",META_PUBLISHING_MODE:"admin-review",VERCEL_ENV:"production",VERCEL_PROJECT_ID:"prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw",DATABASE_URL:"postgres://postgres.mvcprswvfybudtopepuj:fake@aws-1-ap-northeast-2.pooler.supabase.com/postgres",META_REVIEWER_ACCESS:JSON.stringify(grant)};
const now=Date.parse("2026-09-21T00:00:00Z");
describe("one-video Meta reviewer grant",()=>{
  it("requires an explicit, valid server grant and exact permitted environment",()=>{
    expect(metaReviewerGrant(env,now)).toEqual(grant);
    for(const patch of [{META_REVIEWER_ACCESS:""},{META_REVIEWER_ACCESS:"{}"},{META_REVIEWER_ACCESS:"invalid"},{META_PUBLISHING_MODE:""},{VERCEL_ENV:"preview"},{VERCEL_PROJECT_ID:"lab"},{DATABASE_URL:"postgres://test@localhost/db"}]) expect(metaReviewerGrant({...env,...patch},now)).toBeNull();
  });
  it("rejects expiry, invalid or broad IDs, ambiguous dates and additional privileges",()=>{
    for(const patch of [{userId:"*"},{shortId:"*"},{expiresAt:""},{expiresAt:"2027-09-21"},{expiresAt:"not-a-date"},{expiresAt:"2026-09-21T00:00:00Z"},{isAdmin:true}]) expect(metaReviewerGrant({...env,META_REVIEWER_ACCESS:JSON.stringify({...grant,...patch})},now)).toBeNull();
    expect(metaReviewerGrant(env,Date.parse(grant.expiresAt))).toBeNull();
  });
});
