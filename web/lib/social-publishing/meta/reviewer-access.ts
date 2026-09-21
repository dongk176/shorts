import "server-only";
import { z } from "zod";
import { metaConfig } from "./config";
import { uuid } from "./contracts";

const grantSchema = z.object({
  userId: uuid,
  shortId: uuid,
  expiresAt: z.string().datetime(),
}).strict();

// Server configuration grants one non-admin reviewer one owned test video.
// Never accept this grant from a request, session claim, email or user metadata.
export function metaReviewerGrant(env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  try {
    metaConfig("instagram", env);
    const grant = grantSchema.parse(JSON.parse(env.META_REVIEWER_ACCESS || ""));
    if (Date.parse(grant.expiresAt) <= now) return null;
    return grant;
  } catch {
    return null;
  }
}
