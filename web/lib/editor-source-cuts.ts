/** Legacy title-only rendering cannot preserve a source sequence. */
export function hasEditorSourceCuts(document: unknown): boolean {
  if (!document || typeof document !== "object" || !("video" in document)) return false;
  const video = document.video;
  if (!video || typeof video !== "object" || !("clips" in video)) return false;
  return Array.isArray(video.clips) && video.clips.length > 1;
}
