#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ShortsMvpComputeStack, ShortsMvpFoundationStack } from "../lib/stacks";

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

for (const stack of [foundation, compute]) {
  cdk.Tags.of(stack).add("Project", "shorts-mvp");
  cdk.Tags.of(stack).add("Environment", environment);
  cdk.Tags.of(stack).add("ManagedBy", "CDK");
}
