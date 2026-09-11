export const YOUTUBE_WEB_URL = "https://www.youtube.com/";

export function creatorYouTubeUrl(device: { userAgent: string; platform: string; maxTouchPoints: number }) {
  if (/Android/i.test(device.userAgent)) {
    return "intent://www.youtube.com/#Intent;scheme=https;package=com.google.android.youtube;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.google.android.youtube;end";
  }
  if (/iPhone|iPad|iPod/i.test(device.userAgent) || (device.platform === "MacIntel" && device.maxTouchPoints > 1)) {
    // YouTube publishes this scheme in its own al:ios:url metadata.
    return "vnd.youtube://www.youtube.com/";
  }
  return YOUTUBE_WEB_URL;
}

function phoneDigits(value: string) {
  return value.normalize("NFKC").replace(/^\+82\s*0?/, "0").replace(/\D/g, "").slice(0, 11);
}

export function formatCreatorPhone(value: string) {
  const digits = phoneDigits(value);
  if (digits.length <= 3) return digits;
  const middleEnd = digits.length === 10 && !digits.startsWith("010") ? 6 : 7;
  return [digits.slice(0, 3), digits.slice(3, middleEnd), digits.slice(middleEnd)].filter(Boolean).join("-");
}

export function editCreatorPhone(previous: string, raw: string, selectionStart: number, inputType: string) {
  let digits = phoneDigits(raw);
  let before = phoneDigits(raw.slice(0, selectionStart)).length;
  // Deleting a generated separator should delete the neighbouring digit, not
  // immediately reinsert the separator and leave the caret stuck.
  if (raw.length < previous.length && digits === phoneDigits(previous)) {
    const index = inputType === "deleteContentBackward" ? before - 1 : inputType === "deleteContentForward" ? before : -1;
    if (index >= 0) {
      digits = digits.slice(0, index) + digits.slice(index + 1);
      if (inputType === "deleteContentBackward") before -= 1;
    }
  }
  const value = formatCreatorPhone(digits);
  let caret = 0, seen = 0;
  while (caret < value.length && seen < before) {
    if (/\d/.test(value[caret])) seen += 1;
    caret += 1;
  }
  return { value, caret };
}
