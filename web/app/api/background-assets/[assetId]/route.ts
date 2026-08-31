import { NextResponse } from "next/server";
import { getBackgroundAssetImage, removeBackgroundAssetFromLibrary } from "@/lib/background-assets";
import { backgroundAssetIdSchema } from "@/lib/background-assets-contract";
import { assertBackgroundAssetMutationOrigin } from "@/lib/background-assets-request";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ assetId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireAuthenticatedMvpSession({ allowPaymentMethodRemediation: true });
    const assetId = backgroundAssetIdSchema.parse((await context.params).assetId);
    const image = await getBackgroundAssetImage(getDb(), session.userId, assetId);
    return new Response(new Uint8Array(image.body), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(image.byteSize),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertBackgroundAssetMutationOrigin(request);
    const session = await requireAuthenticatedMvpSession({ allowPaymentMethodRemediation: true });
    const assetId = backgroundAssetIdSchema.parse((await context.params).assetId);
    return NextResponse.json(await removeBackgroundAssetFromLibrary(getDb(), session.userId, assetId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
