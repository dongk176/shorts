import { NextResponse } from "next/server";
import { z } from "zod";
import { customTemplateFromRow } from "@/lib/custom-templates";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { templateConfigSchema } from "@/lib/template-config";
import { assertCustomTemplateAccess } from "@/lib/template-entitlements";

const paramsSchema = z.object({ templateId: z.string().uuid() });
const updateSchema = z.object({
  name: z.string().trim().min(1).max(50),
  config: templateConfigSchema,
  version: z.number().int().min(1),
}).strict();

type Context = { params: Promise<{ templateId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { templateId } = paramsSchema.parse(await context.params);
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const rows = await db`
      select id, name, base_template_id, config, version, created_at, updated_at
      from shorts_mvp.custom_templates
      where id=${templateId} and user_id=${session.userId}
      limit 1
    `;
    if (!rows[0]) throw new HttpError(404, "템플릿을 찾을 수 없습니다.");
    return NextResponse.json({ template: customTemplateFromRow(rows[0]) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { templateId } = paramsSchema.parse(await context.params);
    const input = updateSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    assertCustomTemplateAccess(await getBillingSummary(db, session.userId));
    const rows = await db`
      update shorts_mvp.custom_templates
      set name=${input.name}, config=${db.json(input.config)}, version=version + 1
      where id=${templateId} and user_id=${session.userId} and version=${input.version}
      returning id, name, base_template_id, config, version, created_at, updated_at
    `;
    if (!rows[0]) {
      const existing = await db`
        select version from shorts_mvp.custom_templates where id=${templateId} and user_id=${session.userId}
      `;
      if (!existing[0]) throw new HttpError(404, "템플릿을 찾을 수 없습니다.");
      throw new HttpError(409, "다른 창에서 템플릿이 수정되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
    return NextResponse.json({ template: customTemplateFromRow(rows[0]) });
  } catch (error) {
    return apiError(error);
  }
}
