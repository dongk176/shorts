import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { YoutubeAccountGoogle } from "./google";
const config = { clientId: "fake", clientSecret: "fake", redirectUri: "http://localhost" };
describe("provider revocation", () => {
  it("sends the token only in a POST body to the fixed endpoint with timeout and no redirects", async () => {
    const fetcher = vi.fn(async () => new Response(null, {status:200}));
    const google = new YoutubeAccountGoogle(config,fetcher);
    expect(await google.revoke("fake-refresh-token")).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init.method).toBe("POST");expect(init.redirect).toBe("error");expect(init.signal).toBeDefined();
    expect(String(init.body)).toBe("token=fake-refresh-token");
  });
  it.each([400,401,429,500])("does not claim successful revocation for HTTP %i", async status => {
    const google=new YoutubeAccountGoogle(config,async()=>Response.json({error:"private provider detail"},{status}));
    expect(await google.revoke("fake")).toBe(false);
  });
  it("handles timeout or network failure without leaking token or provider text",async()=>{
    const google=new YoutubeAccountGoogle(config,async()=>{throw Error("secret provider error");});
    expect(await google.revoke("fake")).toBe(false);
  });
});
describe("periodic authorization validation",()=>{
  const channelId='UCaaaaaaaaaaaaaaaaaaaaaa';
  it.each([401,429,500])("does not interpret token HTTP %i as revoked consent",async status=>{
    expect(await new YoutubeAccountGoogle(config,async()=>Response.json({error:'invalid_grant'},{status})).checkChannel('refresh',channelId)).toEqual({status:'retry'});
  });
  it("recognizes explicit invalid_grant without retaining provider details",async()=>{
    expect(await new YoutubeAccountGoogle(config,async()=>Response.json({error:'invalid_grant',error_description:'secret'},{status:400})).checkChannel('refresh',channelId)).toEqual({status:'revoked'});
  });
  it.each([{}, {items:[],nextPageToken:'more'}])("retries an incomplete channel response",async data=>{
    const fetcher:typeof fetch=async url=>String(url).includes('/token')?Response.json({access_token:'access'}):Response.json(data);
    expect(await new YoutubeAccountGoogle(config,fetcher).checkChannel('refresh',channelId)).toEqual({status:'retry'});
  });
  it("an empty complete channel response removes an unavailable grant",async()=>{
    const fetcher:typeof fetch=async url=>String(url).includes('/token')?Response.json({access_token:'access'}):Response.json({items:[]});
    expect(await new YoutubeAccountGoogle(config,fetcher).checkChannel('refresh',channelId)).toEqual({status:'revoked'});
  });
});
