function commentDisplayUnits(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      (part) => part.segment,
    );
  }
  // Match the worker's display units when native segmentation is unavailable.
  const units: string[] = [];
  const isRegional = (code: number) => code >= 0x1F1E6 && code <= 0x1F1FF;
  for (const character of Array.from(value)) {
    const code = character.codePointAt(0)!;
    const previous = units.at(-1);
    const regionalPair = previous && isRegional(code)
      && Array.from(previous).length === 1 && isRegional(previous.codePointAt(0)!);
    if (previous && (
      /\p{Mark}/u.test(character) || character === "\u200d" || previous.endsWith("\u200d")
      || (code >= 0x1F3FB && code <= 0x1F3FF)
      || (code >= 0xE0020 && code <= 0xE007F) || regionalPair
    )) units[units.length - 1] += character;
    else units.push(character);
  }
  return units;
}

// Matches the fixed 1080 x 285 card used by saved caption compositions.
export function wrapCaptionComment(text: string, measure: (text: string) => number, width = 891) {
  let remaining = text.replace(/\s+/gu, " ").trim() || "아 진짜 ㅋㅋㅋㅋㅋㅋㅋㅋ";
  const lines: string[] = [];
  const units = commentDisplayUnits;
  while (remaining && lines.length < 2) {
    if (measure(remaining) <= width) {
      lines.push(remaining);
      remaining = "";
      break;
    }
    let split = units(remaining)[0].length;
    let index = 0;
    for (const unit of units(remaining)) {
      index += unit.length;
      if (measure(remaining.slice(0, index)) > width) break;
      split = index;
    }
    const space = remaining.lastIndexOf(" ", split);
    if (space >= Math.max(1, Math.floor(split / 2))) split = space;
    lines.push(remaining.slice(0, split).trim());
    remaining = remaining.slice(split).trim();
  }
  if (remaining && lines.length) {
    let last = lines.at(-1)!;
    while (last && measure(`${last}…`) > width) last = units(last).slice(0, -1).join("").trimEnd();
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

export function fitCaptionChannel(
  name: string, fontSize: number, measure: (text: string, size: number) => number,
) {
  const text = Array.from(name.replace(/\s+/gu, " ").trim()).slice(0, 50).join("") || "YouTube 채널";
  let size = fontSize;
  while (size > 20 && measure(text, size) > 716) size -= 2;
  const icon = size * 1.25;
  // Pillow/Python rounds half pixels to the nearest even integer.
  const roundedIcon = icon % 1 === 0.5 ? Math.round(icon / 2) * 2 : Math.round(icon);
  return { text, fontSize: size, iconSize: Math.max(36, roundedIcon), gap: Math.max(12, Math.round(size * 0.36)) };
}
