import assert from "node:assert/strict";
import test from "node:test";
import { readProductionWorkerRelease } from "./production-worker-release.mjs";
import {
  validateReleasedDefinitions,
  validateWorkerAttemptBudget,
} from "./verify-production-worker-release.mjs";
import { projectBatchTargets } from "./verify-project-batch-targets.mjs";
import { productionWorkerEnvironment } from "./production-worker-release.mjs";

const release = readProductionWorkerRelease();
const targets = projectBatchTargets(productionWorkerEnvironment(release));

test("requires every active definition to use the exact image digest and one Batch attempt", () => {
  const definitions = Object.values(targets).map(({ definition }) => ({
    jobDefinitionArn: definition,
    status: "ACTIVE",
    containerProperties: { image: release.imageUri },
    retryStrategy: { attempts: 1 },
  }));
  const queues = [...new Set(Object.values(targets).map(({ queue }) => queue))]
    .map((jobQueueArn) => ({ jobQueueArn, status: "VALID", state: "ENABLED" }));
  assert.doesNotThrow(
    () => validateReleasedDefinitions(release, targets, definitions, queues),
  );
  assert.throws(
    () => validateReleasedDefinitions(
      release,
      targets,
      definitions.map((row, index) => index === 0
        ? { ...row, containerProperties: { image: "repo.invalid/worker:latest" } }
        : row),
      queues,
    ),
    /image digest 불일치/,
  );
});

test("checks both internal retry ceilings against the release budget", () => {
  assert.doesNotThrow(() => validateWorkerAttemptBudget(
    "MAX_ACQUISITION_ATTEMPTS = 20\n",
    "    MAX_INLINE_INGESTION_ROUTES = 20\n",
  ));
  assert.throws(() => validateWorkerAttemptBudget(
    "MAX_ACQUISITION_ATTEMPTS = 19\n",
    "    MAX_INLINE_INGESTION_ROUTES = 20\n",
  ));
});
