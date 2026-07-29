import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import {
  USER_ONBOARDING_VERSION,
  userOnboardingSubmissionSchema,
} from "@/lib/user-onboarding";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const rows = await getDb()`
      select 1
      from shorts_mvp.user_onboarding_profiles
      where user_id=${session.userId}
      limit 1
    `;
    return noStoreJson({
      required: !rows[0],
      version: USER_ONBOARDING_VERSION,
    });
  } catch (error) {
    const response = apiError(error, "온보딩 정보를 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request, "온보딩 요청");
    const input = userOnboardingSubmissionSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    await getDb()`
      insert into shorts_mvp.user_onboarding_profiles (
        user_id,request_id,occupation,occupation_other,usage_purposes,
        usage_purpose_other,onboarding_version
      ) values (
        ${session.userId},${input.requestId},${input.occupation},
        ${input.occupationOther},${input.usagePurposes},
        ${input.usagePurposeOther},${USER_ONBOARDING_VERSION}
      )
      on conflict (user_id) do nothing
    `;

    return noStoreJson({ completed: true });
  } catch (error) {
    const response = apiError(error, "온보딩 응답을 저장하지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
