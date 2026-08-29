import assert from "node:assert/strict";
import test from "node:test";
import {
  assertJobDefinitionsUseProxySecret,
  assertSecretUpdatePreserved,
  parseWebshareProxyFile,
  parseWebshareReplacementFile,
  probeWebshareRoutes,
  replaceWebshareProxyRoutes,
} from "./import-webshare-proxies.mjs";

function proxyLines(count = 20) {
  return Array.from({ length: count }, (_, index) => (
    `192.0.2.${index + 1}:${2000 + index}:user-${index}:pass-${index}`
  )).join("\n");
}

test("converts exactly twenty proxies into stable route ids without exposing raw credentials", () => {
  const routes = parseWebshareProxyFile(proxyLines());

  assert.equal(routes.length, 20);
  assert.deepEqual(
    routes.map((route) => route.id),
    Array.from({ length: 20 }, (_, index) => `webshare-${String(index + 1).padStart(2, "0")}`),
  );
  assert.equal(routes[0].egress_class, "webshare_isp");
  assert.match(routes[0].proxy_url, /^http:\/\/user-0:pass-0@192\.0\.2\.1:2000$/);
});

test("rejects an incomplete pool and duplicate endpoints", () => {
  assert.throws(() => parseWebshareProxyFile(proxyLines(19)), /정확히 20개/);
  const duplicate = proxyLines().split("\n");
  duplicate[19] = duplicate[0];
  assert.throws(() => parseWebshareProxyFile(duplicate.join("\n")), /중복/);
});

test("replaces routes by their previous IP instead of replacement file order", () => {
  const existing = parseWebshareProxyFile(proxyLines());
  const replacements = [
    "198.51.100.11:3001:new-user:new-pass:192.0.2.9",
    "198.51.100.12:3002:new-user:new-pass:192.0.2.1",
  ].join("\n");

  const result = replaceWebshareProxyRoutes(existing, replacements);

  assert.deepEqual(result.updatedRouteIds, ["webshare-09", "webshare-01"]);
  assert.match(result.routes[0].proxy_url, /@198\.51\.100\.12:3002$/);
  assert.match(result.routes[8].proxy_url, /@198\.51\.100\.11:3001$/);
  assert.equal(result.routes[3].proxy_url, existing[3].proxy_url);
});

test("rejects replacement files with unknown previous IPs", () => {
  assert.throws(
    () => replaceWebshareProxyRoutes(
      parseWebshareProxyFile(proxyLines()),
      "198.51.100.11:3001:new-user:new-pass:203.0.113.99",
    ),
    /찾을 수 없습니다/,
  );
  assert.throws(
    () => parseWebshareReplacementFile("198.51.100.11:3001:new-user:new-pass:not-an-ip"),
    /IP 형식/,
  );
});

test("requires every active worker definition to use the exact target secret", () => {
  const secretArn = "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:runtime-AbCdEf";
  const definitionArn = "arn:aws:batch:ap-northeast-2:123456789012:job-definition/worker:1";
  const definitions = [{
    jobDefinitionArn: definitionArn,
    status: "ACTIVE",
    containerProperties: {
      secrets: [{
        name: "INGESTION_PROXY_ROUTES_JSON",
        valueFrom: `${secretArn}:INGESTION_PROXY_ROUTES_JSON::`,
      }],
    },
  }];

  assert.doesNotThrow(() => (
    assertJobDefinitionsUseProxySecret(definitions, secretArn, [definitionArn])
  ));
  assert.throws(
    () => assertJobDefinitionsUseProxySecret(definitions, `${secretArn}-wrong`, [definitionArn]),
    /프록시 시크릿 대상이 다릅니다/,
  );
  assert.throws(
    () => assertJobDefinitionsUseProxySecret([], secretArn, [definitionArn]),
    /ACTIVE 상태가 아닙니다/,
  );
});

test("verifies AWSCURRENT routes and preserves every unrelated secret field", () => {
  const routes = parseWebshareProxyFile(proxyLines());
  const before = {
    DATABASE_URL: "database-secret",
    OPENAI_API_KEY: "openai-secret",
    INGESTION_PROXY_ROUTES_JSON: "old-routes",
  };
  const after = {
    ...before,
    INGESTION_PROXY_ROUTES_JSON: JSON.stringify(routes),
  };

  assert.doesNotThrow(() => assertSecretUpdatePreserved(before, after, routes));
  assert.throws(
    () => assertSecretUpdatePreserved(before, { ...after, OPENAI_API_KEY: "changed" }, routes),
    /프록시 이외/,
  );
  assert.throws(
    () => assertSecretUpdatePreserved(before, { ...after, INGESTION_PROXY_ROUTES_JSON: "[]" }, routes),
    /AWSCURRENT/,
  );
});

test("checks every route without exposing its proxy URL in failures", async () => {
  const routes = parseWebshareProxyFile(proxyLines());
  const success = async () => ({ stdout: "203.0.113.10\n" });
  assert.equal((await probeWebshareRoutes(routes, success)).length, 20);

  const failure = async () => { throw new Error("contains-sensitive-command-output"); };
  await assert.rejects(
    () => probeWebshareRoutes(routes, failure),
    (error) => (
      /webshare-01/.test(error.message)
      && !/user-0|pass-0|192\.0\.2\.1/.test(error.message)
    ),
  );
});
