"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";
import { useI18n } from "@/lib/i18n/provider";

import { EditorPreviewVideo, type EditorPreviewPlayback } from "./editor-preview-video";
import { CommunityTemplatePreview } from "./community-template-preview";
import { useEffect, useId, useState } from "react";
import { loadSnsFonts, snsFontFamily } from "@/lib/sns-editor-fonts";
import type { SnsLanguage } from "@/lib/sns-editor-contract";
import type { VideoAspectRatio } from "@/lib/contracts";
import { contrastingTitleTextColor } from "@/lib/brand-color-contrast";

export const snsVideoFrames: Record<VideoAspectRatio, [number, number, number, number]> = {
  "16:9": [60, 774, 960, 540], "5:4": [60, 774, 960, 768],
  "1:1": [60, 690, 960, 960], "4:5": [60, 582, 960, 1200], "9:16": [180, 582, 720, 1280],
};

export function SnsTemplatePreview({ community = false, ratio, brandColor, channelName, channelThumbnailUrl, thumbnailUrl, content, videoUrl, videoStart = 0, videoEnd, language: contentLanguage, ...playback }: EditorPreviewPlayback & {
  community?: boolean;
  language?: SnsLanguage;
  ratio: VideoAspectRatio;
  brandColor: string;
  channelName: string;
  channelThumbnailUrl: string | null;
  thumbnailUrl: string;
  content?: { boardName?: string; title: string; body: string[]; hashtags: string[] };
  videoUrl?: string;
  videoStart?: number;
  videoEnd?: number;
}) {
  const { locale } = useI18n();
  const language = contentLanguage ?? locale;
  const sample = {
    ko: { title: "다시 보게 되는 순간", lead: "무심코 넘기려다가", body: "끝까지 보게 되는 장면", channel: "채널명", hashtags: "#하이라이트  #오늘의영상  #쇼츠" },
    en: { title: "Worth another look", lead: "I almost scrolled past", body: "Then watched it all", channel: "Channel", hashtags: "#Highlights  #VideoOfTheDay  #Shorts" },
    ja: { title: "もう一度見たくなる瞬間", lead: "何気なく見始めたら", body: "つい見入ってしまう", channel: "チャンネル名", hashtags: "#ハイライト  #今日の動画  #ショート" },
  }[language];
  useEffect(() => { void loadSnsFonts(language).catch(() => {}); }, [language]);
  const ui = useUiText();
  const clipId = useId();
  const avatarClipId = useId();
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [x, y, width, height] = snsVideoFrames[ratio];
  const portrait = ratio === "4:5" || ratio === "9:16";
  const tall = ratio === "9:16";
  const textX = tall ? 180 : 60;
  const offsetY = portrait ? 0 : 150;
  if (community) return <CommunityTemplatePreview {...playback} {...{ ratio, brandColor, channelName, channelThumbnailUrl, thumbnailUrl, content, videoUrl, videoStart, videoEnd, language }} />;
  return (
      <svg data-i18n-content="" viewBox="0 0 1080 1920" role="img" aria-label={ui(`${ratio} SNS 템플릿 예시`)}
        className="aspect-[9/16] w-full overflow-hidden rounded-lg" style={{ fontFamily: snsFontFamily(language, 700) }}>
        <defs>
          <clipPath id={clipId}><rect x={x} y={y} width={width} height={height} rx={30} /></clipPath>
          <clipPath id={avatarClipId}><circle cx={textX+44} cy="416" r="40" /></clipPath>
        </defs>
        <rect width="1080" height="1920" fill="white" />
        <g transform={`translate(0 ${offsetY})`}>
        <rect x="60" y="150" width="960" height="132" rx="26" fill={brandColor} />
        <text x="540" y="245" textAnchor="middle" fill={contrastingTitleTextColor(brandColor)} fontSize="80" fontWeight="700" letterSpacing="-3">{content?.title ?? sample.title}</text>
        <rect x={tall ? 60 : 30} y="342" width={tall ? 960 : 1020} height={y+height+30-342} fill="white" stroke="#e2e2e2" strokeWidth="2" />
        <circle cx={textX+44} cy="416" r="43" fill="#eeeeee" stroke="#222" strokeWidth="2" />
        {channelThumbnailUrl && failedAvatarUrl !== channelThumbnailUrl
          ? <image href={channelThumbnailUrl} aria-label={`${channelName} · ${ui("채널 사진")}`}
              x={textX+4} y="376" width="80" height="80" preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${avatarClipId})`} onError={() => setFailedAvatarUrl(channelThumbnailUrl)} />
          : <text x={textX+44} y="431" textAnchor="middle" fontSize="42" fill="#222">{(channelName || sample.channel)[0]}</text>}
        <text x={textX+110} y="435" fontSize="52" fontWeight="700" fill="#111">{channelName.slice(0, 12) || sample.channel}</text>
        <g style={{ fontFamily: snsFontFamily(language, 600) }} fontSize="72" fontWeight="600" letterSpacing="-1.7" fill="#111">
          <text x={textX} y="543">{content?.body[0] ?? (portrait ? sample.body : sample.lead)}</text>
          {!portrait && <text x={textX} y="633">{content?.body[1] ?? sample.body}</text>}
        </g>
        {(ratio === "16:9" || ratio === "5:4") && <text style={{ fontFamily: snsFontFamily(language, 400) }} x="60" y="730" fontSize="47" fontWeight="400" fill="#537398">{content?.hashtags.join("  ") ?? sample.hashtags}</text>}
        <rect x={x} y={y} width={width} height={height} fill="#ddd" rx={30} />
        {videoUrl ? <foreignObject x={x} y={y} width={width} height={height} clipPath={`url(#${clipId})`}>
          <EditorPreviewVideo key={videoUrl} src={videoUrl} start={videoStart} end={videoEnd}
            label={ui("SNS 편집 영상 미리보기")} {...playback} />
        </foreignObject> : <image href={thumbnailUrl || undefined} x={x} y={y} width={width} height={height}
          preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} /> }
        <g pointerEvents="none" transform={`translate(${x+width-88} ${y+height-88})`}>
          <circle cx="35" cy="35" r="35" fill="#0009" stroke="#ffffffaa" />
          <path d="M18 29H27L36 21V49L27 41H18Z M44 25Q55 35 44 45" fill="white" stroke="white" strokeWidth="3" />
        </g>
        </g>
      </svg>
  );
}
