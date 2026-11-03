import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { midformAccess } from "@/lib/midform-access";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { session, db } = await midformAccess(request);
    const projects = await db`
      select j.id,j.project_number,j.video_title,j.status,j.progress,j.error_message,
        s.id as short_id,s.status as output_status,s.duration_seconds
      from shorts_mvp.video_jobs j
      left join shorts_mvp.generated_shorts s on s.job_id=j.id and s.deleted_at is null
        and s.expires_at > now()
      where j.user_id=${session.userId} and j.midform_request is not null
        and j.user_deleted_at is null and j.status not in ('deleted','expired')
        and (j.expires_at is null or j.expires_at > now())
      order by j.created_at desc limit 30
    `;
    return NextResponse.json({ projects }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
