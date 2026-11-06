// Additive recovery on the verified existing production function. Default: read-only plan.
import {execFileSync} from "node:child_process";
import {readFile,writeFile,mkdtemp,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fn="shorts-ranking-capacity-production",region="ap-northeast-2";
const role="ShortsRankingAdmin-produc-CapacityServiceRole08EF8A-sSvRW2N5NW8S";
const baseline="aa83f99e4b31bb75e85ec616a369a150a75b76db";
const aws=(args)=>JSON.parse(execFileSync("aws",[...args,"--region",region,"--output","json"],{encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:45000}));
const digest=b=>createHash("sha256").update(b).digest("hex");
const routes=s=>JSON.parse(JSON.parse(s.SecretString).INGESTION_PROXY_ROUTES_JSON).map(({id,proxy_url,egress_class})=>({id,proxy_url,egress_class})).sort((a,b)=>a.id.localeCompare(b.id));
const main=()=>aws(["secretsmanager","get-secret-value","--secret-id","shorts-mvp/production/worker-runtime"]);
let folder;
try {
 if(aws(["sts","get-caller-identity"]).Account!=="181651591905")throw new Error("Wrong AWS account");
 const release=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
 if(execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim())throw new Error("Clean committed worktree required");
 const config=aws(["lambda","get-function","--function-name",fn]);
 if(config.Configuration.FunctionArn!==`arn:aws:lambda:${region}:181651591905:function:${fn}` ||
    config.Configuration.Role!==`arn:aws:iam::181651591905:role/${role}`)throw new Error("Function/role mismatch");
 const registry=main();
 const longform=aws(["secretsmanager","get-secret-value","--secret-id","shorts-mvp/production/elevenlabs-transcription-canary-runtime"]);
 if(JSON.stringify(routes(registry))!==JSON.stringify(routes(longform)))throw new Error("Longform registry mismatch");
 const source=await readFile(path.join(root,"infra/aws/lambda/ranking_capacity/index.py"));
 const oldSource=execFileSync("git",["show",`${baseline}:infra/aws/lambda/ranking_capacity/index.py`],{cwd:root});
 folder=await mkdtemp("/private/tmp/ranking-registry-release-");
 const previous=Buffer.from(await (await fetch(config.Code.Location)).arrayBuffer());
 const oldZip=path.join(folder,"previous.zip");await writeFile(oldZip,previous,{mode:0o600});
 const deployedSource=execFileSync("unzip",["-p",oldZip,"index.py"]);
 if(digest(deployedSource)!==digest(oldSource)&&digest(deployedSource)!==digest(source))throw new Error("Registered source changed; re-review required");
 const policy={Version:"2012-10-17",Statement:[{Sid:"ReadCurrentProxyRegistryOnly",Effect:"Allow",Action:"secretsmanager:GetSecretValue",Resource:registry.ARN}]};
 const policyName="RankingCurrentProxyRegistryRead";
 let existingPolicy;
 try {existingPolicy=aws(["iam","get-role-policy","--role-name",role,"--policy-name",policyName]);} catch(e) {
   if(!String(e.stderr||"").includes("NoSuchEntity"))throw new Error("Cannot verify existing policy");
 }
 if(existingPolicy&&JSON.stringify(existingPolicy.PolicyDocument)!==JSON.stringify(policy))throw new Error("Existing policy differs");
 const env={...config.Configuration.Environment.Variables,PROXY_REGISTRY_SECRET_ARN:registry.ARN};
 console.log(JSON.stringify({plan:true,sourceCommit:release,function:fn,registryRoutes:routes(registry).length,existingFunctionOnly:true,newCapacity:false}));
 if(process.argv.includes("--apply")) {
   await writeFile(path.join(folder,"rollback.json"),JSON.stringify({sourceCommit:release,config:config.Configuration,policyPreviouslyPresent:!!existingPolicy}),{mode:0o600});
   aws(["iam","put-role-policy","--role-name",role,"--policy-name",policyName,"--policy-document",JSON.stringify(policy)]);
   const envPath=path.join(folder,"environment.json");await writeFile(envPath,JSON.stringify({Variables:env}),{mode:0o600});
   aws(["lambda","update-function-configuration","--function-name",fn,"--revision-id",config.Configuration.RevisionId,"--environment",`file://${envPath}`]);
   execFileSync("aws",["lambda","wait","function-updated","--region",region,"--function-name",fn],{stdio:["ignore","pipe","pipe"],timeout:90000});
   const updated=aws(["lambda","get-function-configuration","--function-name",fn]);
   const zip=path.join(folder,"candidate.zip");
   execFileSync("python3",["-c","import zipfile,sys; z=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED); z.write(sys.argv[1],'index.py'); z.close()",path.join(root,"infra/aws/lambda/ranking_capacity/index.py"),zip]);
   aws(["lambda","update-function-code","--function-name",fn,"--revision-id",updated.RevisionId,"--zip-file",`fileb://${zip}`]);
   execFileSync("aws",["lambda","wait","function-updated","--region",region,"--function-name",fn],{stdio:["ignore","pipe","pipe"],timeout:90000});
   const output=path.join(folder,"invoke.json");await writeFile(output,"",{mode:0o600});
   const response=aws(["lambda","invoke","--function-name",fn,"--cli-binary-format","raw-in-base64-out","--payload",JSON.stringify({action:"proxy_registry"}),output]);
   const result=JSON.parse(await readFile(output,"utf8"));await rm(output);
   if(response.FunctionError||!result.ok||!result.registryVersion||result.routes?.length!==routes(registry).length)throw new Error("Registry verification failed");
   console.log(JSON.stringify({applied:true,registryVersion:result.registryVersion,routeCount:result.routes.length,rollbackDirectory:folder}));
 } else {await rm(folder,{recursive:true});}
} catch(e) {
 // Do not print SDK/CLI errors or command payloads that could contain credentials.
 console.error(JSON.stringify({failed:true,reason:e instanceof Error && !('stdout' in e)?e.message:"AWS operation failed",rollbackDirectory:folder}));
 process.exitCode=1;
}
