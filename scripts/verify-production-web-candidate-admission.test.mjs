import assert from "node:assert/strict";
import test from "node:test";
import {
  productionProjectTargetsFingerprint,
  readProductionProjectTargets,
} from "./production-project-targets.mjs";
import { verifyCandidateJobAdmission } from "./verify-production-web-candidate-admission.mjs";

const registry = readProductionProjectTargets();

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("accepts only a healthy candidate with the exact registry identity", async () => {
  const result = await verifyCandidateJobAdmission({
    url: "https://shorts-abc123-artiroom.vercel.app",
    registry,
    fetchImpl: async () => response(200, {
      ready: true,
      targetCount: 5,
      fingerprint: productionProjectTargetsFingerprint(registry),
    }),
  });
  assert.equal(result.origin, "https://shorts-abc123-artiroom.vercel.app");
});

test("uses the authenticated Vercel candidate request when deployment protection blocks fetch", async () => {
  let protectedOrigin = "";
  const result = await verifyCandidateJobAdmission({
    url: "https://shorts-protected-artiroom.vercel.app",
    registry,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
    protectedFetchImpl: async (origin) => {
      protectedOrigin = origin;
      return {
        status: 200,
        body: {
          ready: true,
          targetCount: 5,
          fingerprint: productionProjectTargetsFingerprint(registry),
        },
      };
    },
  });
  assert.equal(protectedOrigin, "https://shorts-protected-artiroom.vercel.app");
  assert.equal(result.origin, protectedOrigin);
});

test("fails closed on incomplete configuration or identity mismatch", async () => {
  await assert.rejects(
    verifyCandidateJobAdmission({
      url: "https://shorts-abc123-artiroom.vercel.app",
      registry,
      fetchImpl: async () => response(503, { ready: false }),
    }),
    /사전검증 실패/,
  );
  await assert.rejects(
    verifyCandidateJobAdmission({
      url: "https://shorts-abc123-artiroom.vercel.app",
      registry,
      fetchImpl: async () => response(200, {
        ready: true,
        targetCount: 5,
        fingerprint: "0".repeat(64),
      }),
    }),
    /fingerprintMatch=false/,
  );
});

test("rejects non-Vercel or insecure origins", async () => {
  for (const url of ["https://www.easycut.co.kr", "http://shorts-abc.vercel.app"]) {
    await assert.rejects(
      verifyCandidateJobAdmission({ url, registry, fetchImpl: async () => response(200, {}) }),
      /무별칭 Vercel 후보/,
    );
  }
});
