import type { TitleTextStyle, VideoAspectRatio } from "@/lib/contracts";
import { titleLineCharacterIndices, wrapPreviewTitle } from "@/lib/title-preview";

type CharacterTitleTextStyle = {
  color?: string;
  backgroundColor?: string;
};

function expandTitleTextStyles(
  styles: TitleTextStyle[],
  titleLength: number,
): CharacterTitleTextStyle[] {
  const characters: CharacterTitleTextStyle[] = Array.from(
    { length: titleLength },
    () => ({}),
  );
  styles.forEach((style) => {
    for (
      let index = Math.max(0, style.start);
      index < Math.min(titleLength, style.end);
      index += 1
    ) {
      characters[index] = {
        color: style.color,
        backgroundColor: style.backgroundColor,
      };
    }
  });
  return characters;
}

function compactTitleTextStyles(
  characters: CharacterTitleTextStyle[],
): TitleTextStyle[] {
  const next: TitleTextStyle[] = [];
  characters.forEach((style, index) => {
    if (!style.color && !style.backgroundColor) return;
    const previous = next.at(-1);
    if (
      previous
      && previous.end === index
      && previous.color === style.color
      && previous.backgroundColor === style.backgroundColor
    ) {
      previous.end += 1;
    } else {
      next.push({ start: index, end: index + 1, ...style });
    }
  });
  return next;
}

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
  const characters = expandTitleTextStyles(styles, titleLength);
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
  return compactTitleTextStyles(characters);
}

export function rebaseTitleTextStyles(
  previousTitle: string,
  nextTitle: string,
  styles: TitleTextStyle[],
): TitleTextStyle[] {
  const previousCharacters = Array.from(previousTitle);
  const nextCharacters = Array.from(nextTitle);
  const previousStyles = expandTitleTextStyles(
    styles,
    previousCharacters.length,
  );
  let commonPrefixLength = 0;
  while (
    commonPrefixLength < previousCharacters.length
    && commonPrefixLength < nextCharacters.length
    && previousCharacters[commonPrefixLength]
      === nextCharacters[commonPrefixLength]
  ) {
    commonPrefixLength += 1;
  }
  let commonSuffixLength = 0;
  while (
    commonSuffixLength
      < previousCharacters.length - commonPrefixLength
    && commonSuffixLength < nextCharacters.length - commonPrefixLength
    && previousCharacters[previousCharacters.length - 1 - commonSuffixLength]
      === nextCharacters[nextCharacters.length - 1 - commonSuffixLength]
  ) {
    commonSuffixLength += 1;
  }

  const nextStyles: CharacterTitleTextStyle[] = Array.from(
    { length: nextCharacters.length },
    () => ({}),
  );
  for (let index = 0; index < commonPrefixLength; index += 1) {
    nextStyles[index] = { ...previousStyles[index] };
  }
  for (let index = 0; index < commonSuffixLength; index += 1) {
    nextStyles[nextCharacters.length - commonSuffixLength + index] = {
      ...previousStyles[previousCharacters.length - commonSuffixLength + index],
    };
  }

  const nextChangedStart = commonPrefixLength;
  const nextChangedEnd = nextCharacters.length - commonSuffixLength;
  const previousChangedStart = commonPrefixLength;
  const previousChangedEnd = previousCharacters.length - commonSuffixLength;
  const replacedCharacterCount = Math.min(
    nextChangedEnd - nextChangedStart,
    previousChangedEnd - previousChangedStart,
  );
  for (let index = 0; index < replacedCharacterCount; index += 1) {
    nextStyles[nextChangedStart + index] = {
      ...previousStyles[previousChangedStart + index],
    };
  }

  const inheritedStyle = nextChangedStart > 0
    ? nextStyles[nextChangedStart - 1]
    : commonSuffixLength > 0
      ? nextStyles[nextChangedEnd]
      : {};
  for (
    let index = nextChangedStart + replacedCharacterCount;
    index < nextChangedEnd;
    index += 1
  ) {
    nextStyles[index] = { ...inheritedStyle };
  }
  return compactTitleTextStyles(nextStyles);
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
