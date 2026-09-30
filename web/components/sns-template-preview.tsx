"use client";

import { useId, useState } from "react";
import type { VideoAspectRatio } from "@/lib/contracts";
import { type TemplatePresetColor } from "@/lib/template-config";
import { contrastingTitleTextColor } from "@/lib/brand-color-contrast";

const frames: Record<VideoAspectRatio, [number, number, number, number]> = {
  "16:9": [60, 774, 960, 540], "5:4": [60, 774, 960, 768],
  "1:1": [60, 690, 960, 960], "4:5": [60, 582, 960, 1200], "9:16": [180, 582, 720, 1280],
};

export function SnsTemplatePreview({ ratio, brandColor, channelName, channelThumbnailUrl, thumbnailUrl }: {
  ratio: VideoAspectRatio;
  brandColor: TemplatePresetColor;
  channelName: string;
  channelThumbnailUrl: string | null;
  thumbnailUrl: string;
}) {
  const clipId = useId();
  const avatarClipId = useId();
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [x, y, width, height] = frames[ratio];
  const portrait = ratio === "4:5" || ratio === "9:16";
  const tall = ratio === "9:16";
  const textX = tall ? 180 : 60;
  return (
      <svg viewBox="0 0 1080 1920" role="img" aria-label={`${ratio} SNS 템플릿 예시`}
        className="aspect-[9/16] w-full overflow-hidden rounded-lg">
        <defs>
          <clipPath id={clipId}><rect x={x} y={y} width={width} height={height} rx={30} /></clipPath>
          <clipPath id={avatarClipId}><circle cx={textX+44} cy="416" r="40" /></clipPath>
        </defs>
        <rect width="1080" height="1920" fill="white" />
        <rect x="60" y="150" width="960" height="132" rx="26" fill={brandColor} />
        <text x="540" y="245" textAnchor="middle" fill={contrastingTitleTextColor(brandColor)} fontSize="80" fontWeight="700" letterSpacing="-3">퇴근 1분 전 내 모습</text>
        <rect x={tall ? 60 : 30} y="342" width={tall ? 960 : 1020} height={y+height+30-342} fill="white" stroke="#e2e2e2" strokeWidth="2" />
        <circle cx={textX+44} cy="416" r="43" fill="#eeeeee" stroke="#222" strokeWidth="2" />
        {channelThumbnailUrl && failedAvatarUrl !== channelThumbnailUrl
          ? <image href={channelThumbnailUrl} aria-label={`${channelName} 채널 사진`}
              x={textX+4} y="376" width="80" height="80" preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${avatarClipId})`} onError={() => setFailedAvatarUrl(channelThumbnailUrl)} />
          : <text x={textX+44} y="431" textAnchor="middle" fontSize="42" fill="#222">{(channelName || "채널")[0]}</text>}
        <text x={textX+110} y="435" fontSize="52" fontWeight="700" fill="#111">{channelName.slice(0, 12) || "채널명"}</text>
        <g fontSize="72" fontWeight="600" letterSpacing="-1.7" fill="#111">
          <text x={textX} y="543">{portrait ? "퇴근 얘기에 살아남 ㅋㅋ" : "분명 방금까지 졸렸는데"}</text>
          {!portrait && <text x={textX} y="633">퇴근 얘기에 바로 살아남 ㅋㅋ</text>}
        </g>
        {(ratio === "16:9" || ratio === "5:4") && <text x="60" y="730" fontSize="47" fontWeight="400" fill="#537398">#퇴근본능  #직장인공감  #칼퇴</text>}
        <rect x={x} y={y} width={width} height={height} fill="#ddd" rx={30} />
        <image href={thumbnailUrl} x={x} y={y} width={width} height={height}
          preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
        <g transform={`translate(${x+width-88} ${y+height-88})`}>
          <circle cx="35" cy="35" r="35" fill="#0009" stroke="#ffffffaa" />
          <path d="M18 29H27L36 21V49L27 41H18Z M44 25Q55 35 44 45" fill="white" stroke="white" strokeWidth="3" />
        </g>
      </svg>
  );
}
