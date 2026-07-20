import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { customTemplateFromRow } from "@/lib/custom-templates";
import { customTemplateInputSchema, MAX_PERSONAL_TEMPLATES } from "@/lib/template-config";

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
    return NextResponse.json({ templates: rows.map(customTemplateFromRow) });
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
