import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  isReferralSlug,
  normalizeReferralCampaign,
  normalizeReferralSlug,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/referral-policy";
import { createReferralToken, referralTokenHash } from "@/lib/referral-security";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ referralSlug: string }>;
};

function notFoundResponse() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { referralSlug } = await params;
  if (/^[1-9]\d*$/.test(referralSlug)) {
    return NextResponse.redirect(new URL(`/projects/${referralSlug}`, request.url), 308);
  }

  const slug = normalizeReferralSlug(referralSlug);
  if (!isReferralSlug(slug)) return notFoundResponse();
  const db = getDb();
  const partnerRows = await db`
    select id from shorts_mvp.referral_partners
    where slug=${slug} and status='active'
    limit 1
  `;
  const partner = partnerRows[0];
  if (!partner) return notFoundResponse();

  const campaign = normalizeReferralCampaign(request.nextUrl.searchParams.get("campaign"));
  const authenticatedUser = await getAuthenticatedUser();
  if (authenticatedUser) {
    await db`
      insert into shorts_mvp.referral_clicks (
        clicked_partner_id,campaign,is_attribution_candidate,eligibility_reason
      ) values (${partner.id},${campaign},false,'existing_member')
    `;
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  const existingToken = request.cookies.get(REFERRAL_COOKIE)?.value;
  if (existingToken) {
    const visitorRows = await db`
      select id from shorts_mvp.referral_visitors
      where token_hash=${referralTokenHash(existingToken)} and expires_at>now()
      limit 1
    `;
    const visitor = visitorRows[0];
    if (visitor) {
      await db.begin(async (tx) => {
        await tx`
          update shorts_mvp.referral_visitors set last_seen_at=now()
          where id=${visitor.id}
        `;
        await tx`
          insert into shorts_mvp.referral_clicks (
            clicked_partner_id,visitor_id,campaign,is_attribution_candidate,eligibility_reason
          ) values (${partner.id},${visitor.id},${campaign},false,'existing_first_click')
        `;
      });
      return NextResponse.redirect(new URL("/", request.url), 303);
    }
  }

  const token = createReferralToken();
  const inserted = await db`
    insert into shorts_mvp.referral_visitors (
      token_hash,partner_id,first_campaign,expires_at
    ) values (
      ${referralTokenHash(token)},${partner.id},${campaign},
      now()+${REFERRAL_COOKIE_MAX_AGE_SECONDS}*interval '1 second'
    )
    returning id
  `;
  await db`
    insert into shorts_mvp.referral_clicks (
      clicked_partner_id,visitor_id,campaign,is_attribution_candidate,eligibility_reason
    ) values (
      ${partner.id},${inserted[0].id},${campaign},true,
      ${existingToken ? "invalid_cookie" : "eligible_first_click"}
    )
  `;

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(REFERRAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
