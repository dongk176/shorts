import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  DEFAULT_FAVORITE_TEMPLATE_KEYS,
  favoriteCustomTemplateId,
  resolveStoredFavoriteTemplateKeys,
  templateFavoriteKeysSchema,
} from "@/lib/template-favorites";

const favoriteTemplateInputSchema = templateFavoriteKeysSchema;

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const rows = await getDb()`
      select template_keys
      from shorts_mvp.template_favorite_preferences
      where user_id=${session.userId}
    `;
    return NextResponse.json({
      templateKeys: rows[0]
        ? resolveStoredFavoriteTemplateKeys(rows[0].templateKeys)
        : [...DEFAULT_FAVORITE_TEMPLATE_KEYS],
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAuthenticatedMvpSession();
    const templateKeys = favoriteTemplateInputSchema.parse((await request.json()).templateKeys);
    const db = getDb();

    await db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`template-favorites:${session.userId}`}, 0))`;
      for (const templateKey of templateKeys) {
        const customTemplateId = favoriteCustomTemplateId(templateKey);
        if (!customTemplateId) continue;
        const ownedRows = await tx`
          select id from shorts_mvp.custom_templates
          where id=${customTemplateId} and user_id=${session.userId}
        `;
        if (!ownedRows[0]) throw new HttpError(404, "저장할 개인 템플릿을 찾을 수 없습니다.");
      }
      await tx`
        insert into shorts_mvp.template_favorite_preferences (user_id, template_keys)
        values (${session.userId}, ${tx.json(templateKeys)})
        on conflict (user_id) do update
        set template_keys=excluded.template_keys, updated_at=now()
      `;
    });

    return NextResponse.json({ templateKeys });
  } catch (error) {
    return apiError(error);
  }
}
