import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  assertThePayOneBillingEnabled,
  cardTokenHash,
  createPaymentTrackId,
  encryptCardToken,
  isSupportedCardNumber,
  normalizeCardNumber,
  PaymentConfigurationError,
  registerThePayOneCard,
  thePayOneMerchantId,
  thePayOneTerminalId,
  type ThePayOneCredentialScope,
  ThePayOneError,
} from "@/lib/thepayone";
import {
  assertLocalPaymentMutation,
  assertLocalPaymentTestHost,
  assertPaymentTester,
  PaymentTestAccessError,
} from "@/lib/payment-test";
import { requireMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registrationSchema = z.object({
  requestId: z.string().uuid(),
  credentialScope: z.enum(["default", "package"]),
  payerName: z.string().trim().min(1).max(30),
  payerEmail: z.string().trim().email().max(60),
  payerTel: z.string().transform((value) => value.replace(/[^0-9]/g, "")).refine((value) => /^\d{10,11}$/.test(value)),
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
  identityNumber: z.string().transform((value) => value.replace(/[^0-9]/g, "")).refine((value) => /^(\d{6}|\d{10})$/.test(value)),
  cardPassword: z.string().refine((value) => /^\d{2}$/.test(value)),
  consent: z.literal(true),
}).strict();

const invalidFieldMessages: Record<string, string> = {
  payerName: "이름은 1~30자로 입력해 주세요.",
  payerEmail: "이메일 주소 형식을 확인해 주세요.",
  payerTel: "휴대전화 번호는 숫자 10~11자리로 입력해 주세요.",
  cardNumber: "카드번호는 공백이나 하이픈을 제외한 숫자 13~19자리인지 확인해 주세요.",
  expiry: "유효기간의 월(MM)과 연도(YY)를 확인해 주세요. 예: 07/29는 연도 29, 월 07입니다.",
  identityNumber: "개인카드는 생년월일 6자리, 법인카드는 사업자등록번호 10자리를 입력해 주세요.",
  cardPassword: "카드 비밀번호 앞 2자리를 숫자로 입력해 주세요.",
  consent: "본인 카드 사용, 0원 카드 등록 및 반복결제 테스트 안내에 동의해 주세요.",
};

type RegistrationRow = {
  id: string;
  status: "pending" | "active" | "failed" | "unknown" | "revoking" | "revoked" | "revoke_failed";
  cardLast4: string | null;
  cardIssuer: string | null;
  cardType: string | null;
  cardAcquirer: string | null;
  transactionId: string | null;
  resultCode: string | null;
  providerCredentialScope: ThePayOneCredentialScope;
  providerMerchantId: string | null;
  providerTerminalId: string | null;
  createdAt: Date;
  revokedAt: Date | null;
};

function safeRegistration(row: RegistrationRow) {
  return {
    id: row.id,
    status: row.status,
    last4: row.cardLast4,
    issuer: row.cardIssuer,
    cardType: row.cardType,
    acquirer: row.cardAcquirer,
    transactionId: row.transactionId,
    resultCode: row.resultCode,
    credentialScope: row.providerCredentialScope,
    merchantId: row.providerMerchantId,
    terminalId: row.providerTerminalId,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() || null,
  };
}

function json(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function paymentError(error: unknown) {
  if (error instanceof PaymentTestAccessError) {
    return json({ detail: error.message, errorCode: error.errorCode }, { status: error.status });
  }
  if (error instanceof PaymentConfigurationError) return json({ detail: error.message }, { status: 503 });
  if (error instanceof ThePayOneError) {
    const diagnostic = error.diagnostic ? ` · 상세: ${error.diagnostic}` : "";
    return json({
      detail: error.outcomeUnknown
        ? "카드 등록 결과를 확정하지 못했습니다. 중복 등록을 막기 위해 더페이원 관리자에서 거래를 확인해 주세요."
        : `${error.message}${diagnostic}`,
      errorCode: error.outcomeUnknown ? "CARD_REGISTRATION_OUTCOME_UNKNOWN" : "CARD_REGISTRATION_FAILED",
      resultCode: error.resultCode,
    }, { status: 502 });
  }
  if (error instanceof z.ZodError) {
    const field = String(error.issues[0]?.path[0] || "");
    return json({ detail: invalidFieldMessages[field] || "카드 등록 입력값을 다시 확인해 주세요." }, { status: 400 });
  }
  return json({ detail: "더페이원 0원 카드 등록 테스트를 처리하지 못했습니다." }, { status: 500 });
}

const registrationColumns = `
  id, status, card_last4, card_issuer, card_type, card_acquirer,
  transaction_id, result_code, provider_credential_scope,
  provider_merchant_id, provider_terminal_id, created_at, revoked_at
`;

export async function GET(request: Request) {
  try {
    assertLocalPaymentTestHost(request);
    const tester = assertPaymentTester(await requireMvpSession());
    const rows = await getDb().unsafe<RegistrationRow[]>(`
      select ${registrationColumns}
      from shorts_mvp.payment_method_registrations
      where user_id=$1 and provider_credential_scope='default'
      order by created_at desc
      limit 20
    `, [tester.userId]);
    return json({ registrations: rows.map(safeRegistration) });
  } catch (error) {
    return paymentError(error);
  }
}

export async function POST(request: Request) {
  let registrationId: string | null = null;
  let userId: string | null = null;
  try {
    assertLocalPaymentMutation(request);
    const tester = assertPaymentTester(await requireMvpSession());
    userId = tester.userId;
    assertThePayOneBillingEnabled();
    const input = registrationSchema.parse(await request.json());
    if (input.credentialScope === "package") {
      throw new PaymentTestAccessError(
        "패키지 수기결제는 카드 등록 없이 승인마다 카드정보를 직접 입력해야 합니다.",
        409,
        "PACKAGE_MANUAL_DIRECT_REQUIRED",
      );
    }
    const credentialScope = "default" as const;
    const merchantId = thePayOneMerchantId(credentialScope);
    const terminalId = thePayOneTerminalId(credentialScope);
    const db = getDb();
    const existing = await db.unsafe<RegistrationRow[]>(`
      select ${registrationColumns}
      from shorts_mvp.payment_method_registrations
      where user_id=$1 and request_id=$2
      limit 1
    `, [tester.userId, input.requestId]);
    if (existing[0]) return json({ registration: safeRegistration(existing[0]), duplicate: true });

    registrationId = randomUUID();
    const orderId = createPaymentTrackId("AUTH");
    await db`
      insert into shorts_mvp.payment_method_registrations (
        id,user_id,request_id,order_id,status,provider_credential_scope,
        provider_merchant_id,provider_terminal_id
      ) values (
        ${registrationId},${tester.userId},${input.requestId},${orderId},'pending',
        ${credentialScope},${merchantId},${terminalId}
      )
    `;

    let issued;
    try {
      issued = await registerThePayOneCard({
        trackId: orderId,
        cardNumber: input.cardNumber,
        expiry: input.expiry,
        authDob: input.identityNumber,
        authPw: input.cardPassword,
        payerName: input.payerName,
        payerEmail: input.payerEmail,
        payerTel: input.payerTel,
        billingDay: "00",
        productName: "Easy Cut 반복결제 테스트",
      }, credentialScope);
      if (
        issued.trackId !== orderId
        || issued.amount !== 0
        || issued.billingDay !== "00"
      ) {
        throw new ThePayOneError(
          "더페이원 카드 등록 응답이 요청과 일치하지 않습니다.",
          "CARD_REGISTRATION_MISMATCH",
          null,
          true,
        );
      }
    } catch (error) {
      const outcomeUnknown = error instanceof ThePayOneError && error.outcomeUnknown;
      await db`
        update shorts_mvp.payment_method_registrations
        set status=${outcomeUnknown ? "unknown" : "failed"},
          result_code=${error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR"}
        where id=${registrationId} and user_id=${tester.userId} and status='pending'
      `;
      throw error;
    }

    const encrypted = encryptCardToken(issued.cardId, registrationId);
    const rows = await db`
      update shorts_mvp.payment_method_registrations
      set status='active',transaction_id=${issued.providerTransactionId},result_code=${issued.resultCode},
        billing_key_ciphertext=${encrypted.ciphertext},billing_key_iv=${encrypted.iv},
        billing_key_tag=${encrypted.tag},billing_key_hash=${cardTokenHash(issued.cardId)},
        card_last4=${issued.last4},card_issuer_code=null,
        card_issuer=${issued.issuer},card_type=${issued.cardType},
        card_acquirer_code=null,card_acquirer=${issued.acquirer}
      where id=${registrationId} and user_id=${tester.userId} and status='pending'
      returning id,status,card_last4,card_issuer,card_type,card_acquirer,
        transaction_id,result_code,provider_credential_scope,
        provider_merchant_id,provider_terminal_id,created_at,revoked_at
    ` as unknown as RegistrationRow[];
    if (!rows[0]) throw new Error("카드 등록 상태를 저장하지 못했습니다.");
    return json({ registration: safeRegistration(rows[0]) }, { status: 201 });
  } catch (error) {
    if (registrationId && userId && !(error instanceof ThePayOneError)) {
      await getDb()`
        update shorts_mvp.payment_method_registrations
        set status='failed',result_code=coalesce(result_code,'LOCAL_ERROR')
        where id=${registrationId} and user_id=${userId} and status='pending'
      `.catch(() => undefined);
    }
    return paymentError(error);
  }
}
