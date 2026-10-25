import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { indexShortVideoBatch } from "@/lib/short-video-embeddings.mjs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  const expected = Buffer.from(process.env.CRON_SECRET || "");
  const actual = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /,"") || "");
  if (!expected.length || expected.length !== actual.length || !timingSafeEqual(expected,actual)) return Response.json({error:"Unauthorized"},{status:401});
  const apiKey=process.env.RANKING_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
  if (process.env.RANKING_SEMANTIC_SEARCH_ENABLED !== "1" || !apiKey) return Response.json({skipped:true});
  let saved=0,tokens=0;
  const deadline=Date.now()+70_000;
  try {
    for(let i=0;i<8&&Date.now()<deadline;i++) {
      const result=await indexShortVideoBatch(getDb(),{apiKey,limit:128});
      saved+=result.saved;tokens+=result.tokens;if(!result.claimed)break;
    }
    return Response.json({saved,tokens});
  } catch { console.warn("ranking_index_batch_failed"); return Response.json({error:"Indexing temporarily unavailable",saved,tokens},{status:503}); }
}
