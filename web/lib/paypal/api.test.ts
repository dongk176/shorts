import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });
it("records provider diagnostics without buyer data, credentials or query strings", async () => {
  vi.stubEnv("PAYPAL_ENVIRONMENT", "live"); vi.stubEnv("PAYPAL_CLIENT_ID", "private-client"); vi.stubEnv("PAYPAL_CLIENT_SECRET", "private-secret");
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  const fetchMock=vi.fn().mockResolvedValueOnce(Response.json({access_token:"private-token",expires_in:3600})).mockResolvedValueOnce(Response.json({name:"UNPROCESSABLE_ENTITY",debug_id:"a123456789abc",message:"buyer@example.com",details:[{issue:"INSTRUMENT_DECLINED",description:"card 4111111111111111",value:"private-value"}]},{status:422}));
  vi.stubGlobal("fetch",fetchMock);
  const {paypalRequest}=await import("./api");
  await expect(paypalRequest("/v1/billing/subscriptions/I-123456789012/transactions?start_time=private-query")).rejects.toThrow("could not be confirmed");
  const serialized=JSON.stringify(log.mock.calls);
  expect(serialized).toContain("a123456789abc");expect(serialized).toContain("INSTRUMENT_DECLINED");
  for(const secret of ["private-client","private-secret","private-token","private-query","buyer@example.com","4111111111111111","I-123456789012"])expect(serialized).not.toContain(secret);
});
it("records authentication and network failures without exposing raw errors", async () => {
  vi.stubEnv("PAYPAL_ENVIRONMENT", "live"); vi.stubEnv("PAYPAL_CLIENT_ID", "private-client"); vi.stubEnv("PAYPAL_CLIENT_SECRET", "private-secret");
  const log=vi.spyOn(console,"error").mockImplementation(()=>{});
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new TypeError("private-secret buyer@example.com")));
  const {paypalRequest}=await import("./api");
  await expect(paypalRequest("/v1/billing/plans/P-1234567890123456789012")).rejects.toThrow();
  expect(log).toHaveBeenCalledWith("paypal_transport_failed",{operation:"/v1/oauth2/token",errorName:"TypeError"});
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-secret");
});

it('distinguishes missing subscription references without assuming a payment failed', async()=>{
 vi.stubEnv('PAYPAL_ENVIRONMENT','live');vi.stubEnv('PAYPAL_CLIENT_ID','client');vi.stubEnv('PAYPAL_CLIENT_SECRET','secret');
 vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({access_token:'token',expires_in:3600})).mockResolvedValueOnce(Response.json({name:'RESOURCE_NOT_FOUND',debug_id:'a123456789abc'},{status:404})));
 const {paypalRequest}=await import('./api');
 await expect(paypalRequest('/v1/billing/subscriptions/I-123456789012')).rejects.toMatchObject({code:'PAYPAL_REFERENCE_UNAVAILABLE',providerStatus:404,debugId:'a123456789abc'});
});
