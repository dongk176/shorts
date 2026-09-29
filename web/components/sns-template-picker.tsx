"use client";

import { useId } from "react";
import type { VideoAspectRatio } from "@/lib/contracts";
import { templatePresetColors, type TemplatePresetColor } from "@/lib/template-config";
import { contrastingTitleTextColor } from "@/lib/brand-color-contrast";

const frames: Record<VideoAspectRatio, [number, number, number, number]> = {
  "16:9": [60, 774, 960, 540], "5:4": [60, 774, 960, 768],
  "1:1": [60, 690, 960, 960], "4:5": [60, 582, 960, 1200], "9:16": [180, 582, 720, 1280],
};

export function SnsTemplatePicker({ ratio, onRatioChange, brandColor, onBrandColorChange,
  channelName, thumbnailUrl, disabled = false }: {
  ratio: VideoAspectRatio; onRatioChange: (value: VideoAspectRatio) => void;
  brandColor: TemplatePresetColor; onBrandColorChange: (value: TemplatePresetColor) => void;
  channelName: string; thumbnailUrl: string; disabled?: boolean;
}) {
  const clipId = useId();
  const [x, y, width, height] = frames[ratio];
  const portrait = ratio === "4:5" || ratio === "9:16";
  const tall = ratio === "9:16";
  const textX = tall ? 180 : 60;
  return <section className="rounded-2xl border border-white/15 bg-white/[.025] p-5" aria-label="SNS 템플릿 설정">
    <h3 className="text-lg font-bold">SNS 템플릿 <span className="ml-2 text-xs font-medium text-amber-200">관리자 테스트</span></h3>
    <p className="mt-2 text-sm text-neutral-400">흰색 게시물 레이아웃으로 바로 제작합니다. 제목과 본문은 장면에 맞게 생성됩니다.</p>
    <div className="mt-5 flex flex-col gap-6 sm:flex-row">
      <svg viewBox="0 0 1080 1920" role="img" aria-label={`${ratio} SNS 템플릿 예시`}
        className="w-[216px] max-w-full shrink-0 self-center border border-neutral-700 sm:self-start">
        <defs><clipPath id={clipId}><rect x={x} y={y} width={width} height={height} rx={30} /></clipPath></defs>
        <rect width="1080" height="1920" fill="white" />
        <rect x="60" y="150" width="960" height="132" rx="26" fill={brandColor} />
        <text x="540" y="245" textAnchor="middle" fill={contrastingTitleTextColor(brandColor)} fontSize="80" fontWeight="700" letterSpacing="-3">퇴근 1분 전 내 모습</text>
        <rect x={tall ? 60 : 30} y="342" width={tall ? 960 : 1020} height={y+height+30-342} fill="white" stroke="#e2e2e2" strokeWidth="2" />
        <circle cx={textX+44} cy="416" r="43" fill="#eeeeee" stroke="#222" strokeWidth="2" />
        <text x={textX+44} y="431" textAnchor="middle" fontSize="42" fill="#222">{(channelName || "채널")[0]}</text>
        <text x={textX+110} y="435" fontSize="52" fontWeight="700" fill="#111">{channelName.slice(0, 12) || "채널명"}</text>
        <g fontSize="72" fontWeight="600" letterSpacing="-1.7" fill="#111">
          <text x={textX} y="543">{portrait ? "퇴근 얘기에 살아남 ㅋㅋ" : "분명 방금까지 졸렸는데"}</text>
          {!portrait && <text x={textX} y="633">퇴근 얘기에 바로 살아남 ㅋㅋ</text>}
        </g>
        {(ratio === "16:9" || ratio === "5:4") && <text x="60" y="730" fontSize="47" fontWeight="400" fill="#537398">#퇴근본능  #직장인공감  #칼퇴</text>}
        <rect x={x} y={y} width={width} height={height} fill="#ddd" rx={30} />
        <image href={thumbnailUrl} x={x} y={y} width={width} height={height}
          preserveAspectRatio={tall ? "xMidYMid meet" : "xMidYMid slice"} clipPath={`url(#${clipId})`} />
        <g transform={`translate(${x+width-88} ${y+height-88})`}>
          <circle cx="35" cy="35" r="35" fill="#0009" stroke="#ffffffaa" />
          <path d="M18 29H27L36 21V49L27 41H18Z M44 25Q55 35 44 45" fill="white" stroke="white" strokeWidth="3" />
        </g>
      </svg>
      <div className="flex-1 space-y-5">
        <fieldset disabled={disabled}><legend className="mb-3 text-sm font-semibold">영상 비율</legend>
          <div className="flex flex-wrap gap-2">{(Object.keys(frames) as VideoAspectRatio[]).map((value) =>
            <button key={value} type="button" aria-pressed={ratio === value} onClick={() => onRatioChange(value)}
              className={`rounded-lg border px-3 py-2 text-sm ${ratio === value ? "border-[#ff715e] bg-[#ff715e]/15" : "border-white/20"}`}>{value}</button>)}</div>
        </fieldset>
        <fieldset disabled={disabled}><legend className="mb-3 text-sm font-semibold">브랜드 컬러</legend>
          <div className="flex flex-wrap gap-3">{templatePresetColors.map((value) =>
            <button key={value} type="button" aria-label={`브랜드 컬러 ${value}`} aria-pressed={brandColor === value}
              onClick={() => onBrandColorChange(value)} style={{ backgroundColor: value }}
              className={`h-9 w-9 rounded-full border-2 ${brandColor === value ? "border-white ring-2 ring-[#ff715e]" : "border-white/30"}`} />)}</div>
        </fieldset>
        <p className="text-sm leading-6 text-neutral-400">제목 1줄 · 본문 {portrait ? "1줄" : "2줄"}<br />
          {ratio === "16:9" || ratio === "5:4" ? "해시태그 3개" : "채널명·프로필 이미지 포함"}<br />
          생성·재생·다운로드를 테스트할 수 있습니다.</p>
      </div>
    </div>
  </section>;
}
