export const POSITIONED_SUBTITLE_WORD_GAP_PX = 6 as const;
export const POSITIONED_SUBTITLE_JOINED_WORD_GAP_PX = 0 as const;

export type PositionedSubtitleWord = {
  text: string;
  fontSize: number;
  spaceBefore?: boolean;
};

export type PositionedSubtitleWordBox = {
  centerX: number;
  centerY: number;
  advanceWidth: number;
  gapBefore: number;
};

type CenteredAdvanceWord = {
  advanceWidth: number;
  gapBefore: number;
};

const round3 = (value: number) => Math.round(value * 1_000) / 1_000;

export function centeredAdvanceWordBoxes(
  words: readonly CenteredAdvanceWord[],
  centerX: number,
  centerY: number,
): PositionedSubtitleWordBox[] {
  const totalWidth = words.reduce((width, word, index) => (
    width + word.advanceWidth + (index > 0 ? word.gapBefore : 0)
  ), 0);
  let cursor = centerX - totalWidth / 2;

  return words.map((word, index) => {
    const gapBefore = index > 0 ? word.gapBefore : 0;
    cursor += gapBefore;
    const box = {
      centerX: round3(cursor + word.advanceWidth / 2),
      centerY: round3(centerY),
      advanceWidth: round3(word.advanceWidth),
      gapBefore: round3(gapBefore),
    };
    cursor += word.advanceWidth;
    return box;
  });
}
