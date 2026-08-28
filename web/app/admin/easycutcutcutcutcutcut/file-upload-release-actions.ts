"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";

const adminPath = "/admin/easycutcutcutcutcutcut?tab=settings";
const modeSchema = z.enum([
  "stopped",
  "admin_test",
  "public",
  "emergency_stop",
]);

export type FileUploadReleaseMode = z.infer<typeof modeSchema>;

export async function updateFileUploadReleaseMode(
  requestedMode: FileUploadReleaseMode,
) {
  const mode = modeSchema.parse(requestedMode);
  const admin = await requireAdminUser();
  const rows = await getDb()`
    select mode,feature_enabled,public_enabled,emergency_stopped,updated_at
    from shorts_mvp.set_file_upload_release_mode(${mode},${admin.id})
  `;
  const row = rows[0];
  if (!row) throw new Error("파일 업로드 공개 상태를 변경하지 못했습니다.");
  revalidatePath(adminPath);
  return {
    mode: String(row.mode) as FileUploadReleaseMode,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
