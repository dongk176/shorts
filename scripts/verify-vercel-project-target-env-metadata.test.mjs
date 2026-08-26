import assert from "node:assert/strict";
import test from "node:test";
import {
  currentProjectTargetNames,
  validateVercelProjectTargetMetadata,
} from "./verify-vercel-project-target-env-metadata.mjs";

function rows() {
  return currentProjectTargetNames().map((key, index) => ({
    id: `target_env_${String(index).padStart(2, "0")}`,
    key,
    target: ["production"],
    type: "sensitive",
  }));
}

test("requires the exact fifteen sensitive production target variables", () => {
  const result = validateVercelProjectTargetMetadata(rows());
  assert.equal(Object.keys(result).length, 15);
});

test("rejects missing, duplicate, readable, or broadly scoped target variables", () => {
  const baseline = rows();
  assert.throws(
    () => validateVercelProjectTargetMetadata(baseline.slice(1)),
    /정확히 하나/,
  );
  assert.throws(
    () => validateVercelProjectTargetMetadata([...baseline, baseline[0]]),
    /정확히 하나/,
  );
  assert.throws(
    () => validateVercelProjectTargetMetadata([
      { ...baseline[0], type: "encrypted" },
      ...baseline.slice(1),
    ]),
    /고정 계약/,
  );
  assert.throws(
    () => validateVercelProjectTargetMetadata([
      { ...baseline[0], target: ["production", "preview"] },
      ...baseline.slice(1),
    ]),
    /고정 계약/,
  );
});
