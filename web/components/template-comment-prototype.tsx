import type { CSSProperties, PointerEventHandler } from "react";

export type TemplateCommentTheme = "dark" | "light";
export type TemplateCommentSize = "small" | "medium" | "large";

const sizeScale: Record<TemplateCommentSize, number> = {
  small: 0.82,
  medium: 1,
  large: 1.16,
};

function ReactionIcon({ kind, color }: { kind: "like" | "dislike"; color: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      className={kind === "dislike" ? "rotate-180" : undefined}
    >
      <path d="M7.2 10.2 10.5 3c.3-.7 1.1-1.1 1.8-.8.8.3 1.2 1.1 1 1.9l-1 4.1h5.4c1.7 0 2.9 1.6 2.4 3.2l-2.1 7a2.5 2.5 0 0 1-2.4 1.8H7.2" />
      <path d="M3.5 9.2h3.7v11H3.5z" />
    </svg>
  );
}

export function TemplateCommentPrototype({
  selected,
  theme,
  size,
  y,
  onSelect,
  onPointerDown,
}: {
  selected: boolean;
  theme: TemplateCommentTheme;
  size: TemplateCommentSize;
  y: number;
  onSelect: () => void;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
}) {
  const scale = sizeScale[size];
  const canvasWidth = (value: number) => `${value * scale}cqw`;
  const dark = theme === "dark";
  const foreground = dark ? "#f7f7f8" : "#161619";
  const muted = dark ? "#a5a5aa" : "#6b6b73";
  const style: CSSProperties = {
    top: `${(y / 1920) * 100}%`,
    backgroundColor: dark ? "#09090b" : "#ffffff",
    color: foreground,
    padding: `${canvasWidth(3.2)} ${canvasWidth(4.4)} ${canvasWidth(3.4)}`,
  };

  return (
    <button
      type="button"
      aria-label="댓글 레이어 선택 및 세로 이동"
      onClick={onSelect}
      onPointerDown={onPointerDown}
      className={`absolute inset-x-0 z-40 w-full cursor-ns-resize appearance-none overflow-hidden rounded-none border-0 text-left shadow-none ${selected ? "outline outline-2 outline-[#ff715e] outline-offset-[-2px]" : ""}`}
      style={style}
    >
      <span className="flex min-w-0 items-start" style={{ gap: canvasWidth(2.5) }}>
        <span
          aria-hidden="true"
          className="shrink-0 rounded-full bg-[radial-gradient(circle_at_38%_32%,#ffafbd_0,#ef4770_38%,#a50d7c_72%,#6a075b_100%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)]"
          style={{ width: canvasWidth(9.4), height: canvasWidth(9.4) }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center font-semibold" style={{ gap: canvasWidth(1.5), fontSize: canvasWidth(3.15), color: muted }}>
            <span className="blur-[.45px]">예능하는 여자</span>
            <span aria-hidden="true">·</span>
            <span>1일 전</span>
          </span>
          <span
            className="block break-keep font-medium leading-[1.42] tracking-[-.02em]"
            style={{ marginTop: canvasWidth(1.2), fontSize: canvasWidth(3.62), color: foreground }}
          >
            난 진짜 난다긴다 하는 개그맨들보다 데프콘이 가장 웃긴거 같음
          </span>
          <span className="flex items-center font-semibold" style={{ marginTop: canvasWidth(2.1), gap: canvasWidth(4.2), fontSize: canvasWidth(3.1), color: muted }}>
            <span className="flex items-center" style={{ gap: canvasWidth(1.35) }}>
              <span style={{ width: canvasWidth(4.1), height: canvasWidth(4.1) }}><ReactionIcon kind="like" color={foreground} /></span>
              <span>2.1만</span>
            </span>
            <span style={{ width: canvasWidth(4.1), height: canvasWidth(4.1) }}><ReactionIcon kind="dislike" color={foreground} /></span>
            <span style={{ color: foreground }}>답글</span>
          </span>
        </span>
      </span>
    </button>
  );
}
