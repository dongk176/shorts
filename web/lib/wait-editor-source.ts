/** Retry only the explicit retained-source preparation state, never auth failures. */
export async function waitForEditorSource<T>(
  load: () => Promise<T>,
  cancelled: () => boolean,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 5000)),
): Promise<T | undefined> {
  // Uploads retain padded sources after all shorts finish rendering. A ready
  // first short can therefore precede its editable source by several minutes.
  const maxRetries = 120;
  for (let attempt = 0; attempt <= maxRetries && !cancelled(); attempt += 1) {
    try { return await load(); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error)
        || error.code !== "EDITOR_SOURCE_PREPARING" || attempt === maxRetries) throw error;
      await pause();
    }
  }
}
