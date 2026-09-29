import { afterEach, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/youtube-quota", () => ({withYoutubePurpose: (_purpose: string, _db: unknown, run: () => unknown) => run(), youtubeRequest: vi.fn()}));
import { youtubeRequest } from "@/lib/youtube-quota";
import { attributionDescription } from "./attribution";
import { sourceAttribution } from "./attribution-server";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const source={title:"[FULL] Original video",author:"Original channel",url:"https://www.youtube.com/watch?v=F-Dp78NJwlU",ccBy:true};
it("includes source title, author, URLs and modification notice as plain text",()=>{
 const text=attributionDescription(source);
 expect(text).toContain("Original channel — [FULL] Original video\nhttps://www.youtube.com/watch?v=F-Dp78NJwlU");
 expect(text).toContain("CC BY · https://www.youtube.com/t/creative_commons");
 expect(text).toContain("원본을 발췌해 세로 영상으로 편집했어요.");
 expect(text).not.toContain("](");
});
it("does not claim CC BY for standard, unverified or uploaded sources",()=>{
 expect(attributionDescription({...source,ccBy:false})).not.toContain("CC BY");
 expect(attributionDescription(null)).toBe("");
 expect(attributionDescription({...source,title:"<source>"})).not.toContain("<");
});
it("uses fresh catalogue attribution without a provider request and binds the owner",async()=>{
 const query=vi.fn(async()=>[{youtubeVideoId:"F-Dp78NJwlU",metadata:{title:source.title,channelName:source.author,license:"creativeCommon"}}]);
 expect(await sourceAttribution(query as unknown as Sql,"owner-a","short-a")).toEqual(source);
 expect(query).toHaveBeenCalledWith(expect.any(Array),"short-a","owner-a","owner-a");
 expect(youtubeRequest).not.toHaveBeenCalled();
});
it("omits a license claim if the provider cannot verify it",async()=>{
 vi.stubEnv("YOUTUBE_API_KEY","test-only");vi.mocked(youtubeRequest).mockRejectedValue(Error("provider failure"));
 const db=vi.fn(async()=>[{youtubeVideoId:"F-Dp78NJwlU",title:source.title,author:source.author}]) as unknown as Sql;
 expect(await sourceAttribution(db,"a","s")).toEqual({...source,ccBy:false});
});
it("checks missing catalogue data against the matching public video",async()=>{
 vi.stubEnv("YOUTUBE_API_KEY","test-only");vi.mocked(youtubeRequest).mockResolvedValue(Response.json({items:[{id:"F-Dp78NJwlU",snippet:{title:source.title,channelTitle:source.author},status:{privacyStatus:"public",license:"creativeCommon"}}]}));
 const db=vi.fn(async()=>[{youtubeVideoId:"F-Dp78NJwlU"}]) as unknown as Sql;
 expect(await sourceAttribution(db,"a","s")).toEqual(source);
});
