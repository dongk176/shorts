import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { customTemplateFromRow } from "@/lib/custom-templates";
import {
  customTemplateInputSchema,
  isTemplateConfigV5,
  MAX_PERSONAL_TEMPLATES,
} from "@/lib/template-config";
import { getBillingSummary } from "@/lib/billing";
import { assertCustomTemplateAccess } from "@/lib/template-entitlements";
import {
  getPublicSubtitleTemplateAccess,
  getSubtitleTemplateAccess,
  lockSubtitleTemplateAccess,
} from "@/lib/subtitle-template-release";
import { assertUnifiedTemplateSubtitleCanaryAccess } from "@/lib/template-execution-snapshot";

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const rows = await db`
      select id, name, base_template_id, config, version, created_at, updated_at
      from shorts_mvp.custom_templates
      where user_id=${session.userId}
      order by updated_at desc, id desc
    `;
    const templates = rows.map(customTemplateFromRow);
    const hasUnifiedTemplates = templates.some((template) =>
      isTemplateConfigV5(template.config)
    );
    if (!hasUnifiedTemplates) {
      return NextResponse.json({ templates });
    }
    const access = session.isAdmin === true
      ? await getSubtitleTemplateAccess(db, session.userId)
      : await getPublicSubtitleTemplateAccess(db, session.userId);
    return NextResponse.json({
      templates: access.unifiedEnabled
        ? templates
        : templates.filter((template) => !isTemplateConfigV5(template.config)),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = customTemplateInputSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const created = await db.begin(async (tx) => {
      assertCustomTemplateAccess(await getBillingSummary(tx, session.userId));
      if (isTemplateConfigV5(input.config)) {
        assertUnifiedTemplateSubtitleCanaryAccess(
          await lockSubtitleTemplateAccess(tx, session.userId),
        );
      }
      await tx`select pg_advisory_xact_lock(hashtextextended(${`custom-template:${session.userId}`}, 0))`;
      const counts = await tx`
        select count(*)::int as count from shorts_mvp.custom_templates where user_id=${session.userId}
      `;
      if (Number(counts[0]?.count || 0) >= MAX_PERSONAL_TEMPLATES) {
        throw new HttpError(409, `개인 템플릿은 최대 ${MAX_PERSONAL_TEMPLATES}개까지 저장할 수 있습니다.`);
      }
      const rows = await tx`
        insert into shorts_mvp.custom_templates (user_id, name, base_template_id, config)
        values (${session.userId}, ${input.name}, ${input.baseTemplateId}, ${tx.json(input.config)})
        returning id, name, base_template_id, config, version, created_at, updated_at
      `;
      return customTemplateFromRow(rows[0]);
    });
    return NextResponse.json({ template: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
