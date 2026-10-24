import * as cdk from "aws-cdk-lib";
import { readFileSync } from "node:fs";
import { RankingAdminStack, type RankingProps } from "../lib/ranking-stack";
const app = new cdk.App();
const inventory = app.node.tryGetContext("rankingInventory");
if (typeof inventory !== "string")
  throw new Error("Explicit verified ranking inventory file required");
const props = JSON.parse(readFileSync(inventory, "utf8")) as RankingProps;
new RankingAdminStack(app, "ShortsRankingAdmin-production", props);
