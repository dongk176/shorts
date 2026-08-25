import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ token: string; attemptId: string }>;
};

const paramsSchema = z.object({
  token: z.string().uuid(),
  attemptId: z.string().uuid(),
});

const bodySchema = z.object({
  code: z.string().trim().min(1).max(100).optional(),
  message: z.string().trim().min(1).max(300).optional(),
}).strict();

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request, "결제 실패 기록");
    const [{ token, attemptId }, input] = await Promise.all([
      params.then((value) => paramsSchema.parse(value)),
      request.json().then((value) => bodySchema.parse(value)),
    ]);
    const db = getDb();
    const attempts = await db`
      select attempt.id
      from shorts_mvp.enterprise_payment_attempts attempt
      join shorts_mvp.enterprise_payment_items item
        on item.id=attempt.payment_item_id
      join shorts_mvp.enterprise_payment_requests payment_request
        on payment_request.id=item.payment_request_id
      where payment_request.public_token=${token}
        and attempt.id=${attemptId}
      limit 1
    `;
    if (!attempts[0]) throw new HttpError(404, "결제 주문을 찾을 수 없습니다.");
    await db`
      update shorts_mvp.enterprise_payment_attempts
      set status='failed',provider_error_code=${input.code || "CHECKOUT_FAILED"},
        provider_error_message=${input.message || "결제창에서 결제를 완료하지 않았습니다."}
      where id=${attemptId} and status='prepared'
    `;
    return NextResponse.json({ ok: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error, "결제 실패 상태를 기록하지 못했습니다.");
  }
}
