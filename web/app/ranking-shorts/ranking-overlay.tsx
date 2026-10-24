"use client";

import { memo, useEffect, useState } from "react";
import {
  defaultRankingStyle,
  rankingColors,
  rankingDesign,
  type RankingStyle,
} from "@/lib/ranking-templates";

export const RankingOverlay = memo(function RankingOverlay({
  title,
  subtitle,
  count,
  active,
  labels,
  descending,
  revealedRanks,
  style = defaultRankingStyle,
}: {
  title: string;
  subtitle: string;
  count: number;
  active: number;
  labels: string[];
  descending: boolean;
  revealedRanks?: number[];
  style?: RankingStyle;
}) {
  const layout = rankingDesign.layout;
  const palette = rankingColors(style);
  const family = rankingDesign.fonts[style.font].family;
  const [loadedFamily, setLoadedFamily] = useState("");
  useEffect(() => {
    let alive = true;
    void document.fonts.load(`72px "${family}"`).then(() => {
      if (alive) setLoadedFamily(family);
    });
    return () => {
      alive = false;
    };
  }, [family]);
  const context =
    loadedFamily === family
      ? document.createElement("canvas").getContext("2d")
      : null;
  function width(text: string, size: number) {
    if (!context)
      return (
        Array.from(text).reduce(
          (sum, char) => sum + (/[\u0000-\u007f]/.test(char) ? 0.6 : 1),
          0,
        ) * size
      );
    context.font = `${size}px ${family}`;
    return context.measureText(text).width;
  }
  function fit(text: string, maximum: number, available: number) {
    let size = maximum;
    while (size > 10 && width(text, size) > available) size -= 1;
    return size;
  }
  const top = `TOP${count}`;
  const second = subtitle ? `${subtitle}  ${top}` : top;
  const secondSize = fit(second, 72, layout.titleWidth);
  const secondX = (layout.width - width(second, secondSize)) / 2;
  return (
    <svg
      className="ranking-composition-overlay"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      style={{ fontFamily: family }}
    >
      <path fill="#000" d={`M0 0H${layout.width}V${layout.headerHeight}H0Z`} />
      <text
        x={layout.width / 2}
        y={layout.titleBaseline}
        textAnchor="middle"
        fontSize={fit(title, 72, layout.titleWidth)}
        fill={palette.title}
      >
        {title}
      </text>
      <text
        xmlSpace="preserve"
        x={secondX}
        y={layout.subtitleBaseline}
        fontSize={secondSize}
        fill={palette.subtitle}
      >
        {subtitle ? `${subtitle}  ` : ""}
        <tspan fill={palette.accent}>{top}</tspan>
      </text>
      {Array.from({ length: count }, (_, index) => {
        const revealed = revealedRanks
          ? revealedRanks.includes(index + 1)
          : descending
            ? index >= active
            : index <= active;
        const label = revealed ? labels[index] || "" : "";
        const y =
          layout.rankBaseline +
          index *
            Math.min(
              layout.rankStep,
              (layout.rankBottom - layout.rankBaseline) /
                Math.max(1, count - 1),
            );
        const number = `${index + 1}.`;
        const numberWidth = width(number, 48);
        const gap = 10;
        const labelSize = fit(
          label,
          42,
          layout.rankRight - layout.rankLeft - numberWidth - gap,
        );
        const x =
          style.position === "right"
            ? layout.rankRight -
              numberWidth -
              (label ? width(label, labelSize) + gap : 0)
            : layout.rankLeft;
        return (
          <g
            key={index}
            opacity={index === active ? 1 : rankingDesign.rankAppearance.inactiveOpacity}
            stroke="#080808"
            strokeWidth={layout.rankOutline * 2}
            paintOrder="stroke"
            strokeLinejoin="round"
          >
            <text
              x={x}
              y={y}
              fontSize="48"
              fill={rankingDesign.rankAppearance.colors[index] || rankingDesign.rankAppearance.defaultColor}
            >
              {number}
            </text>
            <text
              x={x + numberWidth + gap}
              y={y}
              fontSize={labelSize}
              fill={rankingDesign.rankAppearance.colors[index] || rankingDesign.rankAppearance.defaultColor}
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
});
