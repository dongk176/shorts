import {readFileSync} from "node:fs";
import postgres,{type Sql} from "postgres";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {indexShortVideoBatch} from "./short-video-embeddings.mjs";
import {searchRankingShortVideos} from "./ranking-semantic-search";
import {rankingSearchSchema} from "./ranking-search-input";
const connection=process.env.RANKING_SEARCH_TEST_DATABASE_URL;
const vector=(axis=0)=>Array.from({length:768},(_,i)=>i===axis?1:0);
const now=new Date();
(connection?describe:describe.skip)("ranking hybrid search on isolated pgvector",()=>{
  let db:Sql;
  beforeAll(async()=>{
    const target=new URL(connection!);
    if(!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!='/ranking_search_test')throw Error('Disposable local search DB required');
    db=postgres(connection!,{max:6,prepare:false,transform:postgres.camel,onnotice:()=>{},connection:{statement_timeout:10000}});
    await db.unsafe(`create extension if not exists vector;drop schema if exists shorts_mvp cascade;create schema shorts_mvp;
      do $$ begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;
      if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;
      if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role;end if;end $$;
      create table shorts_mvp.youtube_catalog(id text primary key,video_id text unique,metadata jsonb,availability text not null default 'public',verified_at timestamptz not null default now());
      create table shorts_mvp.youtube_catalog_regions(catalog_id text,region_code text,last_collected_at timestamptz);`);
    const reserved=await db.reserve();
    try {
      await reserved.unsafe(readFileSync('../supabase/migrations/202609230001_popular_text_search.sql','utf8'));
      await reserved.unsafe(readFileSync('../supabase/migrations/20261025161424_short_video_semantic_search.sql','utf8'));
    } finally {reserved.release();}
  },30000);
  beforeEach(async()=>{await db`truncate shorts_mvp.youtube_catalog,shorts_mvp.youtube_catalog_regions cascade`;vi.stubEnv('OPENAI_API_KEY','');});
  afterAll(async()=>{vi.unstubAllEnvs();await db?.end();});
  async function seed(id:string,title:string,extra:Record<string,unknown>={}){
    await db`insert into shorts_mvp.youtube_catalog(id,video_id,metadata)values(${id},${id},${db.json({videoId:id,title,channelName:'테스트채널',category:'entertainment',durationSeconds:25,viewCount:100,publishedAt:now.toISOString(),license:'youtube',isKorean:true,isJapanese:false,isEnglish:false,thumbnailUrl:'https://example.test/image.jpg',...extra})})`;
  }
  const fakeEmbed=async(inputs:string[])=>({vectors:inputs.map(()=>vector()),tokens:inputs.length*20});
  const index=(embed=fakeEmbed,limit=100)=>indexShortVideoBatch(db,{apiKey:'test',limit,embed});
  const search=(q:string,extra:Record<string,unknown>={})=>searchRankingShortVideos(db,rankingSearchSchema.parse({q,...extra}),{vector:vector()});

  it('lets two indexing workers claim disjoint batches while both provider calls are in flight',async()=>{
    for(let i=0;i<20;i++)await seed(`parallel${i.toString().padStart(3,'0')}`,'강아지 산책');
    let firstStarted!:()=>void,releaseFirst!:()=>void;
    const started=new Promise<void>(r=>{firstStarted=r;}),hold=new Promise<void>(r=>{releaseFirst=r;});
    const first=index(async inputs=>{firstStarted();await hold;return fakeEmbed(inputs);},10);
    await started;
    const second=await index(fakeEmbed,10);expect(second.saved).toBe(10);
    releaseFirst();expect((await first).saved).toBe(10);
    expect((await db`select count(*)::integer as n from shorts_mvp.short_video_embeddings where embedding is not null`)[0].n).toBe(20);
  });
  it('fences a late provider response after catalog text changes and a new worker claims it',async()=>{
    await seed('staleresult','이전 제목');
    let start!:()=>void,release!:()=>void;
    const started=new Promise<void>(r=>{start=r;}),hold=new Promise<void>(r=>{release=r;});
    const stale=index(async inputs=>{start();await hold;return fakeEmbed(inputs);});
    await started;
    await db`update shorts_mvp.youtube_catalog set metadata=jsonb_set(metadata,'{title}','"새 제목"') where id='staleresult'`;
    expect((await index()).saved).toBe(1);release();expect((await stale).saved).toBe(0);
    expect((await db`select e.source_hash=md5(shorts_mvp.short_video_embedding_text(c.metadata)) as valid from shorts_mvp.short_video_embeddings e join shorts_mvp.youtube_catalog c on c.id=e.catalog_id`)[0].valid).toBe(true);
  });
  it('reuses unchanged embeddings, invalidates changed/removed metadata, and excludes expired/long sources',async()=>{
    await seed('publicvideo','귀여운 강아지');await seed('longervideo','강아지',{durationSeconds:181});await seed('expiredone','강아지');
    await db`update shorts_mvp.youtube_catalog set verified_at=now()-interval '31 days' where id='expiredone'`;
    expect((await index()).saved).toBe(1);
    await db`update shorts_mvp.youtube_catalog set metadata=jsonb_set(metadata,'{viewCount}','99999') where id='publicvideo'`;
    expect((await index()).claimed).toBe(0);
    expect((await search('강아지')).items.map(v=>v.videoId)).toEqual(['publicvideo']);
    await db`update shorts_mvp.youtube_catalog set availability='unavailable' where id='publicvideo'`;
    expect((await db`select count(*)::integer as n from shorts_mvp.short_video_embeddings`)[0].n).toBe(0);
    expect((await search('강아지')).items).toEqual([]);
  });
  it('finds related text without a literal query match and honors language/category/period/reuse filters',async()=>{
    await seed('related0001','산책하다 놀란 반려견',{license:'creativeCommon'});
    await seed('related0002','Amazing dog surprise',{isKorean:false,isEnglish:true,category:'sports'});
    await index();
    const response=await search('웃긴 동물');expect(response.searchMode).toBe('related');expect(response.items).toHaveLength(2);
    expect((await search('웃긴 동물',{language:'ko',reusable:true})).items.map(v=>v.videoId)).toEqual(['related0001']);
    expect((await search('웃긴 동물',{category:'sports',language:'en'})).items.map(v=>v.videoId)).toEqual(['related0002']);
    expect((await search('웃긴 동물',{period:'today'})).items).toHaveLength(0);
    await db`insert into shorts_mvp.youtube_catalog_regions values('related0001','KR',now())`;
    expect((await search('웃긴 동물',{period:'today'})).items.map(v=>v.videoId)).toEqual(['related0001']);
  });
  it('combines keyword matches and meaning while binding pagination to the complete query',async()=>{
    for(let i=0;i<55;i++)await seed(`page${i.toString().padStart(7,'0')}`,'고양이 장난',{viewCount:1000-i});
    await index();const first=await search('고양이');expect(first.items).toHaveLength(48);
    const second=await search('고양이',{cursor:first.nextCursor});expect(second.items).toHaveLength(7);
    expect(second.items.some(v=>first.items.some(w=>w.videoId===v.videoId))).toBe(false);
    await expect(search('강아지',{cursor:first.nextCursor})).rejects.toThrow('InvalidSearchCursor');
  });
  it('uses deterministic keyword fallback when AI is not configured and never returns vectors',async()=>{
    await seed('fallback001','귀여운 고양이');
    const response=await searchRankingShortVideos(db,rankingSearchSchema.parse({q:'고양이'}),{apiKey:''});
    expect(response.searchMode).toBe('keyword');expect(response.items).toHaveLength(1);expect(JSON.stringify(response)).not.toContain('embedding');
  });
  it('ranks a meaningful result above a partial word match while preserving exact channel matches',async()=>{
    await seed('meaning0001','예상을 뒤집은 결말');
    await seed('partial0001','마지막 아이돌 뮤직비디오');
    await seed('channel0001','새로운 소식',{channelName:'침착맨'});
    await index();
    await db`update shorts_mvp.short_video_embeddings set embedding=${JSON.stringify(vector(1))}::public.vector where catalog_id in('partial0001','channel0001')`;
    expect((await search('마지막에 반전이 있는 영상')).items[0].videoId).toBe('meaning0001');
    expect((await search('침착맨')).items[0].videoId).toBe('channel0001');
  });
  it('does not expose internal vector storage to ordinary authenticated or anonymous DB roles',async()=>{
    for(const role of ['authenticated','anon'])await expect(db.begin(async tx=>{
      await tx.unsafe(`set local role ${role}`);await tx`select * from shorts_mvp.short_video_embeddings`;
    })).rejects.toMatchObject({code:'42501'});
  });
});
