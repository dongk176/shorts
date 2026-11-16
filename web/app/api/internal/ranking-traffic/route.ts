import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { rankingBody } from "@/lib/ranking-access";
import { trafficEventSchema } from "@/lib/media-traffic";
import { saveTrafficEvents } from "@/lib/media-traffic-store";
const schema = z.object({
  project: z.string().uuid(),
  generation: z.string().uuid(),
  events: z.array(trafficEventSchema).min(1).max(50),
  environment: z.enum(["production", "candidate"]),
});
export async function POST(request: Request) {
  try {
    const raw = await rankingBody(request);
    const data = schema.parse(raw);
    const key = process.env.RANKING_TOKEN_SECRET;
    if (!key || key.length < 32) return new Response(null, { status: 503 });
    const secret = createHmac("sha256", key)
      .update(`ranking-vercel-v1.${data.project}.${data.generation}`)
      .digest("hex");
    const expected = createHmac("sha256", secret)
      .update(JSON.stringify(raw))
      .digest("hex");
    // Signature covers the original JSON bytes; Python sends this canonical compact representation.
    const supplied = request.headers.get("x-ranking-traffic-signature") || "";
    if (
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    )
      return new Response(null, { status: 403 });
    const rows =
      await getDb()`select p.user_id from shorts_mvp.ranking_projects p join shorts_mvp.ranking_vercel_sessions s on s.project_id=p.id where p.id=${data.project} and s.generation=${data.generation} and s.expires_at>now()-interval '1 hour'`;
    if (!rows[0]) return new Response(null, { status: 403 });
    if (
      data.events.some(
        (e) =>
          (e.bytes === null && e.purpose !== "source_download") ||
          ![
            "source_download",
            "source_preview",
            "sequence_preview",
            "thumbnail",
            "upload",
            "render_output",
          ].includes(e.purpose),
      )
    )
      return new Response(null, { status: 400 });
    await saveTrafficEvents(
      data.events.filter((e) => e.purpose !== "source_download"),
      {
        userId: rows[0].userId,
        projectId: data.project,
        provider: "vercel_sandbox",
        measurement: "server_write",
        environment: data.environment,
      },
    );
    await saveTrafficEvents(
      data.events.filter((e) => e.purpose === "source_download"),
      {
        userId: rows[0].userId,
        projectId: data.project,
        provider: "vercel_sandbox",
        measurement: "downloader_report",
        environment: data.environment,
      },
    );
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
