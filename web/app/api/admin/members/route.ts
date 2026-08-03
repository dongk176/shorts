import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { loadAdminMembers } from "@/lib/admin-members";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  q: z.string().trim().max(100).default(""),
  memberType: z.enum([
    "all",
    "free",
    "paid_active",
    "paid_attention",
    "paid_inactive",
  ]).default("all"),
  memberPlan: z.enum(["all", "monthly", "starter", "expert"]).default("all"),
  memberActivity: z.enum([
    "all",
    "with_projects",
    "with_shorts",
    "no_projects",
  ]).default("all"),
  memberReferrer: z.string().trim().max(100).default("all"),
});

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const url = new URL(request.url);
    const query = querySchema.parse({
      offset: url.searchParams.get("offset") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      memberType: url.searchParams.get("memberType") ?? undefined,
      memberPlan: url.searchParams.get("memberPlan") ?? undefined,
      memberActivity: url.searchParams.get("memberActivity") ?? undefined,
      memberReferrer: url.searchParams.get("memberReferrer") ?? undefined,
    });
    const page = await loadAdminMembers({
      filters: {
        query: query.q,
        memberType: query.memberType,
        memberPlan: query.memberPlan,
        memberActivity: query.memberActivity,
        memberReferrer: query.memberReferrer,
      },
      offset: query.offset,
    });

    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "회원을 더 불러오지 못했습니다.");
  }
}
