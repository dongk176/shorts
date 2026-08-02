import type { TitleTextStyle } from "@/lib/contracts";

const TITLE_MAX_CHARS = 20;
const TITLE_MAX_LINES = 2;
export const TITLE_MAX_WIDTH = 930;
export const TITLE_LINE_GAP = 18;

export function titlePreviewLinePaddingX(fontSize: number) {
  return Math.max(1, Math.round(fontSize * 0.34));
}

export function titlePreviewLinePaddingY(fontSize: number) {
  return Math.max(1, Math.round(fontSize * 0.14));
}

export function titlePreviewLineBoxHeight(
  fontSize: number,
  hasBackground: boolean,
) {
  return fontSize + (hasBackground ? titlePreviewLinePaddingY(fontSize) * 2 : 0);
}

export function titleLineBackground(
  index: number,
  overlayMode: boolean,
  background: string,
  accentBackground: string | null,
) {
  if (overlayMode) return accentBackground || background;
  if (index === 1 && accentBackground) return accentBackground;
  return null;
}

export function titleLineColor(
  index: number,
  overlayMode: boolean,
  primary: string,
  accent: string,
  keepPrimaryFirstLine = false,
) {
  return (overlayMode && !keepPrimaryFirstLine) || index === 1 ? accent : primary;
}

function characters(value: string) {
  return Array.from(value);
}

function sliceCharacters(value: string, start: number, end?: number) {
  return characters(value).slice(start, end).join("");
}

export function wrapPreviewTitle(title: string): string[] {
  const manualLines = title
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (manualLines.length > 1) return manualLines.slice(0, TITLE_MAX_LINES);

  const clean = sliceCharacters(title.replace(/\s+/g, " ").trim(), 0, 40);
  if (!clean) return ["핵심 장면"];
  const cleanCharacters = characters(clean);
  if (cleanCharacters.length > TITLE_MAX_CHARS) {
    const balanced = cleanCharacters.flatMap((character, index) => {
      if (character !== " ") return [];
      const first = sliceCharacters(clean, 0, index).trim();
      const second = sliceCharacters(clean, index + 1).trim();
      if (!first || !second || characters(first).length > TITLE_MAX_CHARS || characters(second).length > TITLE_MAX_CHARS) return [];
      return [[first, second] as const];
    });
    if (balanced.length) {
      return [...balanced.reduce((best, candidate) =>
        Math.abs(characters(candidate[0]).length - characters(candidate[1]).length)
          < Math.abs(characters(best[0]).length - characters(best[1]).length)
          ? candidate
          : best
      )];
    }
  }

  const lines: string[] = [];
  let remaining = clean;
  while (remaining && lines.length < TITLE_MAX_LINES) {
    const remainingCharacters = characters(remaining);
    if (remainingCharacters.length <= TITLE_MAX_CHARS) {
      lines.push(remaining);
      remaining = "";
      break;
    }
    const window = remainingCharacters.slice(0, TITLE_MAX_CHARS + 1);
    let splitAt = -1;
    for (let index = TITLE_MAX_CHARS; index >= Math.floor(TITLE_MAX_CHARS / 2); index -= 1) {
      if (window[index] === " ") {
        splitAt = index;
        break;
      }
    }
    if (splitAt < 1) splitAt = TITLE_MAX_CHARS;
    lines.push(remainingCharacters.slice(0, splitAt).join("").trim());
    remaining = remainingCharacters.slice(splitAt).join("").trim();
  }
  if (remaining && lines.length) {
    lines[lines.length - 1] = `${sliceCharacters(lines[lines.length - 1], 0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
  }
  return lines;
}

export function titleLineCharacterIndices(title: string, lines: string[]) {
  const normalized: Array<{ character: string; index: number }> = [];
  Array.from(title).forEach((character, index) => {
    if (/\s/u.test(character)) {
      if (normalized.length && normalized[normalized.length - 1].character !== " ") {
        normalized.push({ character: " ", index });
      }
      return;
    }
    normalized.push({ character, index });
  });
  while (normalized[0]?.character === " ") normalized.shift();
  while (normalized.at(-1)?.character === " ") normalized.pop();
  let searchFrom = 0;
  return lines.map((line) => {
    let searchableCharacters = Array.from(line);
    let syntheticEllipsis = false;
    const findStart = () => {
      for (let candidate = searchFrom; candidate <= normalized.length - searchableCharacters.length; candidate += 1) {
        if (searchableCharacters.every((character, offset) => normalized[candidate + offset].character === character)) {
          return candidate;
        }
      }
      return -1;
    };
    let start = findStart();
    if (start < 0 && line.endsWith("…")) {
      searchableCharacters = Array.from(line.slice(0, -1));
      syntheticEllipsis = true;
      start = findStart();
    }
    if (start < 0) return Array.from(line).map(() => null);
    searchFrom = start + searchableCharacters.length;
    const indices = normalized.slice(start, searchFrom).map((item) => item.index as number | null);
    if (syntheticEllipsis) indices.push(null);
    return indices;
  });
}

export function styledTitleLineRuns(
  line: string,
  indices: Array<number | null>,
  styles: TitleTextStyle[],
) {
  const runs: Array<{
    text: string;
    color?: string;
    backgroundColor?: string;
  }> = [];
  Array.from(line).forEach((character, characterIndex) => {
    const titleIndex = indices[characterIndex];
    const style = titleIndex === null
      ? undefined
      : styles.find((item) => item.start <= titleIndex && item.end > titleIndex);
    const previous = runs.at(-1);
    if (
      previous
      && previous.color === style?.color
      && previous.backgroundColor === style?.backgroundColor
    ) {
      previous.text += character;
    } else {
      runs.push({
        text: character,
        color: style?.color,
        backgroundColor: style?.backgroundColor,
      });
    }
  });
  return runs;
}

function estimatedCharacterWidth(character: string) {
  if (/\s/u.test(character)) return 0.28;
  if (/\p{Script=Hangul}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) return 1;
  if (/\p{Extended_Pictographic}/u.test(character)) return 1;
  if (/[A-Z]/.test(character)) return 0.68;
  if (/[a-z]/.test(character)) return 0.56;
  if (/[0-9]/.test(character)) return 0.62;
  return 0.45;
}

export function fitPreviewTitleFont(
  lines: string[],
  measureLine: (line: string, fontSize: number) => number = (line, fontSize) =>
    characters(line).reduce((width, character) => width + estimatedCharacterWidth(character) * fontSize, 0),
) {
  for (let size = 84; size >= 22; size -= 2) {
    if (Math.max(...lines.map((line) => measureLine(line, size))) <= TITLE_MAX_WIDTH) return size;
  }
  return 22;
}
