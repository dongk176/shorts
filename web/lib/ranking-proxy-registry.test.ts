import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ send: vi.fn(), config: vi.fn() }));
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class { constructor(config: unknown) {state.config(config);} send(...args: unknown[]) {return state.send(...args);} },
  InvokeCommand: class { constructor(public input: unknown) {} },
}));
import { currentRankingProxyRegistry } from "./ranking-proxy-registry";
const route = {id:"webshare-01",proxy_url:"http://user:password@8.8.8.8:8000",egress_class:"webshare_isp"};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RANKING_CAPACITY_FUNCTION_ARN", "arn:aws:lambda:ap-northeast-2:181651591905:function:shorts-ranking-capacity-production");
  vi.stubEnv("RANKING_PROXY_ROUTES_JSON", JSON.stringify([{...route,proxy_url:"http://stale.invalid:8000"}]));
  state.send.mockResolvedValue({Payload:Buffer.from(JSON.stringify({ok:true,registryVersion:"version-one",routes:[route]}))});
});
it("reads the current version on each lease, never the stale copied variable", async () => {
  expect((await currentRankingProxyRegistry()).routes).toEqual([route]);
  state.send.mockResolvedValueOnce({Payload:Buffer.from(JSON.stringify({ok:true,registryVersion:"version-two",routes:[{...route,proxy_url:"http://user:password@1.1.1.1:8000"}]}))});
  expect((await currentRankingProxyRegistry()).registryVersion).toBe("version-two");
  expect(state.send).toHaveBeenCalledTimes(2);
  expect(state.send.mock.calls[0][0].input).toMatchObject({InvocationType:"RequestResponse"});
  expect(JSON.parse(state.send.mock.calls[0][0].input.Payload.toString())).toEqual({action:"proxy_registry"});
});
it("fails closed and hides secret contents when the resolver is unavailable", async () => {
  state.send.mockRejectedValueOnce(new Error(route.proxy_url));
  try {await currentRankingProxyRegistry();throw new Error("expected failure");} catch(e) {
    expect(String(e)).not.toContain("password");
    expect(String(e)).toContain("다운로드 연결 설정");
  }
});
it("refuses another account and malformed or duplicate routes", async () => {
  vi.stubEnv("RANKING_CAPACITY_FUNCTION_ARN","arn:aws:lambda:ap-northeast-2:426197262986:function:shorts-ranking-capacity-production");
  await expect(currentRankingProxyRegistry()).rejects.toThrow();
  expect(state.send).not.toHaveBeenCalled();
});
it("rejects malformed payloads without reflecting credentials", async () => {
  state.send.mockResolvedValue({Payload:Buffer.from(JSON.stringify({ok:true,registryVersion:"version-one",routes:[route,route]}))});
  await expect(currentRankingProxyRegistry()).rejects.toThrow("다운로드 연결 설정");
});
