import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  assertLocalPaymentMutation,
  assertLocalPaymentTestHost,
  assertPaymentTester,
  PaymentTestAccessError,
} from "@/lib/payment-test";
import { requireMvpSession } from "@/lib/session";
import {
  createPaymentTrackId,
  encryptCardToken,
  getThePayOneConfig,
  isSupportedCardNumber,
  normalizeCardNumber,
  PaymentConfigurationError,
  registerThePayOneCard,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registrationSchema = z.object({
  requestId: z.string().uuid(),
  payerName: z.string().trim().min(1).max(20),
  payerEmail: z.string().trim().email().max(100),
  payerTel: z.string().transform((value) => value.replace(/[^0-9]/g, "")).refine((value) => /^\d{10,11}$/.test(value)),
  // ThePayOne documents this as an A(20) field and performs issuer validation.
  // Do not reject structurally valid domestic PANs with an undocumented Luhn rule.
  cardNumber: z.string().transform(normalizeCardNumber).refine(isSupportedCardNumber),
  expiry: z.string().transform((value) => value.replace(/[^0-9]/g, "")).refine((value) => {
    if (!/^\d{2}(0[1-9]|1[0-2])$/.test(value)) return false;
    const now = new Date();
    const currentYear = now.getUTCFullYear() % 100;
    const currentMonth = now.getUTCMonth() + 1;
    const year = Number(value.slice(0, 2));
    const month = Number(value.slice(2));
    return year > currentYear || (year === currentYear && month >= currentMonth);
  }),
  authDob: z.string().transform((value) => value.replace(/[^0-9]/g, "")).refine((value) => /^(\d{6}|\d{10})$/.test(value)),
  authPw: z.string().refine((value) => /^\d{2}$/.test(value)),
  consent: z.literal(true),
}).strict();

const invalidFieldMessages: Record<string, string> = {
  payerName: "이름은 1~20자로 입력해 주세요.",
  payerEmail: "이메일 주소 형식을 확인해 주세요.",
  payerTel: "휴대전화 번호는 숫자 10~11자리로 입력해 주세요.",
  cardNumber: "카드번호는 공백이나 하이픈을 제외한 숫자 13~19자리인지 확인해 주세요.",
  expiry: "유효기간의 월(MM)과 연도(YY)를 확인해 주세요. 예: 카드 표기가 07/29이면 월 07, 연도 29입니다.",
  authDob: "개인카드는 생년월일 6자리(YYMMDD), 법인카드는 사업자등록번호 10자리를 입력해 주세요.",
  authPw: "카드 비밀번호 앞 2자리를 숫자로 입력해 주세요.",
  consent: "본인 카드 사용 및 카드등록 안내에 동의해 주세요.",
};

function zodErrorDetail(error: z.ZodError) {
  const field = String(error.issues[0]?.path[0] || "");
  return invalidFieldMessages[field] || "카드 등록 입력값을 다시 확인해 주세요.";
}

type RegistrationRow = {
  id: string;
  status: string;
  cardLast4: string | null;
  cardIssuer: string | null;
  cardType: string | null;
  cardAcquirer: string | null;
  providerAuthTrxId: string | null;
  providerResultCode: string | null;
  createdAt: string;
  revokedAt: string | null;
};

function safeRegistration(row: RegistrationRow) {
  return {
    id: row.id,
    status: row.status,
    last4: row.cardLast4,
    issuer: row.cardIssuer,
    cardType: row.cardType,
    acquirer: row.cardAcquirer,
    providerTransactionId: row.providerAuthTrxId,
    resultCode: row.providerResultCode,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function paymentError(error: unknown) {
  if (error instanceof PaymentTestAccessError) return json({ detail: error.message }, { status: error.status });
  if (error instanceof PaymentConfigurationError) return json({ detail: error.message }, { status: 503 });
  if (error instanceof ThePayOneError) {
    const detail = error.diagnostic ? `${error.message} · 상세: ${error.diagnostic}` : error.message;
    return json({ detail, resultCode: error.resultCode }, { status: 502 });
  }
  if (error instanceof z.ZodError) return json({ detail: zodErrorDetail(error) }, { status: 400 });
  return json({ detail: "카드 등록 테스트를 처리하지 못했습니다." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    assertLocalPaymentTestHost(request);
    const session = await requireMvpSession();
    const tester = assertPaymentTester(session);
    const db = getDb();
    const rows = await db`
      select
        id, status, card_last4, card_issuer, card_type, card_acquirer,
        provider_auth_trx_id, provider_result_code, created_at, revoked_at
      from shorts_mvp.payment_method_registrations
      where user_id=${tester.userId}
      order by created_at desc
      limit 20
    ` as unknown as RegistrationRow[];
    return json({ registrations: rows.map(safeRegistration) });
  } catch (error) {
    return paymentError(error);
  }
}

export async function POST(request: Request) {
  let registrationId: string | null = null;
  try {
    assertLocalPaymentMutation(request);
    const session = await requireMvpSession();
    const tester = assertPaymentTester(session);
    const input = registrationSchema.parse(await request.json());
    const config = getThePayOneConfig();
    const db = getDb();

    const existing = await db`
      select
        id, status, card_last4, card_issuer, card_type, card_acquirer,
        provider_auth_trx_id, provider_result_code, created_at, revoked_at
      from shorts_mvp.payment_method_registrations
      where user_id=${tester.userId} and request_id=${input.requestId}
      limit 1
    ` as unknown as RegistrationRow[];
    if (existing[0]) return json({ registration: safeRegistration(existing[0]), duplicate: true });

    registrationId = randomUUID();
    const trackId = createPaymentTrackId("AUTH");
    await db`
      insert into shorts_mvp.payment_method_registrations (
        id, user_id, merchant_id, request_id, track_id, status, billing_day
      ) values (
        ${registrationId}, ${tester.userId}, ${config.merchantId}, ${input.requestId}, ${trackId}, 'pending', '00'
      )
    `;

    let providerResult;
    try {
      providerResult = await registerThePayOneCard({
        trackId,
        payerName: input.payerName,
        payerEmail: input.payerEmail,
        payerTel: input.payerTel,
        cardNumber: input.cardNumber,
        expiry: input.expiry,
        authDob: input.authDob,
        authPw: input.authPw,
      });
    } catch (error) {
      const resultCode = error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR";
      await db`
        update shorts_mvp.payment_method_registrations
        set status='failed', provider_result_code=${resultCode}
        where id=${registrationId} and user_id=${tester.userId}
      `;
      throw error;
    }

    const encrypted = encryptCardToken(providerResult.cardId, registrationId);
    const rows = await db`
      update shorts_mvp.payment_method_registrations
      set
        status='active',
        provider_auth_trx_id=${providerResult.providerTransactionId},
        provider_result_code=${providerResult.resultCode},
        card_token_ciphertext=${encrypted.ciphertext},
        card_token_iv=${encrypted.iv},
        card_token_tag=${encrypted.tag},
        card_last4=${providerResult.last4},
        card_issuer=${providerResult.issuer},
        card_type=${providerResult.cardType},
        card_acquirer=${providerResult.acquirer}
      where id=${registrationId} and user_id=${tester.userId} and status='pending'
      returning
        id, status, card_last4, card_issuer, card_type, card_acquirer,
        provider_auth_trx_id, provider_result_code, created_at, revoked_at
    ` as unknown as RegistrationRow[];
    if (!rows[0]) throw new Error("카드 등록 상태를 저장하지 못했습니다.");
    return json({ registration: safeRegistration(rows[0]) }, { status: 201 });
  } catch (error) {
    return paymentError(error);
  }
}
