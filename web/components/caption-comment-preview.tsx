"use client";

import { useEffect, useId, useState } from "react";
import type { CommentOverlay, OutputLanguage } from "@/lib/contracts";
import { commentActionLabels } from "@/lib/content-language";
import { wrapCaptionComment } from "@/lib/caption-comment-preview";

export function CaptionCommentPreview({ comment, theme, outputLanguage }: {
  comment: CommentOverlay | null;
  theme: "dark" | "light";
  outputLanguage: OutputLanguage;
}) {
  const id = useId();
  const family = outputLanguage === "ja" ? '"Editor Noto Sans JP"' : '"Editor Noto Sans KR"';
  const actions = commentActionLabels(comment?.likeCount || 0, outputLanguage);
  const [metrics, setMetrics] = useState<{ key: string; lines: string[]; ascent: number; actionAscent: number; metaAscent: number; likesWidth: number } | null>(null);
  const text = comment?.text || "";
  const key = `${family}:${text}:${actions.likes}`;
  useEffect(() => {
    let cancelled = false;
    const measure = () => {
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      context.font = `400 35px ${family}`;
      const lines = wrapCaptionComment(text, (value) => context.measureText(value).width);
      const ascent = Math.ceil(context.measureText(text || "Ag").fontBoundingBoxAscent || 41);
      context.font = `400 28px ${family}`;
      const likesWidth = context.measureText(actions.likes).width;
      const actionAscent = Math.ceil(context.measureText(actions.likes).fontBoundingBoxAscent || 33);
      context.font = `700 30px ${family}`;
      const metaAscent = Math.ceil(context.measureText("Ag").fontBoundingBoxAscent || 35);
      if (!cancelled) setMetrics({ key, lines, ascent, actionAscent, metaAscent, likesWidth });
    };
    measure();
    // Font loading affects preview only; it never blocks editing or creation.
    void Promise.all([document.fonts.load(`400 35px ${family}`), document.fonts.load(`700 30px ${family}`)])
      .then(measure).catch(() => {});
    return () => { cancelled = true; };
  }, [actions.likes, family, key, text]);
  if (!comment) return null;
  const measured = metrics?.key === key ? metrics : null;
  const lines = measured?.lines || wrapCaptionComment(text, (value) => Array.from(value).reduce((n, c) => n + (/[^\x00-\x7F]/u.test(c) ? 35 : 18), 0));
  const dark = theme === "dark";
  const actionY = 101 + lines.length * 47 + 17;
  const dislikeX = 145 + 34 + 30 + (measured?.likesWidth ?? actions.likes.length * 16);
  const icon = (x: number, down = false) => <svg x={x} y={actionY} width="34" height="34" viewBox="0 0 100 100">
    <path transform={down ? "rotate(180 50 50)" : undefined} d="M8 53 25 51 31 45 43 11 47 6 55 7 61 12 63 20 58 42 81 42 91 45 97 51 98 59 94 68 92 77 86 87 78 92 36 92 25 86 13 85 7 80 7 58Z" fill="none" stroke={dark ? "#F1F1F1" : "#18181B"} strokeWidth="9" strokeLinejoin="round" />
  </svg>;
  return <svg aria-label="댓글 미리보기" data-caption-comment-preview viewBox="0 0 1080 285" className="block w-full" style={{ fontFamily: family }}>
    <defs><filter id={`${id}-identity`} x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="4.5" /></filter></defs>
    <rect width="1080" height="285" fill={dark ? "#040404" : "#FFFFFF"} fillOpacity={dark ? 244 / 255 : 1} />
    <g filter={`url(#${id}-identity)`}>
      <circle cx="80" cy="84" r="36" fill={comment.avatarColor} />
      <text x="80" y="84" dominantBaseline="central" textAnchor="middle" fontSize="34" fontWeight="700" fill="white">{comment.initial}</text>
      <text x="145" y={48 + (measured?.metaAscent ?? 35)} fontSize="30" fontWeight="700" fill={dark ? "#F0F0F0" : "#18181B"}>@{comment.nickname}  {comment.ageLabel}</text>
    </g>
    <g fontWeight="400">
      {lines.map((line, index) => <text key={index} x="145" y={101 + index * 47 + (measured?.ascent ?? 41)} fontSize="35" fill={dark ? "#E8E8E8" : "#18181B"}>{line}</text>)}
      {icon(145)}{icon(dislikeX, true)}
      <text x="191" y={actionY - 2 + (measured?.actionAscent ?? 33)} fontSize="28" fill={dark ? "#BEBEBE" : "#6B6B73"}>{actions.likes}</text>
      <text x={dislikeX + 70} y={actionY - 2 + (measured?.actionAscent ?? 33)} fontSize="28" fill={dark ? "#C4C4C4" : "#6B6B73"}>{actions.reply}</text>
    </g>
  </svg>;
}
