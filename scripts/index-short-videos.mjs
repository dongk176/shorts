import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {indexShortVideoBatch} from '../web/lib/short-video-embeddings.mjs';
import {requireProductionDatabaseUrl} from './production-database-identity.mjs';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const postgres=require('postgres');
const {values}=parseArgs({options:{'max-items':{type:'string',default:'500'},'max-seconds':{type:'string',default:'600'},concurrency:{type:'string',default:'2'}}});
const maxItems=Number(values['max-items']), seconds=Number(values['max-seconds']), concurrency=Number(values.concurrency);
if(!Number.isInteger(maxItems)||maxItems<1||maxItems>100000||!Number.isInteger(seconds)||seconds<10||seconds>7200||![1,2].includes(concurrency))throw Error('Invalid bounded indexing options');
const url=requireProductionDatabaseUrl();
if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY is required');
const db=postgres(url,{max:3,prepare:false,connect_timeout:15,idle_timeout:10,transform:postgres.camel,
  connection:{application_name:'short-video-index-backfill',statement_timeout:15000,lock_timeout:3000}});
const stats={claimed:0,saved:0,tokens:0,batches:0,failed:0};
let reserved=0,stopped=false;
const started=Date.now(),deadline=started+seconds*1000;
process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
async function run(){
  while(!stopped&&reserved<maxItems&&Date.now()<deadline){
    const limit=Math.min(100,maxItems-reserved);reserved+=limit;
    try {
      const result=await indexShortVideoBatch(db,{apiKey:process.env.OPENAI_API_KEY,limit});
      if(result.skipped==='busy'){reserved-=limit;await new Promise(resolve=>setTimeout(resolve,250));continue;}
      stats.claimed+=result.claimed;stats.saved+=result.saved;stats.tokens+=result.tokens;stats.batches++;
      console.log(JSON.stringify({...stats,elapsedSeconds:Math.round((Date.now()-started)/1000)}));
      if(!result.claimed)break;
    }catch(error){stats.failed++;stopped=true;console.error(JSON.stringify({event:'index_batch_failed',kind:/^Embedding\w+$/.test(error?.message||'')?error.message:error?.code||error?.name||'Error'}));}
  }
}
try{await Promise.all(Array.from({length:concurrency},run));}
finally{await db.end({timeout:5});console.log(JSON.stringify({final:true,...stats,elapsedSeconds:Math.round((Date.now()-started)/1000),estimatedEmbeddingUsd:stats.tokens*.02/1000000}));}
if(stats.failed)process.exitCode=1;
