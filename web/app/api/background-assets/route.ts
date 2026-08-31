import { NextResponse } from "next/server";
import {
  beginBackgroundAssetUpload,
  failBackgroundAssetUpload,
  finishBackgroundAssetUpload,
  listBackgroundAssets,
  type BackgroundAssetReservation,
} from "@/lib/background-assets";
import { normalizeBackgroundAssetImage } from "@/lib/background-assets-image";
import { assertBackgroundAssetMutationOrigin, readBackgroundAssetUpload } from "@/lib/background-assets-request";
import { assertCustomTemplateDesignAccess, getCustomTemplateDesignAccess } from "@/lib/custom-template-design-access";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Old owned assets remain discoverable after a subscription expires or the
    // new-use release switch is disabled. No paid operation happens here.
    const session = await requireAuthenticatedMvpSession({ allowPaymentMethodRemediation: true });
    return NextResponse.json(await listBackgroundAssets(getDb(), session.userId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  let reservation: BackgroundAssetReservation | null = null;
  const dbForUpload = { current: null as ReturnType<typeof getDb> | null };
  try {
    assertBackgroundAssetMutationOrigin(request);
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    dbForUpload.current = db;
    assertCustomTemplateDesignAccess(await getCustomTemplateDesignAccess(db, session.userId));
    const file = await readBackgroundAssetUpload(request);
    reservation = await beginBackgroundAssetUpload(db, session.userId, {
      originalByteSize: file.size, displayName: file.name,
    });
    const image = await normalizeBackgroundAssetImage(Buffer.from(await file.arrayBuffer()), {
      filename: file.name, contentType: file.type,
    });
    const result = await finishBackgroundAssetUpload(db, reservation, image);
    return NextResponse.json(result, {
      status: result.reused ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (reservation && dbForUpload.current) {
      // If the DB is unavailable, the pending row remains quota-charged until
      // maintenance expires it. Never mask the original user-facing failure.
      await failBackgroundAssetUpload(dbForUpload.current, reservation).catch(() => undefined);
    }
    return apiError(error, "배경 이미지를 업로드하지 못했습니다.");
  }
}
