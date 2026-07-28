import type { CSSProperties, PointerEventHandler } from "react";
import type { CommentOverlay } from "@/lib/contracts";
import { COMMENT_BACKGROUND_COLOR } from "@/lib/template-config";

export type TemplateCommentTheme = "dark" | "light";
export type TemplateCommentSize = "small" | "medium" | "large";

const sizeScale: Record<TemplateCommentSize, number> = {
  small: 0.82,
  medium: 1,
  large: 1.16,
};

function compactKoreanCount(value: number) {
  const compact = (amount: number) => Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
  if (value >= 10_000) return `${compact(Math.floor(value / 1_000) / 10)}만`;
  if (value >= 1_000) return `${compact(Math.floor(value / 100) / 10)}천`;
  return value.toLocaleString("ko-KR");
}

function ReactionIcon({ kind, color }: { kind: "like" | "dislike"; color: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="-6 -6 112 112"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="9"
      className={kind === "dislike" ? "rotate-180" : undefined}
    >
      <path d="M8 53 25 51 31 45 43 11 47 6 55 7 61 12 63 20 58 42 81 42 91 45 97 51 98 59 94 68 92 77 86 87 78 92 36 92 25 86 13 85 7 80 7 58Z" />
    </svg>
  );
}

function commentAppearance(theme: TemplateCommentTheme, size: TemplateCommentSize) {
  const scale = sizeScale[size];
  const canvasWidth = (value: number) => `${value * scale}cqw`;
  const dark = theme === "dark";
  const foreground = dark ? "#f7f7f8" : "#161619";
  const muted = dark ? "#a5a5aa" : "#6b6b73";
  const identityBlur = `blur(${canvasWidth(0.7)})`;
  const style: CSSProperties = {
    backgroundColor: dark ? COMMENT_BACKGROUND_COLOR : "#ffffff",
    color: foreground,
    padding: `${canvasWidth(3.2)} ${canvasWidth(4.4)} ${canvasWidth(3.4)}`,
  };
  return { canvasWidth, foreground, muted, identityBlur, style };
}

function TemplateCommentContents({
  canvasWidth,
  foreground,
  muted,
  identityBlur,
  comment,
}: ReturnType<typeof commentAppearance> & { comment?: CommentOverlay }) {
  const initial = comment?.initial || "소";
  const nickname = comment?.nickname || "소담기록24";
  const ageLabel = comment?.ageLabel || "2시간 전";
  const text = comment?.text || "잠깐 보려고 눌렀는데 어느새 끝까지 다 봤네 ㅋㅋ";
  const likeCount = comment?.likeCount ?? 121;
  return <span className="flex min-w-0 items-start" style={{ gap: canvasWidth(2.5) }}>
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full bg-[#d84572] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)]"
      style={{ width: canvasWidth(9.4), height: canvasWidth(9.4), fontSize: canvasWidth(3.6), filter: identityBlur, backgroundColor: comment?.avatarColor || "#d84572" }}
    >
      {initial}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center font-semibold" style={{ gap: canvasWidth(1.5), fontSize: canvasWidth(3.15), color: foreground, filter: identityBlur }}>
        <span>{nickname}</span>
        <span aria-hidden="true">·</span>
        <span>{ageLabel}</span>
      </span>
      <span
        className="block break-keep font-medium leading-[1.42] tracking-[-.02em]"
        style={{ marginTop: canvasWidth(1.2), fontSize: canvasWidth(3.62), color: foreground }}
      >
        {text}
      </span>
      <span className="flex items-center font-semibold" style={{ marginTop: canvasWidth(2.1), gap: canvasWidth(4.2), fontSize: canvasWidth(3.1), color: muted }}>
        <span className="flex items-center" style={{ gap: canvasWidth(1.35) }}>
          <span style={{ width: canvasWidth(4.1), height: canvasWidth(4.1) }}><ReactionIcon kind="like" color={foreground} /></span>
          <span>{compactKoreanCount(likeCount)}</span>
        </span>
        <span style={{ width: canvasWidth(4.1), height: canvasWidth(4.1) }}><ReactionIcon kind="dislike" color={foreground} /></span>
        <span>답글</span>
      </span>
    </span>
  </span>;
}

export function TemplateCommentPreview({
  theme,
  size,
  comment,
}: {
  theme: TemplateCommentTheme;
  size: TemplateCommentSize;
  comment?: CommentOverlay | null;
}) {
  if (comment === null) return null;
  const appearance = commentAppearance(theme, size);
  return (
    <div
      aria-label="댓글 미리보기"
      className="relative z-40 block w-full overflow-hidden rounded-none border-0 text-left shadow-none"
      style={appearance.style}
    >
      <TemplateCommentContents {...appearance} comment={comment} />
    </div>
  );
}

export function TemplateCommentPrototype({
  selected,
  theme,
  size,
  onSelect,
  onPointerDown,
}: {
  selected: boolean;
  theme: TemplateCommentTheme;
  size: TemplateCommentSize;
  onSelect: () => void;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
}) {
  const appearance = commentAppearance(theme, size);

  return (
    <button
      type="button"
      aria-label="댓글 레이어 선택 및 세로 이동"
      onClick={onSelect}
      onPointerDown={onPointerDown}
      className={`relative z-40 block w-full cursor-ns-resize appearance-none overflow-hidden rounded-none border-0 text-left shadow-none ${selected ? "outline outline-2 outline-[#ff715e] outline-offset-[-2px]" : ""}`}
      style={appearance.style}
    >
      <TemplateCommentContents {...appearance} />
    </button>
  );
}
