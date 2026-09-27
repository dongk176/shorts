import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/youtube-quota", () => ({ catalogReadsEnabled: () => true, japaneseDiscoveryEnabled: () => false }));
import { listSavedVideos, saveVideo, removeSavedVideo } from "./saved-videos-server";
import { catalogId } from "./youtube-catalog";

// Explicit opt-in. Fixtures and even the new DDL are rolled back together.
it.skipIf(process.env.SAVED_VIDEOS_DB_TEST !== "1")("persists, isolates and removes bookmarks against PostgreSQL without leaving test data", async () => {
  const url = new URL(process.env.SAVED_VIDEOS_TEST_DATABASE_URL || "");
  // This harness cannot connect to a cloud/production database.
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.port).toBe("55439");
  expect(url.pathname).toBe("/saved_videos_test");
  expect(url.username).toBe("saved_videos_test");
  const db=postgres(url.toString(),{max:1,prepare:false,connect_timeout:10,transform:postgres.camel,connection:{application_name:"saved-videos-local-verification",statement_timeout:10000,lock_timeout:2000}});
  const owner=randomUUID(),other=randomUUID(),videoId=randomBytes(9).toString("base64url").slice(0,11),id=catalogId(videoId);
  const rollback=new Error("EXPECTED_ROLLBACK");
  try {
    await db.unsafe(`create schema if not exists shorts_mvp;
      do $$ begin create role anon; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role; exception when duplicate_object then null; end $$;
      create table if not exists shorts_mvp.app_users(id uuid primary key);
      create table if not exists shorts_mvp.youtube_catalog(id text primary key,video_id text unique,metadata jsonb,first_discovered_at timestamptz not null,verified_at timestamptz not null,availability text not null default 'public');
      create table if not exists shorts_mvp.youtube_catalog_regions(catalog_id text references shorts_mvp.youtube_catalog(id),region_code text);
      grant usage on schema shorts_mvp to anon,authenticated,service_role;`);
    const [identityRow]=await db`select current_database() as database,current_user as role,to_regclass('shorts_mvp.youtube_catalog')::text as catalog`;
    expect(identityRow).toMatchObject({database:"saved_videos_test",catalog:"shorts_mvp.youtube_catalog"});
    await expect(db.begin(async tx=>{
      const migration=readFileSync(new URL("../../supabase/migrations/202609270002_saved_videos.sql",import.meta.url),"utf8").replace(/^begin;\s*/i,"").replace(/commit;\s*$/i,"");
      await tx.unsafe(migration,[],{prepare:false});
      await tx`insert into shorts_mvp.app_users(id) values(${owner}),(${other})`;
      const video={videoId,title:"Saved video verification fixture",channelName:"Test fixture",category:"howto",durationSeconds:240,viewCount:1,publishedAt:new Date().toISOString(),thumbnailUrl:`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,license:"youtube"};
      await tx`insert into shorts_mvp.youtube_catalog(id,video_id,metadata,first_discovered_at,verified_at) values(${id},${videoId},${tx.json(video)},now(),now())`;
      const adapter=Object.assign((strings:TemplateStringsArray,...values:unknown[])=>tx(strings,...values as never[]),{begin:async (fn:(sql:unknown)=>unknown)=>fn(tx)}) as unknown as Sql;
      await saveVideo(owner,videoId,adapter);
      await saveVideo(owner,videoId,adapter);
      const first=await listSavedVideos(owner,tx);
      expect(first).toHaveLength(1);expect(first[0].video?.title).toBe(video.title);
      expect(await listSavedVideos(other,tx)).toEqual([]);
      await removeSavedVideo(other,id,tx);
      expect(await listSavedVideos(owner,tx)).toHaveLength(1);
      await tx`update shorts_mvp.youtube_catalog set verified_at=now()-interval '31 days' where id=${id}`;
      expect((await listSavedVideos(owner,tx))[0].video).toBeNull();
      await expect(saveVideo(other,videoId,adapter)).rejects.toMatchObject({code:"VIDEO_UNAVAILABLE"});
      await tx`update shorts_mvp.youtube_catalog set verified_at=now(),availability='unavailable' where id=${id}`;
      expect((await listSavedVideos(owner,tx))[0].video).toBeNull();
      await removeSavedVideo(owner,id,tx);await removeSavedVideo(owner,id,tx);
      expect(await listSavedVideos(owner,tx)).toEqual([]);
      const [policy]=await tx`select relrowsecurity as rls,has_table_privilege('anon','shorts_mvp.saved_videos','SELECT') as anon_read,has_table_privilege('authenticated','shorts_mvp.saved_videos','INSERT') as authenticated_write from pg_class where oid='shorts_mvp.saved_videos'::regclass`;
      expect(policy).toMatchObject({rls:true,anonRead:false,authenticatedWrite:false});
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await db`select id from shorts_mvp.app_users where id in (${owner},${other})`).toHaveLength(0);
    expect(await db`select id from shorts_mvp.youtube_catalog where id=${id}`).toHaveLength(0);
  } finally { await db.end({timeout:2}); }
},30000);
