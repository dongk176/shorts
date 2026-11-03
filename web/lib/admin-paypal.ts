import "server-only";
import { getDb } from "@/lib/db";
import type { AdminOrder } from "./admin-billing-contract";

export async function loadAdminPayPalOrders(ids:string[]):Promise<AdminOrder[]> {
  const rows=await getDb()`select o.*,u.email,s.status as subscription_status from shorts_mvp.paypal_one_time_orders o
    join shorts_mvp.app_users u on u.id=o.user_id left join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
    where o.id=any(${ids}::uuid[]) and o.environment='live' and o.status='completed'`;
  const iso=(value:unknown)=>value?new Date(value as string).toISOString():null;
  return rows.map(r=>({id:r.id,orderId:r.captureId,kind:'일회성 이용권',productCode:r.planCode,
    billingCycle:'일회성 · 자동 갱신 없음',prepaidMonths:Number(/_(3|6|12)m$/.exec(r.planCode)?.[1]||1),refundPolicyVersion:4,
    amountKrw:0,refundedAmountKrw:0,reservedRefundKrw:0,currency:'USD',amountMinor:Number(r.amountMinor),refundedAmountMinor:Number(r.refundedMinor),
    chargebackMinor:r.reversed?Math.max(0,Number(r.amountMinor)-Number(r.refundedMinor)):0,pendingRefundMinor:0,
    refundStatus:Number(r.refundedMinor)>=Number(r.amountMinor)?'full':Number(r.refundedMinor)>0?'partial':'none',
    status:'succeeded',provider:'paypal',providerTransactionId:r.captureId,providerStatus:r.reversed?'reversed':r.entitlementHold?'manual_review':'completed',
    providerTerminalId:null,hasPaymentMethod:false,credentialScope:null,installmentMonths:0,cardIssuerName:null,installmentBenefitType:null,
    declaredCardKind:null,failureCode:r.lastErrorCode,failureMessage:null,approvedAt:iso(r.paidAt),createdAt:iso(r.createdAt)!,email:r.email||'-',
    subscriptionStatus:r.subscriptionStatus,contractPeriodStart:iso(r.paidAt),contractPeriodEnd:iso(r.accessEnd),currentPackageMonthUsed:false,
    firstCompletedJobAt:null,popularFilterUsageCount:0,popularFilterLastUsedAt:null}));
}
