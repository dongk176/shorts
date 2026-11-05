/** Retry only the explicit retained-source preparation state, never auth failures. */
export async function waitForEditorSource<T>(
  load: () => Promise<T>,
  cancelled: () => boolean,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 5000)),
): Promise<T | undefined> {
  for (let attempt = 0; attempt < 13 && !cancelled(); attempt += 1) {
    try { return await load(); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error)
        || error.code !== "EDITOR_SOURCE_PREPARING" || attempt === 12) throw error;
      await pause();
    }
  }
}
