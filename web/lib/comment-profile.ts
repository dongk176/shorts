export const CULTURE_COMMENT_PROFILE = "culture-flash-v1";
export const CULTURE_COMMENT_MODEL = "gemini-3.5-flash";
export type CommentProfile = typeof CULTURE_COMMENT_PROFILE;

export function usesCulturalComments(profile: CommentProfile | undefined, language: string | undefined) {
  return profile === CULTURE_COMMENT_PROFILE && (language === "en" || language === "ja");
}
