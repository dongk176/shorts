import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWebshareProxyFile,
  parseWebshareReplacementFile,
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
