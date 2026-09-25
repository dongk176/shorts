import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Sql } from 'postgres';
import { PGlite } from '../../test-tools/node_modules/@electric-sql/pglite/dist/index.js';
vi.mock('@/lib/youtube-quota',()=>({withYoutubePurpose: (_p:unknown,_db:unknown,fn:()=>unknown)=>fn(),youtubeRequest: (_p:unknown,u:URL,i:RequestInit,f:typeof fetch)=>f(u,i)}));
import { refreshProjectMetadata, requestProjectMetadata } from './youtube-project-retention';
let pg:PGlite;
function tag(engine: Pick<PGlite,'query'>):Sql {
  const sql=async(strings:TemplateStringsArray,...values:unknown[])=>{
    const query=strings.reduce((t,p,i)=>t+(i?`$${i}`:'')+p,'');
    const r=await engine.query<Record<string,unknown>>(query,values);
    return r.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,l)=>l.toUpperCase()),v])));
  };
  return Object.assign(sql,{begin:(fn:(tx:Sql)=>Promise<unknown>)=>pg.transaction(tx=>fn(tag(tx)))}) as unknown as Sql;
}
beforeAll(async()=>{
  pg=new PGlite();
  await pg.exec(`create schema shorts_mvp; create table shorts_mvp.video_jobs(
    id text primary key,source_type text not null default 'youtube',youtube_video_id text,
    video_title text not null,channel_name text not null,thumbnail_url text not null,channel_thumbnail_url text,
    created_at timestamptz not null,updated_at timestamptz default now(),
    youtube_url text default 'user supplied URL',source_duration_seconds integer default 100,billable_source_seconds integer default 100);`);
  await pg.exec(fs.readFileSync(path.resolve('../supabase/migrations/202609260001_youtube_project_metadata_retention.sql'),'utf8'));
},30000);
beforeEach(async()=>{
  vi.stubEnv('YOUTUBE_API_KEY','test-key');
  await pg.exec(`truncate shorts_mvp.video_jobs;
    insert into shorts_mvp.video_jobs(id,source_type,youtube_video_id,video_title,channel_name,thumbnail_url,channel_thumbnail_url,created_at,youtube_metadata_verified_at)
    values ('old','youtube','aaaaaaaaaaa','Old title','Old channel','https://old/video','https://old/channel',now()-interval '31 days',null),
    ('retry','youtube','bbbbbbbbbbb','Retry title','Retry channel','https://retry/video',null,now()-interval '26 days',null),
    ('recent','youtube','ccccccccccc','Recent','Recent','https://recent',null,now()-interval '1 day',null),
    ('file','upload',null,'Own video','Own channel','https://own',null,now()-interval '40 days',null);`);
});
afterAll(async()=>{await pg.close();vi.unstubAllEnvs();});
const get=async(id:string)=>(await pg.query<Record<string,unknown>>('select * from shorts_mvp.video_jobs where id=$1',[id])).rows[0];
const fresh={title:'Fresh title',channelName:'Fresh channel',thumbnailUrl:'https://fresh/video',channelThumbnailUrl:'https://fresh/channel'};
describe('project YouTube data retention',()=>{
  it('refreshes provider fields without changing user input, accounting or uploaded-file metadata',async()=>{
    const before=await get('old');
    expect(await refreshProjectMetadata({db:tag(pg),requestMetadata:async ids=>new Map(ids.map(id=>[id,fresh]))})).toEqual({refreshed:2,expired:0,failed:false});
    const after=await get('old');expect(after.video_title).toBe('Fresh title');
    for(const field of ['youtube_url','source_duration_seconds','billable_source_seconds','created_at','updated_at'])expect(after[field]).toEqual(before[field]);
    expect((await get('file')).video_title).toBe('Own video');expect((await get('recent')).video_title).toBe('Recent');
    expect((await refreshProjectMetadata({db:tag(pg),requestMetadata:async()=>{throw Error('unexpected')}})).refreshed).toBe(0);
  });
  it('keeps non-expired cache on API failure, expires stale fields without renewing the verification age',async()=>{
    expect(await refreshProjectMetadata({db:tag(pg),requestMetadata:async()=>{throw Error('network')}})).toEqual({refreshed:0,expired:1,failed:true});
    expect((await get('old')).video_title).toBe('YouTube video');expect((await get('old')).channel_thumbnail_url).toBeNull();
    expect((await get('old')).youtube_metadata_verified_at).toBeNull();expect((await get('retry')).video_title).toBe('Retry title');
  });
  it('clears missing/private video fields after a valid complete API response',async()=>{
    await refreshProjectMetadata({db:tag(pg),requestMetadata:async()=>new Map()});
    expect((await get('old')).thumbnail_url).toBe('');expect((await get('retry')).channel_name).toBe('');
  });
  it('does not renew the timestamp when a transaction fails',async()=>{
    await pg.exec(`alter table shorts_mvp.video_jobs add constraint no_bad_title check(video_title<>'bad')`);
    const result=await refreshProjectMetadata({db:tag(pg),requestMetadata:async()=>new Map([['aaaaaaaaaaa',fresh],['bbbbbbbbbbb',{...fresh,title:'bad'}]])});
    expect(result.failed).toBe(true);expect((await get('old')).youtube_metadata_verified_at).toBeNull();
    await pg.exec('alter table shorts_mvp.video_jobs drop constraint no_bad_title');
  });
});
describe('provider validation',()=>{
  it('rejects malformed responses instead of treating them as missing videos',async()=>{
    await expect(requestProjectMetadata(['aaaaaaaaaaa'],async()=>Response.json({error:'bad'}))).rejects.toThrow();
    await expect(requestProjectMetadata(['aaaaaaaaaaa'],async()=>Response.json({items:[]} ,{status:500}))).rejects.toThrow();
  });
  it('refreshes channel images too and excludes private videos',async()=>{
    const fetcher=vi.fn(async(u:URL|RequestInfo)=>String(u).includes('/channels')?Response.json({items:[{id:'channel',snippet:{thumbnails:{default:{url:'https://fresh/channel'}}}}]}):Response.json({items:[{id:'aaaaaaaaaaa',snippet:{title:'A',channelTitle:'C',channelId:'channel',thumbnails:{default:{url:'https://fresh/video'}}},status:{privacyStatus:'public'}},{id:'bbbbbbbbbbb',snippet:{title:'B',channelTitle:'C',channelId:'channel',thumbnails:{}},status:{privacyStatus:'private'}}]}));
    const result=await requestProjectMetadata(['aaaaaaaaaaa','bbbbbbbbbbb'],fetcher);
    expect(result.get('aaaaaaaaaaa')?.channelThumbnailUrl).toBe('https://fresh/channel');expect(result.has('bbbbbbbbbbb')).toBe(false);expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
