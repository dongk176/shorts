import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createBillingOrderId,
} from "@/lib/billing";
import {
  hasKstBillingDateStarted,
  kstDateKey,
  LEGACY_CARD_CAMPAIGN_KEY,
  LEGACY_CARD_EXPECTED_AMOUNT_KRW,
  LEGACY_CARD_EXPECTED_PLAN,
  legacyCardClaimsEnabled,
} from "@/lib/billing-payment-method-remediation";
import { resolveStoredCardIssuer } from "@/lib/billing-card";
import { encryptBillingPhone } from "@/lib/billing-phone";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { setDefaultPaymentMethod } from "@/lib/default-payment-method";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  assertThePayOneBillingEnabled,
  cardTokenHash,
  changeThePayOneCardStatus,
  createPaymentTrackId,
  decryptCardToken,
  encryptCardToken,
  registerThePayOneCard,
  thePayOneMerchantId,
  thePayOneTerminalId,
  ThePayOneError,
} from "@/lib/thepayone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  requestId: z.string().uuid(),
  payerTel: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^\d{10,11}$/.test(value)),
  cardNumber: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^\d{13,19}$/.test(value)),
  expiryYear: z.string().regex(/^\d{2}$/),
  expiryMonth: z.string().regex(/^(0[1-9]|1[0-2])$/),
  identityNumber: z.string()
    .transform((value) => value.replace(/[^0-9]/g, ""))
    .refine((value) => /^(\d{6}|\d{10})$/.test(value)),
  cardPassword: z.string().regex(/^\d{2}$/),
}).strict();

type Claim = {
  remediationId: string;
  subscriptionId: string;
  legacyPaymentMethodId: string;
  originalNextChargeAt: Date;
  originalCurrentPeriodEnd: Date;
  billingAnchorDay: number;
  billingOrderId: string;
  billingOrderPublicId: string;
  attemptId: string;
  registrationTrackId: string;
  legacyBillingKeyCiphertext: string;
  legacyBillingKeyIv: string;
  legacyBillingKeyTag: string;
  legacyBillingKeyHash: string;
};

function safeFailure(error: unknown) {
  const code = error instanceof ThePayOneError
    ? error.resultCode
    : typeof (error as { code?: unknown })?.code === "string"
      ? String((error as { code: string }).code).slice(0, 80)
      : "LOCAL_ERROR";
  const message = error instanceof Error
    ? error.message
      .replace(/(?:\d[ -]?){6,19}/g, "[민감정보 숨김]")
      .slice(0, 300)
    : "처리 결과를 확인하지 못했습니다.";
  return { code, message };
}

async function recordRegistrationFailure(
  claim: Claim,
  error: unknown,
  outcomeUnknown: boolean,
) {
  const db = getDb();
  const failure = safeFailure(error);
  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.billing_payment_method_remediation_attempts
      set status=${outcomeUnknown ? "manual_review" : "known_failed"},
        failure_code=${failure.code},failure_message=${failure.message},finished_at=now()
      where id=${claim.attemptId} and status='registering'
    `;
    await tx`
      update shorts_mvp.billing_orders
      set status=${outcomeUnknown ? "manual_review" : "failed"},
        failure_code=${failure.code},failure_message=${failure.message}
      where id=${claim.billingOrderId} and status='processing'
    `;
    await tx`
      update shorts_mvp.billing_payment_method_remediations
      set state=${outcomeUnknown ? "manual_review" : "required"},
        last_error_code=${failure.code},last_error_message=${failure.message},
        claim_started_at=null
      where id=${claim.remediationId}
        and registration_track_id=${claim.registrationTrackId}
    `;
  });
}

async function setManualReview(
  claim: Claim,
  code: string,
  message: string,
  newPaymentMethodId: string | null,
  newScheduleCompensated: boolean | null,
) {
  const db = getDb();
  await db.begin(async (tx) => {
    if (newPaymentMethodId) await tx`
      update shorts_mvp.billing_payment_methods
      set status=${newScheduleCompensated ? "paused" : "manual_review"},
        provider_schedule_status=${newScheduleCompensated ? "paused" : "manual_review"}
      where id=${newPaymentMethodId}
    `;
    await tx`
      update shorts_mvp.billing_payment_method_remediation_attempts
      set status='manual_review',new_payment_method_id=${newPaymentMethodId},
        new_schedule_compensated=${newScheduleCompensated},
        failure_code=${code},failure_message=${message},finished_at=now()
        ,issued_card_ciphertext=case when ${newScheduleCompensated === true} then null else issued_card_ciphertext end
        ,issued_card_iv=case when ${newScheduleCompensated === true} then null else issued_card_iv end
        ,issued_card_tag=case when ${newScheduleCompensated === true} then null else issued_card_tag end
      where id=${claim.attemptId}
    `;
    await tx`
      update shorts_mvp.billing_orders
      set status='manual_review',failure_code=${code},failure_message=${message}
      where id=${claim.billingOrderId}
    `;
    await tx`
      update shorts_mvp.billing_payment_method_remediations
      set state='manual_review',new_payment_method_id=${newPaymentMethodId},
        last_error_code=${code},last_error_message=${message}
      where id=${claim.remediationId}
    `;
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ remediationId: string }> },
) {
  try {
    assertBillingMutationRequest(request);
    assertThePayOneBillingEnabled();
    const body = schema.parse(await request.json());
    const { remediationId } = await context.params;
    if (!z.string().uuid().safeParse(remediationId).success) {
      throw new HttpError(404, "결제수단 확인 요청을 찾을 수 없습니다.");
    }
    const session = await requireAuthenticatedMvpSession({
      allowPaymentMethodRemediation: true,
    });
    if (!session.user?.email) {
      throw new HttpError(409, "계정 이메일을 확인할 수 없습니다.");
    }
    const db = getDb();
    const claimResult = await db.begin(async (tx) => {
      const rows = await tx`
        select
          r.*,
          s.status as subscription_status,
          s.plan_code as subscription_plan_code,
          s.billing_cycle as subscription_billing_cycle,
          s.payment_method_id as subscription_payment_method_id,
          s.payment_provider as subscription_payment_provider,
          s.provider_schedule_status as subscription_schedule_status,
          s.current_period_end as subscription_current_period_end,
          s.next_charge_at as subscription_next_charge_at,
          s.billing_anchor_day as subscription_billing_anchor_day,
          s.cancel_at_period_end,
          s.scheduled_plan_code,
          s.scheduled_billing_cycle,
          m.provider as method_provider,
          m.status as method_status,
          m.provider_schedule_status as method_schedule_status,
          m.provider_merchant_id as method_merchant_id,
          m.provider_terminal_id as method_terminal_id,
          m.billing_key_ciphertext as legacy_billing_key_ciphertext,
          m.billing_key_iv as legacy_billing_key_iv,
          m.billing_key_tag as legacy_billing_key_tag,
          m.billing_key_hash as legacy_billing_key_hash,
          u.default_payment_method_id,
          p.monthly_price_krw
        from shorts_mvp.billing_payment_method_remediations r
        join shorts_mvp.user_subscriptions s on s.id=r.subscription_id
        join shorts_mvp.billing_payment_methods m on m.id=r.legacy_payment_method_id
        join shorts_mvp.app_users u on u.id=r.user_id
        join shorts_mvp.plans p on p.code=s.plan_code
        where r.id=${remediationId} and r.user_id=${session.userId}
          and r.campaign_key=${LEGACY_CARD_CAMPAIGN_KEY}
          and r.enabled_at is not null
        for update of r,s,m,u
      `;
      const row = rows[0];
      if (!row) throw new HttpError(404, "결제수단 확인 요청을 찾을 수 없습니다.");
      if (row.state === "completed") return { alreadyCompleted: true as const };
      if (row.state === "expired") {
        throw new HttpError(409, "이지컷 프로 구독이 만료되었습니다.", "SUBSCRIPTION_EXPIRED");
      }
      if (row.state === "manual_review" || row.state === "awaiting_provider") {
        throw new HttpError(423, "구독 상태를 확인하고 있습니다.", "PAYMENT_METHOD_REVIEW_PENDING");
      }
      if (row.state === "registering") {
        const attempts = await tx`
          select status from shorts_mvp.billing_payment_method_remediation_attempts
          where remediation_id=${remediationId} and request_id=${body.requestId}
          order by started_at desc limit 1
        `;
        if (attempts[0]?.status === "completed") return { alreadyCompleted: true as const };
        throw new HttpError(409, "결제수단을 추가하고 있습니다.", "PAYMENT_METHOD_REGISTRATION_IN_PROGRESS");
      }
      if (row.state !== "required" || !(await legacyCardClaimsEnabled(tx))) {
        throw new HttpError(503, "결제수단 확인이 잠시 중지되어 있습니다.", "PAYMENT_METHOD_REMEDIATION_DISABLED");
      }
      if (hasKstBillingDateStarted(row.originalNextChargeAt)) {
        await tx`
          update shorts_mvp.billing_payment_method_remediations
          set state='awaiting_provider',last_error_code=null,last_error_message=null
          where id=${remediationId} and state='required'
        `;
        return { awaitingProvider: true as const };
      }
      const snapshotMatches = (
        row.subscriptionStatus === "active"
        && row.subscriptionPlanCode === LEGACY_CARD_EXPECTED_PLAN
        && row.subscriptionBillingCycle === "monthly"
        && row.subscriptionPaymentMethodId === row.legacyPaymentMethodId
        && row.subscriptionPaymentProvider === "thepayone"
        && row.subscriptionScheduleStatus === "active"
        && row.subscriptionCurrentPeriodEnd?.getTime() === row.originalCurrentPeriodEnd.getTime()
        && row.subscriptionNextChargeAt?.getTime() === row.originalNextChargeAt.getTime()
        && Number(row.subscriptionBillingAnchorDay) === Number(row.billingAnchorDay)
        && kstDateKey(row.originalNextChargeAt).slice(-2) === String(row.billingAnchorDay).padStart(2, "0")
        && row.cancelAtPeriodEnd === false
        && row.scheduledPlanCode == null
        && row.scheduledBillingCycle == null
        && row.methodProvider === "thepayone"
        && row.methodStatus === "active"
        && row.methodScheduleStatus === "active"
        && row.methodMerchantId === thePayOneMerchantId()
        && row.methodTerminalId === thePayOneTerminalId()
        && row.defaultPaymentMethodId === row.legacyPaymentMethodId
        && row.expectedProductCode === LEGACY_CARD_EXPECTED_PLAN
        && Number(row.expectedAmountKrw) === LEGACY_CARD_EXPECTED_AMOUNT_KRW
        && Number(row.monthlyPriceKrw) === LEGACY_CARD_EXPECTED_AMOUNT_KRW
      );
      if (!snapshotMatches) {
        await tx`
          update shorts_mvp.billing_payment_method_remediations
          set state='manual_review',last_error_code='REMEDIATION_SNAPSHOT_MISMATCH',
            last_error_message='저장된 구독 또는 결제수단 정보가 변경되었습니다.'
          where id=${remediationId}
        `;
        return { manualReview: true as const };
      }

      const billingOrderId = randomUUID();
      const attemptId = randomUUID();
      const billingOrderPublicId = createBillingOrderId("PM");
      const registrationTrackId = createPaymentTrackId("AUTH");
      await tx`
        insert into shorts_mvp.billing_orders (
          id,user_id,subscription_id,payment_method_id,request_id,kind,product_code,
          billing_cycle,amount_krw,order_id,order_name,status,provider,provider_track_id,
          provider_merchant_id,provider_terminal_id,checkout_expires_at
        ) values (
          ${billingOrderId},${session.userId},${row.subscriptionId},${row.legacyPaymentMethodId},
          ${body.requestId},'payment_method_update',${LEGACY_CARD_EXPECTED_PLAN},'monthly',0,
          ${billingOrderPublicId},'Easy Cut 정기결제 카드 추가','processing','thepayone',
          ${billingOrderPublicId},${thePayOneMerchantId()},${thePayOneTerminalId()},
          now()+interval '10 minutes'
        )
      `;
      await tx`
        insert into shorts_mvp.billing_payment_method_remediation_attempts (
          id,remediation_id,billing_order_id,request_id,registration_track_id
        ) values (
          ${attemptId},${remediationId},${billingOrderId},${body.requestId},${registrationTrackId}
        )
      `;
      await tx`
        update shorts_mvp.billing_payment_method_remediations
        set state='registering',request_id=${body.requestId},
          registration_track_id=${registrationTrackId},claim_started_at=now(),
          last_error_code=null,last_error_message=null
        where id=${remediationId} and state='required'
      `;
      return {
        claim: {
          remediationId,
          subscriptionId: row.subscriptionId,
          legacyPaymentMethodId: row.legacyPaymentMethodId,
          originalNextChargeAt: row.originalNextChargeAt,
          originalCurrentPeriodEnd: row.originalCurrentPeriodEnd,
          billingAnchorDay: Number(row.billingAnchorDay),
          billingOrderId,
          billingOrderPublicId,
          attemptId,
          registrationTrackId,
          legacyBillingKeyCiphertext: row.legacyBillingKeyCiphertext,
          legacyBillingKeyIv: row.legacyBillingKeyIv,
          legacyBillingKeyTag: row.legacyBillingKeyTag,
          legacyBillingKeyHash: row.legacyBillingKeyHash,
        } satisfies Claim,
      };
    });

    if ("alreadyCompleted" in claimResult) {
      return NextResponse.json({ ok: true, paymentMethodUpdated: true, alreadyProcessed: true });
    }
    if ("awaitingProvider" in claimResult) {
      throw new HttpError(423, "구독 상태를 확인하고 있습니다.", "PAYMENT_METHOD_REVIEW_PENDING");
    }
    if ("manualReview" in claimResult) {
      throw new HttpError(423, "구독 상태를 확인하고 있습니다.", "PAYMENT_METHOD_REVIEW_PENDING");
    }
    const claim = claimResult.claim;
    const payerName = (
      session.user.displayName
      || session.user.email.split("@", 1)[0]
      || "Easy Cut 고객"
    ).slice(0, 20);
    const billingDay = String(claim.billingAnchorDay).padStart(2, "0");
    let registration: Awaited<ReturnType<typeof registerThePayOneCard>>;
    try {
      registration = await registerThePayOneCard({
        trackId: claim.registrationTrackId,
        amount: LEGACY_CARD_EXPECTED_AMOUNT_KRW,
        payerName,
        payerEmail: session.user.email,
        payerTel: body.payerTel,
        cardNumber: body.cardNumber,
        expiry: `${body.expiryYear}${body.expiryMonth}`,
        authDob: body.identityNumber,
        authPw: body.cardPassword,
        billingDay,
        productName: "Easy Cut 결제수단 추가",
      });
      if (
        registration.trackId !== claim.registrationTrackId
        || registration.amount !== LEGACY_CARD_EXPECTED_AMOUNT_KRW
        || registration.billingDay !== billingDay
      ) {
        throw new ThePayOneError(
          "카드 등록 결과가 요청 정보와 일치하지 않습니다.",
          "REGISTRATION_MISMATCH",
          null,
          true,
        );
      }
    } catch (error) {
      const outcomeUnknown = error instanceof ThePayOneError && error.outcomeUnknown;
      await recordRegistrationFailure(claim, error, outcomeUnknown);
      if (outcomeUnknown) {
        throw new HttpError(503, "구독 상태를 확인하고 있습니다.", "PAYMENT_METHOD_REVIEW_PENDING");
      }
      throw error;
    }

    const registrationHash = cardTokenHash(registration.cardId);
    const attemptCardToken = encryptCardToken(
      registration.cardId,
      `remediation-attempt:${claim.attemptId}`,
    );
    try {
      await db`
        update shorts_mvp.billing_payment_method_remediation_attempts
        set issued_card_ciphertext=${attemptCardToken.ciphertext},
          issued_card_iv=${attemptCardToken.iv},issued_card_tag=${attemptCardToken.tag},
          issued_card_hash=${registrationHash},
          registration_transaction_id=${registration.providerTransactionId}
        where id=${claim.attemptId} and status='registering'
      `;
    } catch {
      const sameProviderCard = registrationHash === claim.legacyBillingKeyHash;
      const compensated = sameProviderCard
        ? false
        : await changeThePayOneCardStatus(
            registration.cardId,
            "중지",
            createPaymentTrackId("AUDT"),
          ).then(() => true).catch(() => false);
      await setManualReview(
        claim,
        "REGISTRATION_RESULT_PERSIST_FAILED",
        "카드 등록 결과를 저장하지 못했습니다.",
        sameProviderCard ? claim.legacyPaymentMethodId : null,
        compensated,
      );
      throw new HttpError(503, "구독 상태를 확인하고 있습니다.", "PAYMENT_METHOD_REVIEW_PENDING");
    }
    const masked = `${body.cardNumber.slice(0, 6)}${"*".repeat(Math.max(3, body.cardNumber.length - 10))}${body.cardNumber.slice(-4)}`;
    if (registrationHash === claim.legacyBillingKeyHash) {
      const encryptedPhone = encryptBillingPhone(body.payerTel, claim.legacyPaymentMethodId);
      try {
        await db.begin(async (tx) => {
          await tx`
            update shorts_mvp.billing_payment_methods
            set registration_order_id=${registration.trackId},
              registration_transaction_id=${registration.providerTransactionId},
              registration_result_code=${registration.resultCode},
              registration_amount_krw=${LEGACY_CARD_EXPECTED_AMOUNT_KRW},
              registration_billing_day=${claim.billingAnchorDay},
              payer_tel_ciphertext=${encryptedPhone.ciphertext},
              payer_tel_iv=${encryptedPhone.iv},payer_tel_tag=${encryptedPhone.tag},
              issuer_name=${resolveStoredCardIssuer({
                issuer: registration.issuer,
                acquirer: registration.acquirer,
                cardNumberMasked: body.cardNumber,
              })},card_number_masked=${masked},card_last4=${registration.last4},
              card_type=${registration.cardType},status='active',provider_schedule_status='active'
            where id=${claim.legacyPaymentMethodId} and user_id=${session.userId}
          `;
          await tx`
            update shorts_mvp.billing_orders
            set status='succeeded',provider_transaction_id=${registration.providerTransactionId},
              provider_status='card_registered',approved_at=now(),
              payment_method_id=${claim.legacyPaymentMethodId},provider_card_id_hash=${registrationHash}
            where id=${claim.billingOrderId} and status='processing'
          `;
          await tx`
            update shorts_mvp.billing_payment_method_remediation_attempts
            set status='completed',new_payment_method_id=${claim.legacyPaymentMethodId},
              registration_transaction_id=${registration.providerTransactionId},
              old_schedule_paused=false,new_schedule_compensated=false,finished_at=now(),
              issued_card_ciphertext=null,issued_card_iv=null,issued_card_tag=null
            where id=${claim.attemptId}
          `;
          await tx`
            update shorts_mvp.billing_payment_method_remediations
            set state='completed',resolution='user_reregistered',
              new_payment_method_id=${claim.legacyPaymentMethodId},completed_at=now(),
              last_error_code=null,last_error_message=null
            where id=${claim.remediationId} and registration_track_id=${claim.registrationTrackId}
          `;
          await setDefaultPaymentMethod(tx, session.userId, claim.legacyPaymentMethodId);
        });
      } catch {
        await setManualReview(
          claim,
          "SAME_METHOD_FINALIZE_FAILED",
          "기존 카드의 재등록 결과를 저장하지 못했습니다.",
          claim.legacyPaymentMethodId,
          false,
        );
        throw new HttpError(503, "구독 상태를 확인하고 있습니다.", "PAYMENT_METHOD_REVIEW_PENDING");
      }
      return NextResponse.json({ ok: true, paymentMethodUpdated: true });
    }

    const newPaymentMethodId = randomUUID();
    const encrypted = encryptCardToken(registration.cardId, newPaymentMethodId);
    const encryptedPhone = encryptBillingPhone(body.payerTel, newPaymentMethodId);
    try {
      await db.begin(async (tx) => {
        await tx`
          insert into shorts_mvp.billing_payment_methods (
            id,user_id,provider,billing_key_ciphertext,billing_key_iv,billing_key_tag,billing_key_hash,
            registration_order_id,registration_transaction_id,registration_result_code,
            registration_amount_krw,registration_billing_day,
            provider_merchant_id,provider_terminal_id,provider_schedule_status,
            payer_tel_ciphertext,payer_tel_iv,payer_tel_tag,
            issuer_name,card_number_masked,card_last4,card_type,status
          ) values (
            ${newPaymentMethodId},${session.userId},'thepayone',${encrypted.ciphertext},${encrypted.iv},
            ${encrypted.tag},${registrationHash},${registration.trackId},
            ${registration.providerTransactionId},${registration.resultCode},
            ${LEGACY_CARD_EXPECTED_AMOUNT_KRW},${claim.billingAnchorDay},
            ${thePayOneMerchantId()},${thePayOneTerminalId()},'active',
            ${encryptedPhone.ciphertext},${encryptedPhone.iv},${encryptedPhone.tag},
            ${resolveStoredCardIssuer({
              issuer: registration.issuer,
              acquirer: registration.acquirer,
              cardNumberMasked: body.cardNumber,
            })},${masked},${registration.last4},${registration.cardType},'scheduled'
          )
        `;
        await tx`
          update shorts_mvp.billing_payment_method_remediation_attempts
          set status='registered',new_payment_method_id=${newPaymentMethodId},
            registration_transaction_id=${registration.providerTransactionId},
            old_schedule_paused=false
          where id=${claim.attemptId} and status='registering'
        `;
        await tx`
          update shorts_mvp.billing_payment_method_remediations
          set new_payment_method_id=${newPaymentMethodId}
          where id=${claim.remediationId} and state='registering'
            and registration_track_id=${claim.registrationTrackId}
        `;
        await tx`
          update shorts_mvp.billing_orders
          set payment_method_id=${newPaymentMethodId},provider_card_id_hash=${registrationHash}
          where id=${claim.billingOrderId} and status='processing'
        `;
      });
    } catch {
      const compensated = await changeThePayOneCardStatus(
        registration.cardId,
        "중지",
        createPaymentTrackId("AUDT"),
      ).then(() => true).catch(() => false);
      await setManualReview(
        claim,
        "NEW_METHOD_PERSIST_FAILED",
        "새 결제수단 저장 결과를 확인하지 못했습니다.",
        null,
        compensated,
      );
      throw new HttpError(503, "구독 상태를 확인하고 있습니다.", "PAYMENT_METHOD_REVIEW_PENDING");
    }

    const legacyCardId = decryptCardToken({
      ciphertext: claim.legacyBillingKeyCiphertext,
      iv: claim.legacyBillingKeyIv,
      tag: claim.legacyBillingKeyTag,
    }, claim.legacyPaymentMethodId);
    const oldPaused = await changeThePayOneCardStatus(
      legacyCardId,
      "중지",
      createPaymentTrackId("AUDT"),
    ).then(() => true).catch(() => false);
    if (!oldPaused) {
      const newCompensated = await changeThePayOneCardStatus(
        registration.cardId,
        "중지",
        createPaymentTrackId("AUDT"),
      ).then(() => true).catch(() => false);
      await setManualReview(
        claim,
        "OLD_SCHEDULE_PAUSE_FAILED",
        "기존 정기결제 중지 결과를 확인하지 못했습니다.",
        newPaymentMethodId,
        newCompensated,
      );
      throw new HttpError(503, "구독 상태를 확인하고 있습니다.", "PAYMENT_METHOD_REVIEW_PENDING");
    }
    await db`
      update shorts_mvp.billing_payment_method_remediation_attempts
      set old_schedule_paused=true
      where id=${claim.attemptId} and status='registered'
    `;

    try {
      await db.begin(async (tx) => {
        const locked = await tx`
          select r.state,r.registration_track_id,s.payment_method_id,s.current_period_end,
            s.next_charge_at,s.billing_anchor_day,s.status,u.default_payment_method_id
          from shorts_mvp.billing_payment_method_remediations r
          join shorts_mvp.user_subscriptions s on s.id=r.subscription_id
          join shorts_mvp.app_users u on u.id=r.user_id
          where r.id=${claim.remediationId} and r.user_id=${session.userId}
          for update of r,s,u
        `;
        const row = locked[0];
        if (
          !row
          || row.state !== "registering"
          || row.registrationTrackId !== claim.registrationTrackId
          || row.status !== "active"
          || row.paymentMethodId !== claim.legacyPaymentMethodId
          || row.defaultPaymentMethodId !== claim.legacyPaymentMethodId
          || row.currentPeriodEnd?.getTime() !== claim.originalCurrentPeriodEnd.getTime()
          || row.nextChargeAt?.getTime() !== claim.originalNextChargeAt.getTime()
          || Number(row.billingAnchorDay) !== claim.billingAnchorDay
        ) throw new Error("REMEDIATION_FINAL_STATE_CHANGED");

        const switched = await tx`
          update shorts_mvp.user_subscriptions
          set payment_method_id=${newPaymentMethodId},payment_provider='thepayone',
            provider_schedule_status='active',billing_review_status='clear',
            billing_review_reason=null
          where id=${claim.subscriptionId} and user_id=${session.userId}
            and status='active' and payment_method_id=${claim.legacyPaymentMethodId}
            and current_period_end=${claim.originalCurrentPeriodEnd}
            and next_charge_at=${claim.originalNextChargeAt}
          returning id
        `;
        if (!switched[0]) throw new Error("REMEDIATION_SUBSCRIPTION_SWITCH_FAILED");
        await tx`
          update shorts_mvp.billing_payment_methods
          set status='replaced',provider_schedule_status='paused',
            payer_tel_ciphertext=null,payer_tel_iv=null,payer_tel_tag=null,revoked_at=now()
          where id=${claim.legacyPaymentMethodId} and user_id=${session.userId}
        `;
        await tx`
          update shorts_mvp.billing_payment_methods
          set status='active',provider_schedule_status='active'
          where id=${newPaymentMethodId} and user_id=${session.userId} and status='scheduled'
        `;
        await setDefaultPaymentMethod(tx, session.userId, newPaymentMethodId);
        await tx`
          update shorts_mvp.billing_orders
          set status='succeeded',provider_transaction_id=${registration.providerTransactionId},
            provider_status='card_registered',approved_at=now()
          where id=${claim.billingOrderId} and status='processing'
        `;
        await tx`
          update shorts_mvp.billing_payment_method_remediation_attempts
          set status='completed',old_schedule_paused=true,new_schedule_compensated=false,
            issued_card_ciphertext=null,issued_card_iv=null,issued_card_tag=null,finished_at=now()
          where id=${claim.attemptId} and status='registered'
        `;
        await tx`
          update shorts_mvp.billing_payment_method_remediations
          set state='completed',resolution='user_reregistered',
            new_payment_method_id=${newPaymentMethodId},completed_at=now(),
            last_error_code=null,last_error_message=null
          where id=${claim.remediationId} and state='registering'
            and registration_track_id=${claim.registrationTrackId}
        `;
      });
    } catch {
      const [newCompensated, oldResumed] = await Promise.all([
        changeThePayOneCardStatus(
          registration.cardId,
          "중지",
          createPaymentTrackId("AUDT"),
        ).then(() => true).catch(() => false),
        changeThePayOneCardStatus(
          legacyCardId,
          "사용",
          createPaymentTrackId("AUDT"),
        ).then(() => true).catch(() => false),
      ]);
      if (newCompensated && oldResumed) {
        await db.begin(async (tx) => {
          await tx`
            update shorts_mvp.billing_payment_methods
            set status='paused',provider_schedule_status='paused'
            where id=${newPaymentMethodId}
          `;
          await tx`
            update shorts_mvp.billing_payment_methods
            set status='active',provider_schedule_status='active'
            where id=${claim.legacyPaymentMethodId}
          `;
          await tx`
            update shorts_mvp.billing_payment_method_remediation_attempts
            set status='compensated',old_schedule_paused=true,new_schedule_compensated=true,
              failure_code='FINAL_SWITCH_FAILED',failure_message='카드 연결 저장을 완료하지 못했습니다.',
              issued_card_ciphertext=null,issued_card_iv=null,issued_card_tag=null,
              finished_at=now()
            where id=${claim.attemptId}
          `;
          await tx`
            update shorts_mvp.billing_orders
            set status='failed',failure_code='FINAL_SWITCH_FAILED',
              failure_message='카드 연결 저장을 완료하지 못했습니다.'
            where id=${claim.billingOrderId}
          `;
          await tx`
            update shorts_mvp.billing_payment_method_remediations
            set state='required',claim_started_at=null,last_error_code='FINAL_SWITCH_FAILED',
              last_error_message='카드 연결 저장을 완료하지 못했습니다.'
            where id=${claim.remediationId}
          `;
        });
        throw new HttpError(503, "결제수단을 추가하지 못했습니다. 다시 시도해 주세요.", "PAYMENT_METHOD_RETRY_REQUIRED");
      }
      await setManualReview(
        claim,
        "FINAL_SWITCH_COMPENSATION_FAILED",
        "결제수단 연결 복구 결과를 확인하지 못했습니다.",
        newPaymentMethodId,
        newCompensated,
      );
      throw new HttpError(503, "구독 상태를 확인하고 있습니다.", "PAYMENT_METHOD_REVIEW_PENDING");
    }

    return NextResponse.json({ ok: true, paymentMethodUpdated: true });
  } catch (error) {
    return apiError(error, "결제수단을 추가하지 못했습니다.");
  }
}
