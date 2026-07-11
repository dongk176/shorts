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
    await db`update shorts_mvp.mvp_sessions set selected_plan_code = ${body.planCode} where id = ${session.id}`;
    return NextResponse.json({ selectedPlanCode: body.planCode, usage: await getUsageSnapshot(db, session.id) });
  } catch (error) { return apiError(error); }
}
