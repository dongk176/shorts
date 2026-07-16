import assert from "node:assert/strict";
import test from "node:test";
import { parseWebshareProxyFile } from "./import-webshare-proxies.mjs";

function proxyLines(count = 10) {
  return Array.from({ length: count }, (_, index) => (
    `192.0.2.${index + 1}:${2000 + index}:user-${index}:pass-${index}`
  )).join("\n");
}

test("converts exactly ten proxies into stable route ids without exposing raw credentials", () => {
  const routes = parseWebshareProxyFile(proxyLines());

  assert.equal(routes.length, 10);
  assert.deepEqual(routes.map((route) => route.id), [
    "webshare-01", "webshare-02", "webshare-03", "webshare-04", "webshare-05",
    "webshare-06", "webshare-07", "webshare-08", "webshare-09", "webshare-10",
  ]);
  assert.equal(routes[0].egress_class, "webshare_isp");
  assert.match(routes[0].proxy_url, /^http:\/\/user-0:pass-0@192\.0\.2\.1:2000$/);
});

test("rejects an incomplete pool and duplicate endpoints", () => {
  assert.throws(() => parseWebshareProxyFile(proxyLines(9)), /정확히 10개/);
  const duplicate = proxyLines().split("\n");
  duplicate[9] = duplicate[0];
  assert.throws(() => parseWebshareProxyFile(duplicate.join("\n")), /중복/);
});
