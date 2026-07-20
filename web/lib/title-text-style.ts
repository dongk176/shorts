import type { TitleTextStyle, VideoAspectRatio } from "@/lib/contracts";
import { titleLineCharacterIndices, wrapPreviewTitle } from "@/lib/title-preview";

export function codePointOffset(value: string, codeUnitOffset: number) {
  return Array.from(value.slice(0, codeUnitOffset)).length;
}

export function applyTitleTextStyle(
  styles: TitleTextStyle[],
  titleLength: number,
  start: number,
  end: number,
  patch: { color?: string | null; backgroundColor?: string | null },
) {
  const characters: Array<{ color?: string; backgroundColor?: string }> = Array.from(
    { length: titleLength },
    () => ({}),
  );
  styles.forEach((style) => {
    for (let index = Math.max(0, style.start); index < Math.min(titleLength, style.end); index += 1) {
      characters[index] = { color: style.color, backgroundColor: style.backgroundColor };
    }
  });
  for (let index = Math.max(0, start); index < Math.min(titleLength, end); index += 1) {
    const current = characters[index];
    if (patch.color !== undefined) {
      if (patch.color) current.color = patch.color;
      else delete current.color;
    }
    if (patch.backgroundColor !== undefined) {
      if (patch.backgroundColor) current.backgroundColor = patch.backgroundColor;
      else delete current.backgroundColor;
    }
  }
  const next: TitleTextStyle[] = [];
  characters.forEach((style, index) => {
    if (!style.color && !style.backgroundColor) return;
    const previous = next.at(-1);
    if (previous && previous.end === index && previous.color === style.color && previous.backgroundColor === style.backgroundColor) {
      previous.end += 1;
    } else {
      next.push({ start: index, end: index + 1, ...style });
    }
  });
  return next;
}

export function defaultTemplateTitleTextStyles(
  title: string,
  videoAspectRatio: VideoAspectRatio,
  background: string,
  accentBackground: string | null,
): TitleTextStyle[] {
  const overlayMode = videoAspectRatio === "9:16";
  const selectedBackground = overlayMode ? accentBackground || background : accentBackground;
  if (!selectedBackground) return [];
  const lines = wrapPreviewTitle(title);
  const indices = titleLineCharacterIndices(title, lines);
  const selectedIndices = (overlayMode ? indices.flat() : indices[1] || [])
    .filter((index): index is number => index !== null);
  if (!selectedIndices.length) return [];
  return [{
    start: Math.min(...selectedIndices),
    end: Math.max(...selectedIndices) + 1,
    backgroundColor: selectedBackground,
  }];
}
