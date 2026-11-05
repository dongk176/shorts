import "server-only";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Private receiver settings never fall back to the ordinary upload service. */
export function uploadCandidateConfig(env: Record<string, string | undefined> = process.env) {
  const releaseId = env.FILE_UPLOAD_CANDIDATE_RELEASE_ID;
  if (!releaseId) {
    if (env.FILE_UPLOAD_CANDIDATE_ADMIN_ID || env.FILE_UPLOAD_CANDIDATE_EXPIRES_AT) throw new Error("Incomplete upload candidate identity");
    return null;
  }
  const administratorId = env.FILE_UPLOAD_CANDIDATE_ADMIN_ID ?? "";
  const expiresAt = Date.parse(env.FILE_UPLOAD_CANDIDATE_EXPIRES_AT ?? "");
  let receiver: URL;
  try { receiver = new URL(env.FILE_UPLOAD_RECEIVER_URL ?? ""); }
  catch { throw new Error("Invalid isolated upload receiver"); }
  if (!UUID.test(releaseId) || !UUID.test(administratorId) || !Number.isFinite(expiresAt)
    || receiver.protocol !== "https:"
    || receiver.pathname !== `/admin-upload/${releaseId}`
    || !/^arn:aws:lambda:ap-northeast-2:181651591905:function:shorts-upload-candidate-[a-z0-9-]+$/.test(env.FILE_UPLOAD_CAPACITY_FUNCTION_ARN ?? "")) {
    throw new Error("Invalid isolated upload candidate identity");
  }
  return { releaseId, administratorId, expiresAt };
}

export function uploadCandidateForUser(userId: string | null, now = Date.now()) {
  const config = uploadCandidateConfig();
  return config && config.administratorId === userId && config.expiresAt > now
    ? config : null;
}
