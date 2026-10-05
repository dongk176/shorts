export const nativeAvailable = () => typeof window.webkit?.messageHandlers?.easycutNative?.postMessage === "function";
export async function nativeCall(action) {
  if (!nativeAvailable()) throw new Error("iPhone 앱에서 사용할 수 있어요.");
  const result = await window.webkit.messageHandlers.easycutNative.postMessage({action});
  if (result?.error) throw new Error(result.error);
  return result;
}
