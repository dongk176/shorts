import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const termSchema = z.object({
  issuerCode: z.string().trim().min(2).max(30),
  issuerName: z.string().trim().min(2).max(50),
  benefitType: z.enum(["interest_free", "partial_interest_free"]),
  installmentMonths: z.number().int().min(2).max(36),
  customerPaidInstallments: z.number().int().min(1).max(35).nullable(),
  minAmountKrw: z.number().int().nonnegative().nullable(),
  displayOrder: z.number().int().default(0),
  note: z.string().trim().max(500).default(""),
}).superRefine((value, ctx) => {
  if ((value.benefitType === "interest_free") !== (value.customerPaidInstallments === null)) {
    ctx.addIssue({ code: "custom", message: "부분 무이자는 고객 부담 회차가 필요합니다." });
  }
  if (
    value.customerPaidInstallments !== null
    && value.customerPaidInstallments >= value.installmentMonths
  ) ctx.addIssue({ code: "custom", message: "고객 부담 회차는 할부 개월보다 작아야 합니다." });
});

const saveSchema = z.object({
  action: z.enum(["save", "publish"]),
  campaignId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(100),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date(),
  defaultMinAmountKrw: z.number().int().nonnegative(),
  notice: z.string().trim().max(1000),
  terms: z.array(termSchema).max(500),
}).strict();

const capabilitySchema = z.object({
  action: z.literal("capability"),
  installmentMonths: z.number().int().min(2).max(36),
  enabled: z.boolean(),
  note: z.string().trim().max(500).default(""),
}).strict();

const cloneSchema = z.object({
  action: z.literal("clone"),
  sourceCampaignId: z.string().uuid(),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date(),
  name: z.string().trim().min(2).max(100),
}).strict();

const endSchema = z.object({
  action: z.literal("end"),
  campaignId: z.string().uuid(),
}).strict();

export async function GET() {
  try {
    await requireAdminUser();
    const db = getDb();
    const [campaigns, terms, capabilities] = await Promise.all([
      db`select * from shorts_mvp.installment_campaigns order by effective_from desc,created_at desc limit 24`,
      db`
        select t.* from shorts_mvp.installment_campaign_terms t
        where t.campaign_id in (
          select id from shorts_mvp.installment_campaigns order by effective_from desc limit 24
        )
        order by t.display_order,t.issuer_name,t.benefit_type,t.installment_months
      `,
      db`
        select * from shorts_mvp.payment_provider_installment_capabilities
        where provider='thepayone' order by installment_months
      `,
    ]);
    return NextResponse.json({ campaigns, terms, capabilities });
  } catch (error) {
    return apiError(error, "할부 캠페인을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const admin = await requireAdminUser();
    const raw = await request.json();
    const db = getDb();
    if (raw?.action === "capability") {
      const body = capabilitySchema.parse(raw);
      await db.begin(async (tx) => {
        await tx`
          insert into shorts_mvp.payment_provider_installment_capabilities (
            provider,installment_months,enabled,verified_at,note,updated_by_user_id
          ) values (
            'thepayone',${body.installmentMonths},${body.enabled},
            ${body.enabled ? new Date() : null},${body.note},${admin.id}
          )
          on conflict (provider,installment_months) do update
          set enabled=excluded.enabled,verified_at=excluded.verified_at,
            note=excluded.note,updated_by_user_id=excluded.updated_by_user_id
        `;
        await tx`
          insert into shorts_mvp.admin_audit_logs (
            actor_user_id,action,entity_type,entity_id,metadata
          ) values (
            ${admin.id},'billing.installment_capability_changed','installment_capability',
            ${`thepayone:${body.installmentMonths}`},
            ${tx.json({ enabled: body.enabled, note: body.note })}
          )
        `;
      });
      return NextResponse.json({ ok: true });
    }
    if (raw?.action === "clone") {
      const body = cloneSchema.parse(raw);
      const rows = await db.begin(async (tx) => {
        const sourceRows = await tx`
          select * from shorts_mvp.installment_campaigns where id=${body.sourceCampaignId}
        `;
        if (!sourceRows[0]) throw new HttpError(404, "복제할 캠페인을 찾을 수 없습니다.");
        const inserted = await tx`
          insert into shorts_mvp.installment_campaigns (
            name,effective_from,effective_to,status,default_min_amount_krw,notice,created_by_user_id
          ) values (
            ${body.name},${body.effectiveFrom},${body.effectiveTo},'draft',
            ${Number(sourceRows[0].defaultMinAmountKrw)},${sourceRows[0].notice},${admin.id}
          ) returning *
        `;
        await tx`
          insert into shorts_mvp.installment_campaign_terms (
            campaign_id,issuer_code,issuer_name,benefit_type,installment_months,
            customer_paid_installments,min_amount_krw,display_order,note
          )
          select ${inserted[0].id},issuer_code,issuer_name,benefit_type,installment_months,
            customer_paid_installments,min_amount_krw,display_order,note
          from shorts_mvp.installment_campaign_terms where campaign_id=${body.sourceCampaignId}
        `;
        return inserted;
      });
      return NextResponse.json({ ok: true, campaign: rows[0] });
    }
    if (raw?.action === "end") {
      const body = endSchema.parse(raw);
      const rows = await db.begin(async (tx) => {
        const updated = await tx`
          update shorts_mvp.installment_campaigns set status='ended'
          where id=${body.campaignId} and status='published'
          returning *
        `;
        if (!updated[0]) throw new HttpError(409, "게시 중인 캠페인만 종료할 수 있습니다.");
        await tx`
          insert into shorts_mvp.admin_audit_logs (
            actor_user_id,action,entity_type,entity_id,metadata
          ) values (
            ${admin.id},'billing.installment_campaign_ended','installment_campaign',
            ${body.campaignId},'{}'::jsonb
          )
        `;
        return updated;
      });
      return NextResponse.json({ ok: true, campaign: rows[0] });
    }

    const body = saveSchema.parse(raw);
    const rows = await db.begin(async (tx) => {
      let campaignId = body.campaignId || null;
      if (campaignId) {
        const locked = await tx`
          select * from shorts_mvp.installment_campaigns where id=${campaignId} for update
        `;
        if (!locked[0]) throw new HttpError(404, "캠페인을 찾을 수 없습니다.");
        if (locked[0].status !== "draft") {
          throw new HttpError(409, "게시된 캠페인은 수정할 수 없습니다. 복제해 새 초안을 만들어 주세요.");
        }
        await tx`
          update shorts_mvp.installment_campaigns
          set name=${body.name},effective_from=${body.effectiveFrom},effective_to=${body.effectiveTo},
            default_min_amount_krw=${body.defaultMinAmountKrw},notice=${body.notice}
          where id=${campaignId}
        `;
        await tx`delete from shorts_mvp.installment_campaign_terms where campaign_id=${campaignId}`;
      } else {
        const inserted = await tx`
          insert into shorts_mvp.installment_campaigns (
            name,effective_from,effective_to,status,default_min_amount_krw,notice,created_by_user_id
          ) values (
            ${body.name},${body.effectiveFrom},${body.effectiveTo},'draft',
            ${body.defaultMinAmountKrw},${body.notice},${admin.id}
          ) returning id
        `;
        campaignId = inserted[0].id;
      }
      for (const term of body.terms) await tx`
        insert into shorts_mvp.installment_campaign_terms (
          campaign_id,issuer_code,issuer_name,benefit_type,installment_months,
          customer_paid_installments,min_amount_krw,display_order,note
        ) values (
          ${campaignId},${term.issuerCode},${term.issuerName},${term.benefitType},
          ${term.installmentMonths},${term.customerPaidInstallments},${term.minAmountKrw},
          ${term.displayOrder},${term.note}
        )
      `;
      if (body.action === "publish") await tx`
        update shorts_mvp.installment_campaigns
        set status='published',published_by_user_id=${admin.id},published_at=now()
        where id=${campaignId} and status='draft'
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},${body.action === "publish" ? "billing.installment_campaign_published" : "billing.installment_campaign_saved"},
          'installment_campaign',${campaignId},${tx.json({ termCount: body.terms.length })}
        )
      `;
      return tx`select * from shorts_mvp.installment_campaigns where id=${campaignId}`;
    });
    return NextResponse.json({ ok: true, campaign: rows[0] });
  } catch (error) {
    return apiError(error, "할부 캠페인을 저장하지 못했습니다.");
  }
}
