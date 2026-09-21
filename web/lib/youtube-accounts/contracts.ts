import { z } from "zod";

export const uuid = z.string().uuid();
export const returnPath = z.string().regex(/^\/(?:settings|publish\/channels|projects\/[1-9][0-9]*)$/);
export const startInput = z.object({ returnPath, shortId: uuid.optional(), connectionId: uuid.optional() }).strict();
export type StartInput = z.infer<typeof startInput>;
export type Actor = { userId: string; sessionId: string };
export type Channel = { channelId: string; channelTitle: string };
export type Connection = Channel & { id: string; status: "active" | "disconnected" | "reconnect_required" };
export type Source = { id: string; projectNumber: number; outputS3Key: string; renderVersion: number };
export const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.upload"];
