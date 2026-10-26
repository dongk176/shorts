import type { ReactNode } from "react";
import { rankingFramingGeometry, type RankingFraming } from "@/lib/ranking-framing";

export function RankingFramedMedia({ width, height, framing, children }: {
  width: number; height: number; framing?: RankingFraming; children: ReactNode;
}) {
  const geometry = rankingFramingGeometry(width, height, framing);
  return <div className="ranking-framed-region"><div className="ranking-framed-window" style={geometry.window}>
    <div className="ranking-framed-original" style={geometry.media}>{children}</div>
  </div></div>;
}
