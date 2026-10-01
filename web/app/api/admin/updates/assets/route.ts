import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { readCreatorJson } from "@/lib/creator-support-upload";
import { apiError, HttpError } from "@/lib/http";
import { getDb } from "@/lib/db";
export async function POST(request: Request) {
 try {
  assertSameOriginJsonRequest(request); const admin = await requireAdminUser();
  const { image } = z.object({ image: z.string().max(4_200_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).parse(await readCreatorJson(request, 4_210_000));
  const bytes = Buffer.from(image, "base64");
  if (bytes.length > 3 * 1024 * 1024) throw new HttpError(413, "사진은 3MB 이하로 선택해 주세요.");
  let output: { data: Buffer; info: sharp.OutputInfo };
  try {
   const source = sharp(bytes, { limitInputPixels: 24_000_000, animated: false }); const meta = await source.metadata();
   if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) throw new Error("unsupported");
   output = await source.rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
  } catch { throw new HttpError(400, "JPG, PNG, WEBP 정지 사진을 선택해 주세요."); }
  if (output.data.length > 3 * 1024 * 1024) throw new HttpError(413, "사진 크기를 줄여 다시 선택해 주세요.");
  const [asset] = await getDb()`insert into shorts_mvp.update_assets (image_bytes, created_by) values (${output.data}, ${admin.id}::uuid) returning id`;
  return NextResponse.json({ src: `/api/updates/assets/${asset.id}`, width: output.info.width, height: output.info.height }, { headers: { "Cache-Control": "no-store" } });
 } catch (e) { return apiError(e); }
}
