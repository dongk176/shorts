export async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through for browsers that expose Clipboard API but deny the call.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("클립보드를 사용할 수 없습니다.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  try {
    if (!document.execCommand("copy")) {
      throw new Error("클립보드에 복사하지 못했습니다.");
    }
  } finally {
    textarea.remove();
  }
}
