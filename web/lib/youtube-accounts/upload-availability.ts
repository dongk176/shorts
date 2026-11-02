import "server-only";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";

// Existing channel management and completed uploads remain available during a stop.
export async function assertYoutubeUploadAvailable() {
  const [flag] = await getDb()`select enabled from shorts_mvp.runtime_feature_flags
    where flag_key='youtube_upload_maintenance'`;
  if (flag?.enabled === true) {
    throw new HttpError(503, "YouTube 업로드를 잠시 점검하고 있습니다. 잠시 후 다시 시도해 주세요.", "YOUTUBE_UPLOAD_MAINTENANCE");
  }
}
