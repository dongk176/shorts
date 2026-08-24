#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import {
  ShortsMvpComputeStack,
  ShortsMvpElevenLabsTranscriptionStack,
  ShortsMvpEditorCanaryStack,
  ShortsMvpEditorReleaseRepositoryStack,
  ShortsMvpEditorTestStack,
  ShortsMvpFoundationStack,
  ShortsMvpSourceRangeStack,
} from "../lib/stacks";
import {
  fileUploadCanaryIncluded,
  ShortsMvpFileUploadCanaryStack,
} from "../lib/file-upload-stack";

const app = new cdk.App();
const environment = app.node.tryGetContext("environment") || process.env.DEPLOY_ENV || "production";
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION || "ap-northeast-2",
};
const editorRepository = new ShortsMvpEditorReleaseRepositoryStack(
  app,
  `ShortsMvpEditorRepository-${environment}`,
  { env, environment },
);
const foundation = new ShortsMvpFoundationStack(app, `ShortsMvpFoundation-${environment}`, {
  env,
  environment,
  editorReleaseRepository: editorRepository.repository,
});
const editorCanary = new ShortsMvpEditorCanaryStack(
  app,
  `ShortsMvpEditorCanary-${environment}`,
  { env, environment, foundation },
);
editorCanary.addDependency(editorRepository);
const compute = new ShortsMvpComputeStack(app, `ShortsMvpCompute-${environment}`, {
  env,
  environment,
  foundation,
});
compute.addDependency(foundation);

const stacks: Array<{ stack: cdk.Stack; tagEnvironment: string }> = [
  { stack: editorRepository, tagEnvironment: environment },
  { stack: editorCanary, tagEnvironment: environment },
  { stack: foundation, tagEnvironment: environment },
  { stack: compute, tagEnvironment: environment },
];
if (
  app.node.tryGetContext("includeEditorTest") === "true"
  || process.env.INCLUDE_EDITOR_TEST === "true"
) {
  const editorTest = new ShortsMvpEditorTestStack(
    app,
    "ShortsMvpEditorTest",
    {
      env,
      environment: "editor-test",
      foundation,
    },
  );
  editorTest.addDependency(foundation);
  stacks.push({ stack: editorTest, tagEnvironment: "editor-test" });
}
if (
  app.node.tryGetContext("includeSourceRange") === "true"
  || process.env.INCLUDE_SOURCE_RANGE === "true"
) {
  const sourceRange = new ShortsMvpSourceRangeStack(
    app,
    `ShortsMvpSourceRange-${environment}`,
    { env, environment },
  );
  stacks.push({ stack: sourceRange, tagEnvironment: environment });
}
if (
  app.node.tryGetContext("includeElevenLabsTranscription") === "true"
  || process.env.INCLUDE_ELEVENLABS_TRANSCRIPTION === "true"
) {
  const transcriptionCanary = new ShortsMvpElevenLabsTranscriptionStack(
    app,
    `ShortsMvpElevenLabsTranscription-${environment}`,
    { env, environment },
  );
  stacks.push({ stack: transcriptionCanary, tagEnvironment: environment });
}
if (fileUploadCanaryIncluded(app.node.tryGetContext("includeFileUpload"))) {
  const fileUploadCanary = new ShortsMvpFileUploadCanaryStack(
    app,
    `ShortsMvpFileUploadCanary-${environment}`,
    { env, environment },
  );
  stacks.push({ stack: fileUploadCanary, tagEnvironment: environment });
}

for (const { stack, tagEnvironment } of stacks) {
  cdk.Tags.of(stack).add("Project", "shorts-mvp");
  cdk.Tags.of(stack).add("Environment", tagEnvironment);
  cdk.Tags.of(stack).add("ManagedBy", "CDK");
}
