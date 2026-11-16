import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { saveTrafficEvents } from "@/lib/media-traffic-store";
import { trafficEnvironment } from "@/lib/media-traffic";
import { trafficPurpose } from "@/lib/media-traffic";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { getShortDownloadUrl, getShortPlaybackAccess } from "@/lib/aws";
import {
  requireRankingUser,
  requireRankingProject,
  rankingUuid,
  rankingError,
} from "@/lib/ranking-access";
import { rankingReceiverAccess } from "@/lib/ranking-runtime";
import { rankingVercelAccess } from "@/lib/ranking-vercel";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string; sourceId: string }> },
) {
  try {
    const admin = await requireRankingUser(request);
    const { projectId, sourceId } = await params;
    const project = await requireRankingProject(projectId, admin.id);
    rankingUuid(sourceId);
    const query = new URL(request.url).searchParams;
    let url: string;
    if (query.get("result") === "1") {
      const rows =
        await getDb()`select result from shorts_mvp.ranking_operations where id=${sourceId} and project_id=${projectId} and action='render' and status='succeeded'`;
      const output = rows[0]?.result;
      if (!output?.outputKey)
        throw new HttpError(404, "완성 영상을 찾을 수 없습니다.");
      const expected = `outputs/ranking/${projectId}/${sourceId}.mp4`;
      if (output.outputKey !== expected)
        throw new HttpError(404, "완성 영상을 찾을 수 없습니다.");
      url =
        query.get("download") === "1"
          ? await getShortDownloadUrl(expected, "ranking-shorts.mp4", 300)
          : (
              await getShortPlaybackAccess({
                outputKey: expected,
                thumbnailKey: null,
                expiresAt: project.expiresAt,
              })
            ).url;
    } else {
      const sources =
        await getDb()`select id,task_id from shorts_mvp.ranking_sources where id=${sourceId} and project_id=${projectId} and status='ready' and expires_at>now()`;
      if (!sources[0])
        throw new HttpError(
          410,
          "미리보기가 만료되었습니다. 영상을 다시 추가해 주세요.",
        );
      url = sources[0].taskId?.startsWith("vercel:")
        ? (await rankingVercelAccess("GET", projectId, sourceId, admin.id)).url
        : rankingReceiverAccess("GET", projectId, sourceId, admin.id).url;
    }
    if(query.get("result")==="1") after(async()=>{
      try { await saveTrafficEvents([{id:randomUUID(),resource:sourceId,purpose:query.get("download")==="1"?"result_download":"result_playback",bytes:null,interrupted:false}],{userId:admin.id,projectId,provider:"aws_cloudfront",measurement:"unmeasured",environment:trafficEnvironment(new URL(request.url).hostname)}); } catch { console.warn("media_traffic_record_failed"); }
    });
    if(query.get("result")!=="1") { const target=new URL(url); target.searchParams.set("purpose",trafficPurpose(query.get("purpose")));url=target.toString(); }
    return new Response(null, {
      status: 307,
      headers: {
        Location: url,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return rankingError(error);
  }
}
