#!/usr/bin/env node
// Render an isolated CloudFormation stack; this command never deploys it.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const code=readFileSync(new URL("../infra/aws/lambda/admin_ip_inventory.py",import.meta.url),"utf8");
export const template={
  AWSTemplateFormatVersion:"2010-09-09",
  Description:"Administrator-only sanitized IP inventory; no worker or customer resources",
  Parameters:{ VercelRoleName:{Type:"String",AllowedPattern:"[A-Za-z0-9+=,.@_-]+"},
    InventorySecretArn:{Type:"String",AllowedPattern:"arn:aws:secretsmanager:ap-northeast-2:181651591905:secret:shorts-mvp/production/[A-Za-z0-9_-]+"} },
  Resources:{
    ReaderRole:{Type:"AWS::IAM::Role",Properties:{
      AssumeRolePolicyDocument:{Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:"lambda.amazonaws.com"},Action:"sts:AssumeRole"}]},
      Policies:[{PolicyName:"ReadOnlyInventory",PolicyDocument:{Version:"2012-10-17",Statement:[
        {Effect:"Allow",Action:["secretsmanager:DescribeSecret","secretsmanager:ListSecretVersionIds","secretsmanager:GetSecretValue"],Resource:{Ref:"InventorySecretArn"}},
        {Effect:"Allow",Action:"batch:DescribeJobDefinitions",Resource:"*"}
      ]}}]
    }},
    Reader:{Type:"AWS::Lambda::Function",Properties:{FunctionName:"easycut-admin-ip-inventory",Runtime:"python3.12",Handler:"index.handler",
      Role:{"Fn::GetAtt":["ReaderRole","Arn"]},Timeout:15,MemorySize:256,ReservedConcurrentExecutions:2,
      Code:{ZipFile:code},Environment:{Variables:{EXPECTED_ACCOUNT:"181651591905",INVENTORY_SECRET_ARNS:{"Fn::Sub":'["${InventorySecretArn}"]'}}}}},
    InvokeReader:{Type:"AWS::IAM::Policy",Properties:{PolicyName:"EasyCutAdminIpInventoryOnly",Roles:[{Ref:"VercelRoleName"}],
      PolicyDocument:{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:"lambda:InvokeFunction",Resource:{"Fn::GetAtt":["Reader","Arn"]}}]}}},
  },
  Outputs:{FunctionArn:{Value:{"Fn::GetAtt":["Reader","Arn"]}}}
};
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw Error("Provide an output template path");
  writeFileSync(process.argv[2],JSON.stringify(template,null,2)+"\n");
  console.log("Rendered isolated administrator inventory stack.");
}
