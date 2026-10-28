import { z } from "zod";

export const platformSchema = z.enum(["instagram", "threads"]);
export type MetaPlatform = z.infer<typeof platformSchema>;
export const uuid = z.string().uuid();
export const returnPath = z.string().regex(/^\/(?:(?:en|jp)\/)?(?:projects\/[1-9][0-9]*|publish\/channels)$/);
export const startInput = z.object({ returnPath, shortId: uuid.optional() }).strict().refine(input => input.shortId || /^\/(?:(?:en|jp)\/)?publish\/channels$/.test(input.returnPath));
export type Actor = { userId: string; sessionId: string };
export type Connection = { id: string; nickname: string; username: string; status: "active" | "reconnect_required" };
export type Tokens = { accessToken: string; expiresAt: number; openId: string; scopes: string[] };
export const postInput = z.object({
  shortId: uuid, connectionId: uuid, title: z.string().max(2200),
  rightsConfirmed: z.literal(true), publishConfirmed: z.literal(true),
}).strict();
export type PostInput = z.infer<typeof postInput>;
export type Post = { id: string; connectionId: string; title: string; status: "initiating" | "processing" | "complete" | "failed" | "unknown"; privacy: string; url: string | null; errorCode: string | null; createdAt: string };
