"use client";

import { useId, useState } from "react";
import { communityVideoFrames, communityHeadingColor, communityLegacyHeading } from "@/lib/community-template-contract";
import { snsFontFamily } from "@/lib/sns-editor-fonts";
import type { ComponentProps } from "react";
import type { SnsTemplatePreview } from "./sns-template-preview";

export function CommunityTemplatePreview({ ratio, brandColor, channelName, channelThumbnailUrl,
  thumbnailUrl, content, videoUrl, videoStart = 0, videoEnd, language = "ko",
}: ComponentProps<typeof SnsTemplatePreview>) {
  const clipId = useId();
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const [x, y, width, height] = communityVideoFrames[ratio];
  return <svg viewBox="0 0 1080 1920" role="img" aria-label={`${ratio} 커뮤니티 템플릿 예시`}
    className="aspect-[9/16] w-full overflow-hidden rounded-lg" style={{ fontFamily: snsFontFamily(language, 700) }}>
    <defs><clipPath id={clipId}><circle cx="92" cy="534" r="32" /></clipPath></defs>
    <rect width="1080" height="1920" fill="white" />
    <rect width="1080" height="270" fill={brandColor} />
    <text x="540" y="239" textAnchor="middle" fontSize="96" fontWeight="700" letterSpacing="-3" fill={communityHeadingColor(brandColor)}>
      {content?.boardName ?? (content ? communityLegacyHeading[language] : { ko: "오늘의 화제", en: "Today’s Buzz", ja: "今日の話題" }[language])}</text>
    <text x="60" y="342" fontSize="42" fontWeight="700" fill="#303e78">{{ ko: "실시간 베스트", en: "Trending now", ja: "話題の投稿" }[language]}</text>
    <path d="M0 375H1080" stroke="#303e78" strokeWidth="3" />
    <text x="60" y="462" fontSize="58" fontWeight="700" letterSpacing="-1.5" fill="#111">{content?.title ?? "이 장면이 화제인 이유"}</text>
    <circle cx="92" cy="534" r="32" fill="#eee" />
    {channelThumbnailUrl && failedAvatar !== channelThumbnailUrl
      ? <image href={channelThumbnailUrl} x="60" y="502" width="64" height="64" preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`} onError={() => setFailedAvatar(channelThumbnailUrl)} />
      : <text x="92" y="546" textAnchor="middle" fontSize="30" fill="#333">{(channelName || "채널")[0]}</text>}
    <text x="144" y="548" fontSize="36" fontWeight="700" fill="#444">{channelName.slice(0, 24) || "채널명"}</text>
    <text x="60" y="646" fontSize="46" fontWeight="600" letterSpacing="-1" fill="#222" style={{ fontFamily: snsFontFamily(language, 600) }}>{content?.body[0] ?? "한 번 보면 그냥 지나치기 어려움"}</text>
    <rect x={x} y={y} width={width} height={height} fill="#eee" />
    {videoUrl ? <foreignObject x={x} y={y} width={width} height={height}>
      <video key={videoUrl} src={videoUrl} controls playsInline preload="metadata" aria-label="커뮤니티 편집 영상 미리보기"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onLoadedMetadata={e => { e.currentTarget.currentTime = videoStart; }}
        onPlay={e => { if (e.currentTarget.currentTime < videoStart || (videoEnd && e.currentTarget.currentTime >= videoEnd)) e.currentTarget.currentTime = videoStart; }}
        onTimeUpdate={e => { if (videoEnd && e.currentTarget.currentTime >= videoEnd) { e.currentTarget.pause(); e.currentTarget.currentTime = videoStart; } }} />
    </foreignObject> : thumbnailUrl && <image href={thumbnailUrl} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMid slice" />}
  </svg>;
}
