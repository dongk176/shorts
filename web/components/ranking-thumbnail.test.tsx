import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RankingThumbnail } from "./ranking-thumbnail";
import { RankingSequencePreview } from "@/app/ranking-shorts/ranking-sequence-preview";
import { defaultRankingStyle } from "@/lib/ranking-templates";
import { rankingYoutubeCovers } from "@/lib/ranking-covers";

describe("ranking visual previews", () => {
  it("uses the completed video without autoplay or source preparation", () => {
    const html = renderToStaticMarkup(<RankingThumbnail lazy={false} videoUrl="/api/ranking-shorts/project/media/result?result=1" />);
    expect(html).toContain('<video');
    expect(html).toContain('preload="metadata"');
    expect(html).not.toContain('autoPlay');
    expect(html).not.toContain('/preview');
  });
  it("uses a public YouTube cover without a worker", () => {
    const html = renderToStaticMarkup(<RankingThumbnail lazy={false} remote={{ platform: "youtube", videoId: "vtQV5zRU71o", url: "https://youtu.be/vtQV5zRU71o" }} />);
    expect(html).toContain('https://i.ytimg.com/vi/vtQV5zRU71o/hqdefault.jpg');
    expect(html).not.toContain('<iframe');
  });
  it("never embeds a blocked TikTok page in the composition cover", () => {
    const html = renderToStaticMarkup(<RankingThumbnail lazy={false} remote={{ platform: "tiktok", videoId: "6718335390845095173", url: "https://www.tiktok.com/@scout2015/video/6718335390845095173" }} />);
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('tiktok.com/player');
    expect(html).toContain('랭킹 쇼츠');
  });
  it("uses an original-aspect cover for composition and keeps bounded public fallbacks", () => {
    const remote = {platform:"youtube" as const,videoId:"w-g1AInuLe8",url:"https://www.youtube.com/shorts/w-g1AInuLe8"};
    const html = renderToStaticMarkup(<RankingThumbnail lazy={false} portrait remote={remote} />);
    expect(html).toContain('/oardefault.jpg');
    expect(rankingYoutubeCovers(remote.videoId,true).map(url=>url.split('/').at(-1))).toEqual(['oardefault.jpg','oar2.jpg','maxresdefault.jpg','mqdefault.jpg']);
    expect(rankingYoutubeCovers('../invalid',true)).toEqual([]);
    expect(html).toContain('object-fit:cover');
  });
  it("shows typed labels even with no source or no playback yet", () => {
    const html = renderToStaticMarkup(<RankingSequencePreview clips={[]} project={null} title="제목" subtitle="순위" count={3} labels={["첫째 장면", "둘째 장면", ""]} descending style={defaultRankingStyle} layoutOnly suspended={false} pauseSignal={0} onStart={() => {}} />);
    expect(html).toContain("첫째 장면");
    expect(html).toContain("둘째 장면");
  });
});
