import { z } from "zod";
import type { TikTokCreatorSnapshot } from "../review-contract";

export const uuid = z.string().uuid();
export const returnPath = z.string().regex(/^\/(?:(?:en|jp)\/)?(?:settings|publish\/channels|projects\/[1-9][0-9]*)$/);
export const startInput = z.object({ returnPath, shortId: uuid.optional() }).strict();
export const scopes = ["user.info.basic", "video.publish"];
export type Actor = { userId: string; sessionId: string };
export type Connection = { id: string; nickname: string; username: string; status: "active" | "reconnect_required" };
export type Creator = TikTokCreatorSnapshot & { nickname: string; username: string };
export type Tokens = { accessToken: string; refreshToken: string; accessExpiresAt: number; refreshExpiresAt: number; openId: string; scopes: string[] };
export const postInput = z.object({
  shortId: uuid, connectionId: uuid, title: z.string().max(2200),
  privacy: z.enum(["SELF_ONLY", "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR"]),
  allowComments: z.boolean(), allowDuet: z.boolean(), allowStitch: z.boolean(),
  discloseCommercialContent: z.boolean(), yourBrand: z.boolean(), brandedContent: z.boolean(),
  musicUsageConfirmed: z.literal(true), brandedContentPolicyConfirmed: z.boolean(),
  rightsConfirmed: z.literal(true), sendToTikTokConfirmed: z.literal(true), isAigc: z.boolean(),
}).strict();
export type PostInput = z.infer<typeof postInput>;
export type Post = { id: string; title: string; status: "initiating" | "processing" | "complete" | "failed" | "unknown"; privacy: string; errorCode: string | null; createdAt: string };
