#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import {
  ShortsMvpComputeStack,
  ShortsMvpEditorTestStack,
  ShortsMvpFoundationStack,
} from "../lib/stacks";

const app = new cdk.App();
const environment = app.node.tryGetContext("environment") || process.env.DEPLOY_ENV || "production";
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION || "ap-northeast-2",
};
const foundation = new ShortsMvpFoundationStack(app, `ShortsMvpFoundation-${environment}`, {
  env,
  environment,
});
const compute = new ShortsMvpComputeStack(app, `ShortsMvpCompute-${environment}`, {
  env,
  environment,
  foundation,
});
compute.addDependency(foundation);

const stacks: Array<{ stack: cdk.Stack; tagEnvironment: string }> = [
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

for (const { stack, tagEnvironment } of stacks) {
  cdk.Tags.of(stack).add("Project", "shorts-mvp");
  cdk.Tags.of(stack).add("Environment", tagEnvironment);
  cdk.Tags.of(stack).add("ManagedBy", "CDK");
}
