import * as cdk from "aws-cdk-lib";
import { readFileSync } from "node:fs";
import { UploadCandidateStack, type UploadCandidateProps } from "../lib/file-upload-candidate-stack";
const app = new cdk.App();
const inventory = app.node.tryGetContext("uploadCandidateInventory");
if (typeof inventory !== "string") throw new Error("Explicit verified upload candidate inventory required");
const props = JSON.parse(readFileSync(inventory, "utf8")) as UploadCandidateProps;
new UploadCandidateStack(app, `ShortsUploadCandidate-${props.releaseId?.slice(0, 8)}`, props);
