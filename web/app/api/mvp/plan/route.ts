import { NextResponse } from "next/server";
import { z } from "zod";
import { planCodes } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireMvpSession } from "@/lib/session";
import { getUsageSnapshot } from "@/lib/usage";

const schema = z.object({ planCode: z.enum(planCodes) });

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const session = await requireMvpSession();
    const db = getDb();
    if (session.userId) {
      await db.begin(async (tx) => {
        await tx`update shorts_mvp.app_users set selected_plan_code=${body.planCode} where id=${session.userId}`;
        await tx`update shorts_mvp.mvp_sessions set selected_plan_code=${body.planCode} where user_id=${session.userId}`;
      });
    } else {
      await db`update shorts_mvp.mvp_sessions set selected_plan_code=${body.planCode} where id=${session.id} and user_id is null`;
    }
    return NextResponse.json({
      selectedPlanCode: body.planCode,
      usage: await getUsageSnapshot(db, { ...session, selectedPlanCode: body.planCode }),
    });
  } catch (error) { return apiError(error); }
}
