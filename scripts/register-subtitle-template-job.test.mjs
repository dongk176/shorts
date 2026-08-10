import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./register-subtitle-template-job.sh", import.meta.url),
  "utf8",
);

test("subtitle candidate registration clones only an immutable job definition", () => {
  assert.match(source, /describe-job-definitions/);
  assert.match(source, /register-job-definition/);
  assert.match(source, /sha256:\[0-9a-f\]\{64\}/);
  assert.match(source, /subtitle-templates-\$\{release_sha:0:12\}/);
  assert.doesNotMatch(source, /cdk deploy|update-compute-environment|update-job-queue/);
});

test("subtitle candidate keeps the source definition and only replaces its image", () => {
  assert.match(source, /template Job Definition image is not pinned by digest/);
  assert.match(source, /repository_reference="\$\{template_image%@\*\}"/);
  assert.match(source, /repository_name="\$\{repository_name%%:\*\}"/);
  assert.match(source, /repository_uri="\$\{repository_prefix\}\/\$\{repository_name\}"/);
  assert.match(source, /containerProperties: \(\.jobDefinitions\[0\]\.containerProperties \| \.image = \$image\)/);
  assert.match(source, /ascii_downcase \| startswith\("aws:"\)/);
  assert.match(source, /Purpose: "subtitle-templates-admin-canary"/);
});

test("subtitle candidate registration cannot drift from the Batch Submitter trust target", () => {
  assert.match(
    source,
    /batch_submitter_function="\$\{4:\?production Batch Submitter Lambda name is required\}"/,
  );
  assert.match(source, /registered subtitle Job Definition image verification failed/);
  assert.match(source, /get-function-configuration/);
  assert.match(source, /--revision-id "\$revision_id"/);
  assert.match(source, /update-function-configuration/);
  assert.match(source, /wait function-updated-v2/);
  assert.match(source, /Batch Submitter subtitle target verification failed/);
  assert.ok(
    source.indexOf("trusted_candidate_arn=") < source.lastIndexOf("printf '%s\\n'"),
    "the candidate ARN must only be printed after the trusted target is verified",
  );
});
