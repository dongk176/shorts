import { transitionSeconds, rankingSoundSchema, rankingMusicSchema } from "./ranking-audio";
import { z } from "zod";
import { defaultRankingStyle, rankingStyleSchema } from "./ranking-templates";

export const RANKING_LIMITS = {
  ranks: 10,
  sourceSeconds: 20 * 60,
  sourceBytes: 250 * 1024 * 1024,
  clipSeconds: 60,
  outputSeconds: 180,
} as const;

export type RankingRemote = {
  url: string;
  platform: "youtube" | "tiktok" | "instagram";
  videoId: string;
};

export type RankingSource = {
  id: string;
  duration: number;
  durationKnown?: boolean;
  width: number;
  height: number;
  hasAudio: boolean;
  previewReady?: boolean;
  remote?: RankingRemote;
};

export const rankingRenderSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(60).default("랭킹"),
    style: rankingStyleSchema.default(defaultRankingStyle),
    descending: z.boolean(),
    transitionSound: rankingSoundSchema.nullable().optional(),
    transitionVersion: z.literal(2).optional(),
    backgroundMusic: rankingMusicSchema.nullable().optional(),
    playbackOrder: z
      .array(z.number().int().min(1).max(RANKING_LIMITS.ranks))
      .min(1)
      .max(RANKING_LIMITS.ranks)
      .optional(),
    rankCount: z.number().int().min(1).max(RANKING_LIMITS.ranks).optional(),
    clips: z
      .array(
        z
          .object({
            rank: z.number().int().min(1).max(RANKING_LIMITS.ranks),
            sourceId: z.uuid(),
            label: z.string().trim().max(60),
            start: z.number().finite().min(0),
            end: z.number().finite().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(RANKING_LIMITS.ranks),
  })
  .strict()
  .superRefine((value, context) => {
    const ranks = value.clips.map((clip) => clip.rank).sort((a, b) => a - b);
    const count = value.rankCount ?? value.clips.length;
    if (
      value.playbackOrder &&
      (value.playbackOrder.length !== ranks.length ||
        new Set(value.playbackOrder).size !== ranks.length ||
        value.playbackOrder.some((rank) => !ranks.includes(rank)))
    ) {
      context.addIssue({
        code: "custom",
        message: "재생 순서에 각 영상을 한 번씩 포함해 주세요.",
      });
    }
    if (
      new Set(ranks).size !== ranks.length ||
      ranks.some((rank) => rank > count)
    ) {
      context.addIssue({
        code: "custom",
        message: "선택한 순위 범위 안에서 영상을 넣어 주세요.",
      });
    }
    let total = transitionSeconds(value.transitionSound, value.clips.length, value.transitionVersion ?? 1);
    for (const clip of value.clips) {
      const duration = clip.end - clip.start;
      total += duration;
      if (duration < 0.5 || duration > RANKING_LIMITS.clipSeconds) {
        context.addIssue({
          code: "custom",
          message: "순위별 사용 구간은 0.5~60초여야 합니다.",
        });
      }
    }
    if (total > RANKING_LIMITS.outputSeconds) {
      context.addIssue({
        code: "custom",
        message: "완성 영상은 총 180초 이하여야 합니다.",
      });
    }
  });

export type RankingRender = z.infer<typeof rankingRenderSchema>;

export function rankingTestEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_RANKING_SHORTS_TEST === "1"
  );
}

export function allowedRankingRequest(request: Request) {
  if (!rankingTestEnabled()) return false;
  const target = new URL(request.url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  if (!loopback.includes(target.hostname)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const host = request.headers.get("host");
  let browserAddress = target;
  if (host) {
    try {
      browserAddress = new URL(`${target.protocol}//${host}`);
      // Next's development server internally rewrites 127.0.0.1 to localhost.
      if (
        !loopback.includes(browserAddress.hostname) ||
        browserAddress.host !== host ||
        browserAddress.port !== target.port ||
        browserAddress.username ||
        browserAddress.password
      )
        return false;
    } catch {
      return false;
    }
  }
  const origin = request.headers.get("origin");
  return !origin || origin === browserAddress.origin;
}

export function rankingTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00.0";
  const tenths = Math.round(Math.max(0, seconds) * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}
