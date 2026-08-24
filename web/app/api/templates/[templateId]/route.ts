import { NextResponse } from "next/server";
import { z } from "zod";
import { customTemplateFromRow } from "@/lib/custom-templates";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  isTemplateConfigV5,
  templateConfigSchema,
} from "@/lib/template-config";
import { assertCustomTemplateAccess } from "@/lib/template-entitlements";
import {
  getSubtitleTemplateAccess,
  lockSubtitleTemplateAccess,
} from "@/lib/subtitle-template-release";
import { assertUnifiedTemplateSubtitleCanaryAccess } from "@/lib/template-execution-snapshot";

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
    const template = customTemplateFromRow(rows[0]);
    if (isTemplateConfigV5(template.config)) {
      assertUnifiedTemplateSubtitleCanaryAccess(
        await getSubtitleTemplateAccess(db, session.userId),
      );
    }
    return NextResponse.json({ template });
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
    const updated = await db.begin(async (tx) => {
      assertCustomTemplateAccess(await getBillingSummary(tx, session.userId));
      const currentRows = await tx`
        select config,version from shorts_mvp.custom_templates
        where id=${templateId} and user_id=${session.userId}
        limit 1 for update
      `;
      if (!currentRows[0]) {
        throw new HttpError(404, "템플릿을 찾을 수 없습니다.");
      }
      if (Number(currentRows[0].version) !== input.version) {
        throw new HttpError(409, "다른 창에서 템플릿이 수정되었습니다. 새로고침 후 다시 시도해 주세요.");
      }
      const currentConfig = templateConfigSchema.parse(currentRows[0].config);
      if (isTemplateConfigV5(currentConfig) || isTemplateConfigV5(input.config)) {
        assertUnifiedTemplateSubtitleCanaryAccess(
          await lockSubtitleTemplateAccess(tx, session.userId),
        );
      }
      const rows = await tx`
        update shorts_mvp.custom_templates
        set name=${input.name}, config=${tx.json(input.config)}, version=version + 1
        where id=${templateId} and user_id=${session.userId} and version=${input.version}
        returning id, name, base_template_id, config, version, created_at, updated_at
      `;
      if (!rows[0]) {
        throw new HttpError(409, "다른 창에서 템플릿이 수정되었습니다. 새로고침 후 다시 시도해 주세요.");
      }
      return customTemplateFromRow(rows[0]);
    });
    return NextResponse.json({ template: updated });
  } catch (error) {
    return apiError(error);
  }
}
