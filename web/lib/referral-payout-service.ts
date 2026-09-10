import "server-only";
import type { TransactionSql } from "postgres";
import { HttpError } from "@/lib/http";
import { loadReferralSettlements } from "@/lib/referral-settlement-server";
import { referralKstDate, referralMonthPeriod, type ReferralSettlementSnapshot } from "@/lib/referral-settlement";

export async function prepareReferralPayout(tx: TransactionSql, input: {
  partnerId: string; actorId: string; requestId: string; month: string; note?: string; now?: Date;
}) {
  const now = input.now ?? new Date();
  const period = referralMonthPeriod(input.month);
  if (referralKstDate(now) < period.scheduledPaymentDate) {
    throw new HttpError(409, `${period.scheduledPaymentDate}부터 지급 준비할 수 있습니다.`, "PAYOUT_NOT_DUE");
  }
  const [partner] = await tx`select * from shorts_mvp.referral_partners where id=${input.partnerId} for update`;
  if (!partner) throw new HttpError(404, "레퍼럴 파트너를 찾을 수 없습니다.");
  const [duplicate] = await tx`select id,partner_id,amount_krw,status,to_char(period_start,'YYYY-MM') as month
    from shorts_mvp.referral_payouts where request_id=${input.requestId}`;
  if (duplicate) {
    if (duplicate.partnerId !== input.partnerId || duplicate.month !== input.month) throw new HttpError(409, "다른 정산에 사용된 요청입니다.");
    return { payoutId: duplicate.id, amountKrw: Number(duplicate.amountKrw), alreadyProcessed: true };
  }
  if (!partner.accountNumberCiphertext) throw new HttpError(409, "파트너 정산 계좌가 등록되지 않았습니다.", "PAYOUT_PROFILE_REQUIRED");
  // Partner-first locking serializes different months and state changes.
  // Lock all installments so a concurrent refund cannot split this quote.
  await tx`select i.id from shorts_mvp.referral_commission_installments i
    join shorts_mvp.referral_commissions c on c.id=i.commission_id
    where c.partner_id=${input.partnerId} order by i.id for update of i`;
  const [ledger] = await loadReferralSettlements({ partnerId: input.partnerId, includeMonths: [input.month], now, db: tx });
  const month = ledger.months.find((row) => row.month === input.month)!;
  if (month.payoutId) throw new HttpError(409, "이미 준비되었거나 지급 완료된 실적 월입니다.", "PAYOUT_PERIOD_DUPLICATE");
  if (!month.payableNow) throw new HttpError(409, "환불 조정 후 이 실적 월에 지급할 금액이 없습니다.", "NO_PAYOUT_BALANCE");
  const items = await tx`select i.id,i.gross_amount_krw,i.recognized_amount_krw,
      i.commission_amount_krw,c.commission_rate_bps
    from shorts_mvp.referral_commission_installments i
    join shorts_mvp.referral_commissions c on c.id=i.commission_id
    where c.partner_id=${input.partnerId}
      and i.earned_at>=${period.periodStart}::timestamp at time zone 'Asia/Seoul'
      and i.earned_at<(${period.periodEnd}::date+1)::timestamp at time zone 'Asia/Seoul'
    order by i.earned_at,i.id`;
  const snapshot: ReferralSettlementSnapshot = {
    version: 1, capturedAt: now.toISOString(), month: input.month, ...period,
    confirmedSalesKrw: month.confirmedSalesKrw, waitingSalesKrw: month.waitingSalesKrw,
    futureSalesKrw: month.futureSalesKrw, commissionKrw: month.commissionKrw,
    refundAdjustmentKrw: month.refundAdjustmentKrw, payableKrw: month.payableKrw,
    installments: items.map((item) => ({ id: String(item.id),
      grossAmountKrw: Number(item.grossAmountKrw), recognizedAmountKrw: Number(item.recognizedAmountKrw),
      commissionAmountKrw: Number(item.commissionAmountKrw), commissionRateBps: Number(item.commissionRateBps) })),
  };
  const [payout] = await tx`insert into shorts_mvp.referral_payouts (
    request_id,partner_id,period_start,period_end,commission_cutoff_at,amount_krw,
    settlement_month,scheduled_payment_date,settlement_snapshot,
    bank_name_snapshot,account_holder_snapshot,account_number_ciphertext_snapshot,
    account_number_iv_snapshot,account_number_tag_snapshot,account_number_last4_snapshot,
    note,created_by_user_id
  ) values (
    ${input.requestId},${input.partnerId},${period.periodStart},${period.periodEnd},${now},${month.payableKrw},
    ${period.periodStart},${period.scheduledPaymentDate},${tx.json(snapshot)},
    ${partner.bankName},${partner.accountHolder},${partner.accountNumberCiphertext},
    ${partner.accountNumberIv},${partner.accountNumberTag},${partner.accountNumberLast4},
    ${input.note ?? null},${input.actorId}
  ) returning id`;
  let remaining = month.payableKrw;
  for (const item of snapshot.installments) {
    const amount = Math.min(remaining, item.commissionAmountKrw);
    if (amount > 0) await tx`insert into shorts_mvp.referral_payout_items(payout_id,installment_id,amount_krw)
      values(${payout.id},${item.id},${amount})`;
    remaining -= amount;
  }
  if (remaining !== 0) throw new Error("정산 회차 배정 합계가 일치하지 않습니다.");
  await tx`insert into shorts_mvp.referral_partner_audit_logs(
    request_id,partner_id,actor_type,actor_admin_user_id,action,entity_type,entity_id,metadata
  ) values(${input.requestId},${input.partnerId},'admin',${input.actorId},'referral.payout_created',
    'referral_payout',${payout.id},${tx.json({ month: input.month, amountKrw: month.payableKrw,
      refundAdjustmentKrw: month.refundAdjustmentKrw, scheduledPaymentDate: period.scheduledPaymentDate })})`;
  return { payoutId: payout.id, amountKrw: month.payableKrw, alreadyProcessed: false };
}

export async function finalizeReferralPayout(tx: TransactionSql, input: {
  payoutId: string; actorId: string; requestId: string; action: "paid" | "canceled";
  confirmedAmountKrw?: number; transferReference?: string; now?: Date;
}) {
  const now = input.now ?? new Date();
  const [identity] = await tx`select partner_id from shorts_mvp.referral_payouts where id=${input.payoutId}`;
  if (!identity) throw new HttpError(404, "정산 내역을 찾을 수 없습니다.");
  await tx`select id from shorts_mvp.referral_partners where id=${identity.partnerId} for update`;
  const [payout] = await tx`select * from shorts_mvp.referral_payouts where id=${input.payoutId} for update`;
  const [duplicate] = await tx`select entity_id,action from shorts_mvp.referral_partner_audit_logs where request_id=${input.requestId}`;
  if (duplicate) {
    if (duplicate.entityId !== input.payoutId || duplicate.action !== `referral.payout_${input.action}`) {
      throw new HttpError(409, "다른 정산 처리에 사용된 요청입니다.");
    }
    return { alreadyProcessed: true, amountKrw: Number(payout.amountKrw) };
  }
  if (payout.status !== "draft") throw new HttpError(409, "송금 준비 중인 정산만 처리할 수 있습니다.");
  const amount = Number(payout.amountKrw);
  if (input.action === "paid") {
    const month = String(payout.settlementMonth instanceof Date
      ? payout.settlementMonth.toISOString() : payout.settlementMonth ?? payout.periodStart).slice(0, 7);
    if (referralKstDate(now) < referralMonthPeriod(month).scheduledPaymentDate) {
      throw new HttpError(409, "지급 예정일 전에는 지급 완료를 기록할 수 없습니다.", "PAYOUT_NOT_DUE");
    }
    if (!input.transferReference?.trim()) throw new HttpError(400, "이체 확인값을 입력해 주세요.", "TRANSFER_REFERENCE_REQUIRED");
    if (input.confirmedAmountKrw !== amount) throw new HttpError(409, "준비된 금액과 실제 송금 확인액이 일치해야 합니다.", "PAYOUT_AMOUNT_MISMATCH");
    // Record cash exactly; later entitlement changes become refund debt.
  } else {
    await tx`delete from shorts_mvp.referral_payout_items where payout_id=${input.payoutId}`;
  }
  await tx`update shorts_mvp.referral_payouts set status=${input.action},
    paid_by_user_id=${input.action === "paid" ? input.actorId : null},
    paid_at=${input.action === "paid" ? now : null},
    canceled_at=${input.action === "canceled" ? now : null},
    transfer_reference=${input.action === "paid" ? input.transferReference! : null}
    where id=${input.payoutId}`;
  await tx`insert into shorts_mvp.referral_partner_audit_logs(
    request_id,partner_id,actor_type,actor_admin_user_id,action,entity_type,entity_id,metadata
  ) values(${input.requestId},${identity.partnerId},'admin',${input.actorId},${`referral.payout_${input.action}`},
    'referral_payout',${input.payoutId},${tx.json({ amountKrw: amount, transferReference: input.transferReference ?? null })})`;
  return { alreadyProcessed: false, amountKrw: amount };
}
