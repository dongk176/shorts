import assert from "node:assert/strict";
import test from "node:test";
import {
  currentProjectTargetNames,
  staleOptionalProjectTargetNames,
  validateVercelProjectTargetMetadata,
} from "./verify-vercel-project-target-env-metadata.mjs";

function rows(registry = null) {
  return currentProjectTargetNames(registry).map((key, index) => ({
    id: `target_env_${String(index).padStart(2, "0")}`,
    key,
    target: ["production"],
    type: "sensitive",
  }));
}

test("requires the exact twenty-five sensitive production target variables", () => {
  const result = validateVercelProjectTargetMetadata(rows());
  assert.equal(Object.keys(result).length, 25);
});

test("requires stale v4 capability variables to be removed on a legacy rotation", () => {
  const registry = {
    lanes: {
      legacy_project: { current: { renderSpecVersion: 4 } },
    },
  };
  const baseline = rows(registry);
  const stale = {
    id: "target_env_stale_source_range",
    key: "SOURCE_RANGE_RENDER_SPEC_VERSION",
    target: ["production"],
    type: "sensitive",
  };
  assert.deepEqual(
    staleOptionalProjectTargetNames([...baseline, stale], registry),
    ["SOURCE_RANGE_RENDER_SPEC_VERSION"],
  );
  assert.throws(
    () => validateVercelProjectTargetMetadata([...baseline, stale], registry),
    /stale v4/,
  );
  assert.throws(
    () => staleOptionalProjectTargetNames([
      ...baseline,
      stale,
      { ...stale, id: "target_env_stale_duplicate" },
    ], registry),
    /중복/,
  );
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
