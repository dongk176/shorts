const TEMPLATE_LIBRARY_EVENT = "easycut-templates-changed";

export function notifyTemplateLibraryChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TEMPLATE_LIBRARY_EVENT));
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(TEMPLATE_LIBRARY_EVENT);
      channel.postMessage("changed");
      channel.close();
    } else {
      window.localStorage.setItem(TEMPLATE_LIBRARY_EVENT, String(Date.now()));
    }
  } catch { /* Restricted browser storage must never turn a successful save into a failure. */ }
}

export function subscribeTemplateLibraryChanges(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === TEMPLATE_LIBRARY_EVENT) onChange();
  };
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(TEMPLATE_LIBRARY_EVENT);
      channel.addEventListener("message", onChange);
    }
  } catch { /* Focus/pageshow refresh remains available if cross-tab messaging is disabled. */ }
  window.addEventListener(TEMPLATE_LIBRARY_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.close();
    window.removeEventListener(TEMPLATE_LIBRARY_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
