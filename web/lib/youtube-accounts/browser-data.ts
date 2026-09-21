// Only this feature's optional drafts in the current tab; never clear unrelated
// login/preferences or expose stored values to the server.
export function clearYoutubeDrafts() {
  try {
    const storage = window.sessionStorage;
    const keys = Array.from({length:storage.length},(_,index)=>storage.key(index));
    for (const key of keys) if (key?.startsWith('easycut-publish-draft:') || key === 'easycut-publish-return-v1') storage.removeItem(key);
  } catch { /* Storage may be disabled. */ }
}
