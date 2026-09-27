import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/youtube-quota", () => ({ catalogReadsEnabled: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/youtube-japan-settings", () => ({ japanReadsEnabled: vi.fn().mockResolvedValue(false) }));
import { listSavedVideos, saveVideo, removeSavedVideo } from "./saved-videos-server";
import { catalogId } from "./youtube-catalog";
import { catalogReadsEnabled } from "./youtube-quota";
import { japanReadsEnabled } from "./youtube-japan-settings";
function fakeDb(responses: unknown[][]) {
  const calls: { text: string; params: unknown[] }[] = [];
  const db = Object.assign((strings: TemplateStringsArray,...params: unknown[]) => {
    const text = strings.join("?");
    // Nested availability fragments are composed before the outer query.
    if (text.includes("and c.availability")) return { fragment: text, params };
    calls.push({text,params}); return Promise.resolve(responses.shift() || []);
  }, { begin: async (callback: (tx: unknown) => unknown) => callback(db) });
  return { db: db as unknown as Sql, calls };
}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(catalogReadsEnabled).mockReturnValue(true);});
describe("saved videos storage",()=>{
  it("is idempotent and does not move an existing save to the top",async()=>{
    const {db,calls}=fakeDb([[],[{catalogId:"existing"}]]);
    expect(await saveVideo("owner","abcdefghijk",db)).toEqual({id:catalogId("abcdefghijk")});
    expect(calls).toHaveLength(2);expect(calls[0].text).toContain("for update");
  });
  it("enforces the cap while holding the member lock",async()=>{
    const {db,calls}=fakeDb([[],[],[{count:500}]]);
    await expect(saveVideo("owner","abcdefghijk",db)).rejects.toMatchObject({code:"SAVED_VIDEO_LIMIT"});
    expect(calls.every(c=>!c.text.includes("insert into"))).toBe(true);
  });
  it("rejects missing, stale or unavailable catalog videos",async()=>{
    const {db,calls}=fakeDb([[],[],[{count:0}],[]]);
    await expect(saveVideo("owner","abcdefghijk",db)).rejects.toMatchObject({code:"VIDEO_UNAVAILABLE"});
    const insert=calls.at(-1)!;
    expect(insert.params).toContain("owner");expect(insert.params).toContain("abcdefghijk");
    expect(JSON.stringify(insert.params)).toContain("30 days");
    expect(JSON.stringify(insert.params)).toContain("availability='public'");
    expect(JSON.stringify(insert.params)).toContain("youtube_catalog_regions");
  });
  it("inserts only the account and catalog reference",async()=>{
    const {db,calls}=fakeDb([[],[],[{count:0}],[{catalogId:"new"}]]);
    await saveVideo("owner","abcdefghijk",db);
    expect(calls.at(-1)!.text).toContain("saved_videos(user_id,catalog_id)");
    expect(japanReadsEnabled).toHaveBeenCalledWith(db);
  });
  it("returns a removable placeholder without stale metadata",async()=>{
    const {db,calls}=fakeDb([[{id:"bookmark",savedAt:new Date("2026-09-27"),video:null,verifiedAt:null}]]);
    expect(await listSavedVideos("owner",db)).toEqual([{id:"bookmark",savedAt:"2026-09-27T00:00:00.000Z",video:null}]);
    expect(calls[0].text).toContain("where s.user_id=?");expect(calls[0].text).toContain("else null end as video");
  });
  it("keeps the catalog read kill switch in saved-list visibility",async()=>{
    vi.mocked(catalogReadsEnabled).mockReturnValue(false);
    const {db,calls}=fakeDb([]);await listSavedVideos("owner",db);
    expect(JSON.stringify(calls[0].params)).toContain('"params":[false,false]');
  });
  it("never deletes another account's bookmark",async()=>{
    const {db,calls}=fakeDb([[]]);await removeSavedVideo("owner","catalog",db);
    expect(calls[0]).toEqual({text:"delete from shorts_mvp.saved_videos where user_id=? and catalog_id=?",params:["owner","catalog"]});
  });
});
