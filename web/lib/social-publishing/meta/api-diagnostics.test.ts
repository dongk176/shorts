import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MetaApi } from "./api";
import type { MetaConfig } from "./config";
const config: MetaConfig = {platform:"instagram", clientId:"123", clientSecret:"never-log-app-secret", graphVersion:"v26.0", origin:"https://www.easycut.co.kr", appKey:"instagram:123", redirectUri:"https://www.easycut.co.kr/api/social/instagram/oauth/callback", scopes:["instagram_business_basic","instagram_business_content_publish"], oauthReady:true};
describe("Meta OAuth diagnostics", () => {
  it("identifies a provider rejection without exposing request or response secrets", async () => {
    const api = new MetaApi(config, vi.fn(async () => Response.json({error:{code:190,error_subcode:463,message:"never-log-access-token",error_data:{secret:"never-log-private-data"}}},{status:400})));
    const error = await api.exchange("never-log-authorization-code").catch(e => e);
    expect(error.code).toBe("META_RECONNECT_REQUIRED");
    expect(error.diagnostic).toEqual({stage:"authorization_code",status:400,providerCode:190,providerSubcode:463});
    expect(JSON.stringify(error)).not.toMatch(/never-log|https:/);
  });
  it("keeps partial grants rejected and records only permission presence", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const p=new URL(String(input)).pathname;
      if(p==="/oauth/access_token") return Response.json({access_token:"never-log-short-token",user_id:"123",permissions:"instagram_business_basic"});
      if(p==="/access_token") return Response.json({access_token:"never-log-long-token",expires_in:5000000});
      expect(init?.method).toBe("DELETE");return Response.json({success:true});
    });
    const error = await new MetaApi(config, fetcher).exchange("never-log-code").catch(e=>e);
    expect(error.code).toBe("META_PERMISSION_REQUIRED");
    expect(error.diagnostic).toEqual({stage:"grant_validation",permissionsShape:"string",requiredGranted:[true,false]});
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(error)).not.toContain("never-log");
  });
});
