import type {
  CaptionRenderSpec,
  CaptionRenderSpecV4,
} from "./caption-render-spec";
import {
  DEFAULT_EDITOR_FONT_ID,
  editorCaptionCssToAssBaselineOffsetEmById,
  editorCaptionCssToAssScaleById,
  editorCaptionFontFamily,
  resolveEditorFontFace,
  resolveEditorFontFaceV4,
  type EditorFontId,
} from "./editor-fonts";
import type { VideoAspectRatio } from "./contracts";
import type {
  EditorSubtitleCueEdit,
  EditorSubtitleLayout,
} from "./editor-render-spec";
import type { EditorVideoClip } from "./editor-video-cuts";
import {
  EDITOR_RENDER_CANVAS,
  EDITOR_SUBTITLE_OFFSET_Y_MAX,
  EDITOR_SUBTITLE_OFFSET_Y_MIN,
  normalizeEditorSubtitleLayout,
} from "./editor-render-spec";
import {
  SUBTITLE_TEMPLATE_BRAND_COLOR,
  SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  subtitleTemplateStyleSnapshot,
} from "./subtitle-templates";
import type { TemplatePresetColor } from "./template-config";

const frameAt = (seconds: number, fps: number) => (
  Math.floor(seconds * fps + 0.5)
);

type CaptionCue = CaptionRenderSpec["cues"][number];
type CaptionWord = CaptionCue["words"][number];
export type CaptionTextMeasurer = (text: string, fontSize: number) => number;
type CaptionClipWindow = {
  startFrame: number;
  endFrame: number;
  outputStartFrame: number;
};

export type EditorCaptionPreviewCompileOptions = {
  layout?: EditorSubtitleLayout;
};

export type EditorHighlightCaptionSpecOptions = {
  schemaVersion?: 3 | 4;
  fontSize?: number;
};

export type EditorCaptionTextEditTarget = {
  sourceCueIndex: number;
  originalText: string;
  currentText: string;
};

export type EditorCaptionTextDraft = {
  sourceCueIndex: number;
  initialText: string;
  originalText: string;
  text: string;
};

const POP_SCALE = 1.12;
const POP_SPACED_GAP = 6;
const POP_UNSPACED_GAP = 0;
const NO_SPACE_BEFORE = new Set(Array.from(",.!?:;)]}%。！？、，．：；）」』】》〉…"));
const NO_SPACE_AFTER = new Set(Array.from("([{（「『【《〈"));
const SENTENCE_END = /[.!?。！？]+["'”’」』】）)]*$/u;
const EXPRESSIVE_REPEAT = /(.)\1{5,}/gu;

let captionMeasureContext: CanvasRenderingContext2D | null | undefined;

export function editorCaptionCueSourceIndex(
  cue: CaptionCue,
  cueIndex: number,
) {
  return cue.sourceCueIndex ?? cueIndex;
}

export function editorCaptionCueText(cue: CaptionCue) {
  return cue.words.reduce(
    (text, word, wordIndex) => (
      `${text}${wordIndex > 0 && word.spaceBefore ? " " : ""}${word.text}`
    ),
    "",
  );
}

export function resolveEditorCaptionTextEditTarget(
  spec: CaptionRenderSpec,
  sourceCueIndex: number,
  cueEdits: EditorSubtitleCueEdit[] = [],
): EditorCaptionTextEditTarget | null {
  const sourceCues = spec.cues.filter((cue, cueIndex) => (
    editorCaptionCueSourceIndex(cue, cueIndex) === sourceCueIndex
  ));
  if (sourceCues.length !== 1) return null;
  const [sourceCue] = sourceCues;
  if (!sourceCue) return null;
  const originalText = editorCaptionCueText(sourceCue);
  const storedEdit = cueEdits.find((edit) => (
    edit.cueIndex === sourceCueIndex
  ));
  return {
    sourceCueIndex,
    originalText,
    currentText: storedEdit?.text || originalText,
  };
}

export function editorCaptionTextDraftChanged(
  initialText: string,
  value: string,
) {
  const text = value.trim();
  return text.length > 0 && text !== initialText.trim();
}

export function editorCaptionTextDraftInvalid(
  initialText: string,
  value: string,
) {
  return value !== initialText && value.trim().length === 0;
}

export function updateEditorCaptionCueEdits(
  cueEdits: EditorSubtitleCueEdit[] = [],
  sourceCueIndex: number,
  originalText: string,
  value: string,
) {
  const text = value.trim();
  if (!text) return cueEdits.map((edit) => ({ ...edit }));
  const next = cueEdits
    .filter((edit) => edit.cueIndex !== sourceCueIndex)
    .map((edit) => ({ ...edit }));
  if (text !== originalText.trim()) {
    next.push({ cueIndex: sourceCueIndex, text });
  }
  return next.sort((left, right) => left.cueIndex - right.cueIndex);
}

export function editorSubtitleLayoutWithCaptionDraft(
  layout: EditorSubtitleLayout,
  draft: EditorCaptionTextDraft | null,
): EditorSubtitleLayout {
  return draft
    ? {
        ...layout,
        cueEdits: updateEditorCaptionCueEdits(
          layout.cueEdits,
          draft.sourceCueIndex,
          draft.originalText,
          draft.text,
        ),
      }
    : layout;
}

export function sanitizeEditorCaptionCueEdits(
  spec: CaptionRenderSpec,
  cueEdits: EditorSubtitleCueEdit[] = [],
) {
  const sourceCueCounts = new Map<number, number>();
  spec.cues.forEach((cue, cueIndex) => {
    const sourceCueIndex = editorCaptionCueSourceIndex(cue, cueIndex);
    sourceCueCounts.set(
      sourceCueIndex,
      (sourceCueCounts.get(sourceCueIndex) || 0) + 1,
    );
  });
  return cueEdits
    .filter((edit) => sourceCueCounts.get(edit.cueIndex) === 1)
    .map((edit) => ({ ...edit }))
    .sort((left, right) => left.cueIndex - right.cueIndex);
}

export function updateEditorCaptionCueText(
  spec: CaptionRenderSpec,
  cueEdits: EditorSubtitleCueEdit[] = [],
  sourceCueIndex: number,
  value: string,
) {
  const target = resolveEditorCaptionTextEditTarget(
    spec,
    sourceCueIndex,
    cueEdits,
  );
  return target
    ? updateEditorCaptionCueEdits(
        cueEdits,
        sourceCueIndex,
        target.originalText,
        value,
      )
    : cueEdits.map((edit) => ({ ...edit }));
}

function fallbackCaptionTextWidth(text: string, fontSize: number) {
  return Array.from(text).reduce((width, character) => {
    if (/\s/u.test(character)) return width + fontSize * 0.28;
    if (/\p{Script=Hangul}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) {
      return width + fontSize;
    }
    if (/\p{Extended_Pictographic}/u.test(character)) return width + fontSize;
    if (/[A-Z]/u.test(character)) return width + fontSize * 0.68;
    if (/[a-z]/u.test(character)) return width + fontSize * 0.56;
    if (/[0-9]/u.test(character)) return width + fontSize * 0.62;
    return width + fontSize * 0.45;
  }, 0);
}

export function measureEditorCaptionText(
  text: string,
  fontSize: number,
  fontId: EditorFontId = DEFAULT_EDITOR_FONT_ID,
) {
  if (captionMeasureContext === undefined) {
    if (typeof document === "undefined") {
      captionMeasureContext = null;
    } else {
      captionMeasureContext = document.createElement("canvas").getContext("2d");
    }
  }
  if (!captionMeasureContext) return fallbackCaptionTextWidth(text, fontSize);
  const font = resolveEditorFontFace(fontId, "title");
  captionMeasureContext.font = `${font.resolvedWeight} ${fontSize}px ${font.family}`;
  return captionMeasureContext.measureText(text).width;
}

export function measureEditorCaptionTextV4(
  text: string,
  fontSize: number,
  fontId: EditorFontId,
) {
  if (typeof document === "undefined" || !document.fonts) {
    throw new Error("Exact caption font measurement requires a browser.");
  }
  if (captionMeasureContext === undefined) {
    captionMeasureContext = document.createElement("canvas").getContext("2d");
  }
  if (!captionMeasureContext) {
    throw new Error("Exact caption font measurement is unavailable.");
  }
  const font = resolveEditorFontFaceV4(fontId, "title");
  const descriptor = `${font.resolvedWeight} ${fontSize}px ${font.family}`;
  if (!document.fonts.check(descriptor, text)) {
    throw new Error(`Exact caption font is not loaded: ${font.fontId}`);
  }
  captionMeasureContext.font = descriptor;
  const width = captionMeasureContext.measureText(text).width;
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error("Exact caption font metrics are unavailable.");
  }
  return width;
}

function pythonRound(value: number) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

function round3(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function editorCaptionFontSpecV4(fontId: EditorFontId) {
  const face = resolveEditorFontFaceV4(fontId, "title");
  return {
    fontId: face.fontId,
    fileId: face.fileId,
    sha256: face.sha256,
    family: face.family,
    weight: face.resolvedWeight,
    metrics: {
      revision: face.metrics.revision,
      cssToAssScale: editorCaptionCssToAssScaleById[face.fontId],
      cssToAssBaselineOffsetEm:
        editorCaptionCssToAssBaselineOffsetEmById[face.fontId],
    },
  } as const;
}

function displayUnits(text: string) {
  const units: string[] = [];
  for (const character of Array.from(text)) {
    const codepoint = character.codePointAt(0) || 0;
    const joinsPrevious = units.length > 0 && (
      /\p{Mark}/u.test(character)
      || character === "\u200d"
      || units.at(-1)?.endsWith("\u200d")
      || (codepoint >= 0xFE00 && codepoint <= 0xFE0F)
      || (codepoint >= 0x1F3FB && codepoint <= 0x1F3FF)
    );
    if (joinsPrevious) units[units.length - 1] += character;
    else units.push(character);
  }
  return units;
}

function ellipsizeCaptionText(
  text: string,
  fontSize: number,
  maxWidth: number,
  scale: number,
  measure: CaptionTextMeasurer,
) {
  if (measure(text, fontSize) * scale <= maxWidth) return text;
  const ellipsis = "…";
  if (measure(ellipsis, fontSize) * scale > maxWidth) return ellipsis;
  let prefix = "";
  for (const unit of displayUnits(text)) {
    if (measure(`${prefix}${unit}${ellipsis}`, fontSize) * scale > maxWidth) break;
    prefix += unit;
  }
  return prefix ? `${prefix}${ellipsis}` : ellipsis;
}

function splitCaptionWord(
  word: CaptionWord,
  fontSize: number,
  maxWidth: number,
  scale: number,
  measure: CaptionTextMeasurer,
): CaptionWord[] {
  if (
    word.startFrame == null
    || word.endFrame == null
    || measure(word.text, fontSize) * scale <= maxWidth
  ) return [{ ...word }];

  if (EXPRESSIVE_REPEAT.test(word.text)) {
    EXPRESSIVE_REPEAT.lastIndex = 0;
    const compacted = word.text.replace(
      EXPRESSIVE_REPEAT,
      (_match, character: string) => `${character.repeat(3)}…`,
    );
    EXPRESSIVE_REPEAT.lastIndex = 0;
    return [{
      ...word,
      text: ellipsizeCaptionText(compacted, fontSize, maxWidth, scale, measure),
    }];
  }
  EXPRESSIVE_REPEAT.lastIndex = 0;

  const units = displayUnits(word.text);
  const pieces: string[][] = [];
  let current: string[] = [];
  for (const unit of units) {
    const candidate = [...current, unit].join("");
    if (current.length > 0 && measure(candidate, fontSize) * scale > maxWidth) {
      pieces.push(current);
      current = [unit];
    } else {
      current.push(unit);
    }
  }
  if (current.length > 0) pieces.push(current);

  const frameCount = word.endFrame - word.startFrame;
  if (pieces.length === 0 || pieces.length > frameCount) {
    return [{
      ...word,
      text: ellipsizeCaptionText(word.text, fontSize, maxWidth, scale, measure),
    }];
  }

  const starts = [word.startFrame];
  let consumedUnits = pieces[0].length;
  for (let index = 1; index < pieces.length; index += 1) {
    const remaining = pieces.length - index;
    const desired = word.startFrame
      + pythonRound(frameCount * consumedUnits / units.length);
    starts.push(Math.min(
      word.endFrame - remaining,
      Math.max((starts.at(-1) || word.startFrame) + 1, desired),
    ));
    consumedUnits += pieces[index].length;
  }
  return pieces.map((piece, index) => ({
    ...word,
    text: piece.join(""),
    startFrame: starts[index],
    endFrame: starts[index + 1] ?? word.endFrame,
    spaceBefore: index === 0 ? word.spaceBefore : false,
  }));
}

function fitCaptionWords(
  words: CaptionWord[],
  templateId: CaptionRenderSpec["templateId"],
  safeArea: CaptionRenderSpec["safeArea"],
  measure: CaptionTextMeasurer,
  fontSize?: number,
) {
  const outline = templateId === "pop" ? 8 : 7;
  const resolvedFontSize = fontSize ?? (templateId === "pop" ? 92 : 72);
  const fittingFontSize = templateId === "pop"
    ? Math.min(resolvedFontSize, 64)
    : resolvedFontSize;
  const scale = templateId === "pop" ? POP_SCALE : 1;
  const maxWidth = safeArea.width - outline * 2;
  return words.flatMap((word) => (
    splitCaptionWord(word, fittingFontSize, maxWidth, scale, measure)
  ));
}

function joinCaptionText(
  left: string,
  right: string,
  spaceBefore: boolean,
  wordSeparator: string,
) {
  if (!left) return right;
  if (!right) return left;
  if (NO_SPACE_BEFORE.has(right[0]) || NO_SPACE_AFTER.has(left.at(-1) || "")) {
    return left + right;
  }
  return left + (spaceBefore ? wordSeparator : "") + right;
}

function captionTextForWords(words: CaptionWord[], wordSeparator: string) {
  return words.reduce(
    (text, word) => joinCaptionText(text, word.text, Boolean(word.spaceBefore), wordSeparator),
    "",
  );
}

function wrapCaptionWordIndexes(
  words: CaptionWord[],
  fontSize: number,
  maxWidth: number,
  wordSeparator: string,
  measure: CaptionTextMeasurer,
) {
  const lines: number[][] = [];
  let current: number[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const proposed = [...current, index];
    const proposedText = captionTextForWords(
      proposed.map((wordIndex) => words[wordIndex]),
      wordSeparator,
    );
    if (current.length > 0 && measure(proposedText, fontSize) > maxWidth) {
      lines.push(current);
      current = [index];
    } else {
      current = proposed;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function phraseFits(
  words: CaptionWord[],
  fontSize: number,
  maxWidth: number,
  maxLines: number,
  wordSeparator: string,
  measure: CaptionTextMeasurer,
) {
  const lines = wrapCaptionWordIndexes(
    words,
    fontSize,
    maxWidth,
    wordSeparator,
    measure,
  );
  return lines.length <= maxLines && lines.every((line) => (
    measure(
      captionTextForWords(line.map((index) => words[index]), wordSeparator),
      fontSize,
    ) <= maxWidth
  ));
}

function partitionCaptionWords(
  words: CaptionWord[],
  options: {
    gapFrames: number;
    maxWords: number | null;
    fontSize: number;
    maxWidth: number;
    maxDurationFrames: number;
    requireWordFrames: boolean;
    wordSeparator: string;
  },
  measure: CaptionTextMeasurer,
) {
  const groups: CaptionWord[][] = [];
  let current: CaptionWord[] = [];
  for (const word of words) {
    const previous = current.at(-1);
    const shouldBreak = Boolean(previous) && (
      (word.startFrame || 0) - (previous?.endFrame || 0) >= options.gapFrames
      || SENTENCE_END.test(previous?.text || "")
      || (options.maxWords != null && current.length >= options.maxWords)
      || (word.endFrame || 0) - (current[0]?.startFrame || 0) > options.maxDurationFrames
      || (options.requireWordFrames
        && (word.endFrame || 0) - (current[0]?.startFrame || 0) < current.length + 1)
      || !phraseFits(
        [...current, word],
        options.fontSize,
        options.maxWidth,
        1,
        options.wordSeparator,
        measure,
      )
    );
    if (shouldBreak) {
      groups.push(current);
      current = [];
    }
    current.push(word);
    if (SENTENCE_END.test(word.text)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function withoutDisplayPeriods(words: CaptionWord[]) {
  const cleaned: CaptionWord[] = [];
  for (const word of words) {
    const text = word.text.replaceAll(".", "");
    if (text) {
      cleaned.push({
        ...word,
        text,
        spaceBefore: cleaned.length > 0 && word.spaceBefore,
      });
    } else if (cleaned.length > 0) {
      const previous = cleaned[cleaned.length - 1];
      cleaned[cleaned.length - 1] = {
        ...previous,
        endFrame: Math.max(previous.endFrame || 0, word.endFrame || 0),
        speechEndFrame: word.speechEndFrame ?? word.endFrame,
      };
    }
  }
  return cleaned;
}

function captionEventRanges(words: CaptionWord[], cueStart: number, cueEnd: number) {
  const starts = [cueStart];
  for (let index = 1; index < words.length; index += 1) {
    const earliest = starts[index - 1] + 1;
    const remaining = words.length - index;
    const latest = cueEnd - remaining;
    const desired = Math.min(cueEnd, Math.max(cueStart, words[index].startFrame || 0));
    starts.push(Math.min(latest, Math.max(earliest, desired)));
  }
  return starts.map((startFrame, index) => ({
    startFrame,
    endFrame: starts[index + 1] ?? cueEnd,
    activeWordIndex: index,
  }));
}

function popEventPositions(
  words: CaptionWord[],
  activeWordIndex: number,
  safeArea: CaptionRenderSpec["safeArea"],
  measure: CaptionTextMeasurer,
  positionedWordsV4 = false,
  cssToAssScale = 1,
) {
  const widths = words.map((word, index) => (
    measure(word.text, word.fontSize || 92)
      * (index === activeWordIndex ? POP_SCALE : 1)
      * cssToAssScale
  ));
  const gaps: number[] = words.slice(1).map((word) => (
    word.spaceBefore ? POP_SPACED_GAP : POP_UNSPACED_GAP
  ));
  const centerX = safeArea.x + safeArea.width / 2;
  const centerY = safeArea.y + safeArea.height / 2;
  let cursor = centerX
    - (widths.reduce((sum, width) => sum + width, 0)
      + gaps.reduce((sum, gap) => sum + gap, 0)) / 2;
  return words.map((_word, index) => {
    if (index > 0) cursor += gaps[index - 1];
    const position = {
      centerX: round3(cursor + widths[index] / 2),
      centerY: round3(centerY),
      ...(positionedWordsV4
        ? {
            advanceWidth: round3(widths[index]),
            gapBefore: index === 0 ? 0 as const : gaps[index - 1] as 0 | 6,
          }
        : {}),
    };
    cursor += widths[index];
    return position;
  });
}

function compilePopCaptionWords(
  words: CaptionWord[],
  safeArea: CaptionRenderSpec["safeArea"],
  fps: number,
  measure: CaptionTextMeasurer,
  positionedWordsV4 = false,
  fontSize = 92,
  cssToAssScale = 1,
) {
  const maxWidth = safeArea.width - 16;
  const minimumFontSize = Math.min(fontSize, 64);
  const groups = partitionCaptionWords(words, {
    gapFrames: pythonRound(0.25 * fps),
    maxWords: 3,
    fontSize,
    maxWidth: pythonRound(maxWidth / POP_SCALE),
    maxDurationFrames: pythonRound(2 * fps),
    requireWordFrames: true,
    wordSeparator: "\u2009",
  }, measure).map(withoutDisplayPeriods).filter((group) => group.length > 0);
  let previousEndFrame = 0;
  return groups.map((group, index): CaptionCue => {
    let sizes = group.map((word) => {
      let size = fontSize;
      while (
        size > minimumFontSize
        && measure(word.text, size) * POP_SCALE > maxWidth
      ) size = Math.max(minimumFontSize, size - 2);
      return size;
    });
    let widths = group.map((word, wordIndex) => (
      measure(word.text, sizes[wordIndex]) * POP_SCALE * cssToAssScale
    ));
    const gaps: number[] = group.slice(1).map((word) => (
      word.spaceBefore ? POP_SPACED_GAP : POP_UNSPACED_GAP
    ));
    let totalWidth = widths.reduce((sum, width) => sum + width, 0)
      + gaps.reduce((sum, gap) => sum + gap, 0);
    if (totalWidth > maxWidth) {
      const ratio = maxWidth / totalWidth;
      sizes = sizes.map((size) => Math.max(
        minimumFontSize,
        pythonRound(size * ratio),
      ));
      widths = group.map((word, wordIndex) => (
        measure(word.text, sizes[wordIndex]) * POP_SCALE * cssToAssScale
      ));
      totalWidth = widths.reduce((sum, width) => sum + width, 0)
        + gaps.reduce((sum, gap) => sum + gap, 0);
    }
    if (positionedWordsV4 && totalWidth > maxWidth + 0.5) {
      throw new Error("V4 pop caption cannot fit inside its safe area.");
    }
    const centerX = safeArea.x + safeArea.width / 2;
    const centerY = safeArea.y + safeArea.height / 2;
    let cursor = centerX - totalWidth / 2;
    const serialized = group.map((word, wordIndex) => {
      if (wordIndex > 0) cursor += gaps[wordIndex - 1];
      const serializedWord: CaptionWord = {
        ...word,
        fontSize: sizes[wordIndex],
        centerX: round3(cursor + widths[wordIndex] / 2),
        centerY: round3(centerY),
        maxScale: 112,
      };
      cursor += widths[wordIndex];
      return serializedWord;
    });
    const startFrame = Math.max(group[0].startFrame || 0, previousEndFrame);
    let endFrame = Math.max(
      group.at(-1)?.endFrame || 0,
      startFrame + group.length,
    );
    const nextStart = groups[index + 1]?.[0]?.startFrame;
    if (
      nextStart != null
      && nextStart >= startFrame + group.length
      && nextStart - (group.at(-1)?.endFrame || 0) < pythonRound(0.25 * fps)
    ) endFrame = nextStart;
    previousEndFrame = endFrame;
    const events = captionEventRanges(group, startFrame, endFrame).map((event) => ({
      ...event,
      positions: popEventPositions(
        serialized,
        event.activeWordIndex,
        safeArea,
        measure,
        positionedWordsV4,
        cssToAssScale,
      ),
    }));
    return {
      startFrame,
      endFrame,
      words: serialized,
      easeFrames: 2,
      events,
    };
  });
}

function compileHighlightCaptionWords(
  words: CaptionWord[],
  safeArea: CaptionRenderSpec["safeArea"],
  fps: number,
  measure: CaptionTextMeasurer,
  fontSize = 72,
  strictV4 = false,
  cssToAssScale = 1,
) {
  const maxWidth = safeArea.width - 14;
  const measuredMaxWidth = maxWidth / cssToAssScale;
  const wordSeparator = " ";
  const groups = partitionCaptionWords(words, {
    gapFrames: pythonRound(0.42 * fps),
    maxWords: null,
    fontSize,
    maxWidth: measuredMaxWidth,
    maxDurationFrames: pythonRound(3.2 * fps),
    requireWordFrames: true,
    wordSeparator,
  }, measure).map(withoutDisplayPeriods).filter((group) => group.length > 0);
  let previousEndFrame = 0;
  return groups.map((group, index): CaptionCue => {
    const startFrame = Math.max(group[0].startFrame || 0, previousEndFrame);
    let endFrame = Math.max(group.at(-1)?.endFrame || 0, startFrame + group.length);
    const nextStart = groups[index + 1]?.[0]?.startFrame;
    if (
      nextStart != null
      && nextStart >= startFrame + group.length
      && nextStart - (group.at(-1)?.endFrame || 0) < pythonRound(0.42 * fps)
    ) endFrame = nextStart;
    previousEndFrame = endFrame;
    const lines = wrapCaptionWordIndexes(
      group,
      fontSize,
      measuredMaxWidth,
      wordSeparator,
      measure,
    );
    const widest = Math.max(...lines.map((line) => measure(
      captionTextForWords(line.map((wordIndex) => group[wordIndex]), wordSeparator),
      fontSize,
    )));
    const requiredScaleX = widest > measuredMaxWidth
      ? Math.min(100, maxWidth / (widest * cssToAssScale) * 100)
      : 100;
    if (strictV4 && requiredScaleX < 60) {
      throw new Error("V4 highlight caption cannot fit inside its safe area.");
    }
    const scaleX = pythonRound(requiredScaleX);
    return {
      startFrame,
      endFrame,
      fontSize,
      scaleX,
      centerX: Math.floor(safeArea.x + safeArea.width / 2),
      centerY: Math.floor(safeArea.y + safeArea.height / 2),
      words: group,
      lines,
      wordSeparator,
      ...(strictV4
        ? {
            separatorAdvanceWidth: round3(
              measure(wordSeparator, fontSize) * cssToAssScale,
            ),
          }
        : {}),
      events: captionEventRanges(group, startFrame, endFrame),
    };
  });
}

function compileCaptionWords(
  words: CaptionWord[],
  spec: CaptionRenderSpec,
  measure: CaptionTextMeasurer,
) {
  return spec.templateId === "pop"
    ? compilePopCaptionWords(
        words,
        spec.safeArea,
        spec.fps,
        measure,
        spec.schemaVersion === 4,
        spec.schemaVersion === 4 ? spec.style.fontSize : 92,
        spec.schemaVersion === 4 ? spec.font.metrics.cssToAssScale : 1,
      )
    : compileHighlightCaptionWords(
        words,
        spec.safeArea,
        spec.fps,
        measure,
        spec.schemaVersion === 4 ? spec.style.fontSize : 72,
        spec.schemaVersion === 4,
        spec.schemaVersion === 4 ? spec.font.metrics.cssToAssScale : 1,
      );
}

export type EditorHighlightSubtitleSegment = {
  start: number;
  end: number;
  text: string;
};

function editorHighlightWords(
  segments: EditorHighlightSubtitleSegment[],
  fps: number,
) {
  return [...segments]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .flatMap((segment): CaptionWord[] => {
      const speechStartFrame = Math.max(0, frameAt(segment.start, fps));
      const speechEndFrame = Math.max(
        speechStartFrame + 1,
        frameAt(segment.end, fps),
      );
      const availableFrames = speechEndFrame - speechStartFrame;
      let tokens = segment.text.trim().split(/\s+/u).filter(Boolean);
      const maximumWords = Math.min(20, availableFrames);
      if (tokens.length > maximumWords) {
        tokens = maximumWords > 1
          ? [
              ...tokens.slice(0, maximumWords - 1),
              tokens.slice(maximumWords - 1).join(" "),
            ]
          : [tokens.join(" ")];
      }
      if (tokens.length === 0 || maximumWords < 1) return [];
      const weights = tokens.map((token) => Math.max(1, Array.from(token).length));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const starts = [speechStartFrame];
      let consumedWeight = weights[0];
      for (let index = 1; index < tokens.length; index += 1) {
        const remaining = tokens.length - index;
        const desired = speechStartFrame + pythonRound(
          availableFrames * consumedWeight / totalWeight,
        );
        starts.push(Math.min(
          speechEndFrame - remaining,
          Math.max(starts[index - 1] + 1, desired),
        ));
        consumedWeight += weights[index];
      }
      return tokens.map((text, index) => {
        const sourceStartFrame = starts[index];
        const sourceEndFrame = starts[index + 1] ?? speechEndFrame;
        const startFrame = Math.max(
          0,
          sourceStartFrame - SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
        );
        return {
          text,
          startFrame,
          endFrame: Math.max(startFrame + 1, sourceEndFrame),
          speechStartFrame: sourceStartFrame,
          speechEndFrame: sourceEndFrame,
          spaceBefore: index > 0,
        };
      });
    });
}

export function createEditorHighlightCaptionSpec(
  segments: EditorHighlightSubtitleSegment[],
  videoAspectRatio: VideoAspectRatio,
  accentColor: string = SUBTITLE_TEMPLATE_BRAND_COLOR,
  fontId: EditorFontId = DEFAULT_EDITOR_FONT_ID,
  measure?: CaptionTextMeasurer,
  options: EditorHighlightCaptionSpecOptions = {},
): CaptionRenderSpec | null {
  const schemaVersion = options.schemaVersion ?? 3;
  const fontSize = Math.max(
    24,
    Math.min(120, Math.round(options.fontSize ?? 72)),
  );
  const exactMeasure = measure || (schemaVersion === 4
    ? (text: string, size: number) => (
        measureEditorCaptionTextV4(text, size, fontId)
      )
    : (text: string, size: number) => (
        measureEditorCaptionText(text, size, fontId)
      ));
  const snapshot = subtitleTemplateStyleSnapshot(
    "highlight",
    videoAspectRatio,
    accentColor as TemplatePresetColor,
    "lower",
    fontId,
    SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  );
  const words = fitCaptionWords(
    editorHighlightWords(segments, snapshot.fps),
    "highlight",
    snapshot.safeArea,
    exactMeasure,
    fontSize,
  );
  if (words.length === 0) return null;
  const cues = compileHighlightCaptionWords(
    words,
    snapshot.safeArea,
    snapshot.fps,
    exactMeasure,
    fontSize,
    schemaVersion === 4,
    schemaVersion === 4 ? editorCaptionCssToAssScaleById[fontId] : 1,
  );
  normalizeCaptionCueHandoffs(cues);
  if (cues.length === 0) return null;
  if (schemaVersion === 4) {
    const v4: CaptionRenderSpecV4 = {
      schemaVersion: 4,
      templateId: "highlight",
      layoutMode: "absolute-word-positions-v1",
      wordGapPx: POP_SPACED_GAP,
      joinedWordGapPx: POP_UNSPACED_GAP,
      captionPlacement: "lower",
      fps: 30,
      timingLeadFrames: SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
      layout: {
        ...snapshot.layout,
        caption: { ...snapshot.safeArea },
      },
      safeArea: { ...snapshot.safeArea },
      font: editorCaptionFontSpecV4(fontId),
      style: {
        fontSize,
        textColor: snapshot.color.text,
        accentColor,
        outlineColor: snapshot.color.outline,
        outlineWidth: snapshot.outlinePx,
        shadow: 0,
        background: null,
        maxLines: 1,
      },
      cues: cues as CaptionRenderSpecV4["cues"],
    };
    return v4;
  }
  const font = resolveEditorFontFace(fontId, "title");
  return {
    schemaVersion: 3,
    templateId: "highlight",
    captionPlacement: "lower",
    fps: 30,
    timingLeadFrames: SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
    safeArea: { ...snapshot.safeArea },
    font: {
      fontId: font.fontId,
      fileId: font.fileId,
      sha256: "0".repeat(64),
      family: editorCaptionFontFamily(font.fontId),
      weight: font.resolvedWeight,
    },
    style: {
      fontSize,
      textColor: snapshot.color.text,
      accentColor,
      outlineColor: snapshot.color.outline,
      outlineWidth: snapshot.outlinePx,
    },
    cues,
  };
}

function rebuildEditedCaptionCue(
  cue: CaptionCue,
  text: string,
  spec: CaptionRenderSpec,
  measure: CaptionTextMeasurer,
) {
  const frameCount = cue.endFrame - cue.startFrame;
  let tokens = text.trim().split(/\s+/u).filter(Boolean);
  const maximumWords = Math.min(20, frameCount);
  if (tokens.length > maximumWords) {
    tokens = maximumWords > 1
      ? [...tokens.slice(0, maximumWords - 1), tokens.slice(maximumWords - 1).join(" ")]
      : [tokens.join(" ")];
  }
  if (tokens.length === 0 || maximumWords < 1) return [];
  const weights = tokens.map((token) => Math.max(1, Array.from(token).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const starts = [cue.startFrame];
  let consumedWeight = weights[0];
  for (let index = 1; index < tokens.length; index += 1) {
    const remaining = tokens.length - index;
    const desired = cue.startFrame
      + pythonRound(frameCount * consumedWeight / totalWeight);
    starts.push(Math.min(
      cue.endFrame - remaining,
      Math.max(starts[index - 1] + 1, desired),
    ));
    consumedWeight += weights[index];
  }
  const words = tokens.map((token, index): CaptionWord => ({
    text: token,
    startFrame: starts[index],
    endFrame: starts[index + 1] ?? cue.endFrame,
    speechStartFrame: starts[index],
    speechEndFrame: starts[index + 1] ?? cue.endFrame,
    spaceBefore: index > 0,
  }));
  return compileCaptionWords(
    fitCaptionWords(
      words,
      spec.templateId,
      spec.safeArea,
      measure,
      spec.schemaVersion === 4 ? spec.style.fontSize : undefined,
    ),
    spec,
    measure,
  );
}

function retainCaptionCueWordsByClip(
  cue: CaptionCue,
  clipWindows: CaptionClipWindow[],
) {
  const retainedByClip = clipWindows.map(() => [] as CaptionWord[]);
  for (let wordIndex = 0; wordIndex < cue.words.length; wordIndex += 1) {
    const word = cue.words[wordIndex];
    const activeEvents = cue.events.filter(
      (event) => event.activeWordIndex === wordIndex,
    );
    const wordStartFrame = word.startFrame
      ?? Math.min(...activeEvents.map((event) => event.startFrame), cue.startFrame);
    const wordEndFrame = word.endFrame
      ?? Math.max(...activeEvents.map((event) => event.endFrame), cue.endFrame);
    const speechStartFrame = word.speechStartFrame ?? wordStartFrame;
    const rawSpeechEndFrame = word.speechEndFrame ?? wordEndFrame;
    // A real word shorter than one frame can quantize to an equal speech
    // start/end. Preserve only that exact case as a one-frame anchor; reversed
    // timestamps remain invalid and are still rejected by the overlap check.
    const speechEndFrame = rawSpeechEndFrame === speechStartFrame
      ? speechStartFrame + 1
      : rawSpeechEndFrame;
    let best: {
      clipIndex: number;
      spokenOverlap: number;
      visibleOverlap: number;
      spokenStart: number;
      spokenEnd: number;
      visibleStart: number;
      visibleEnd: number;
    } | null = null;
    for (let clipIndex = 0; clipIndex < clipWindows.length; clipIndex += 1) {
      const clip = clipWindows[clipIndex];
      const spokenStart = Math.max(
        speechStartFrame,
        cue.startFrame,
        clip.startFrame,
      );
      const spokenEnd = Math.min(
        speechEndFrame,
        cue.endFrame,
        clip.endFrame,
      );
      const visibleStart = Math.max(
        wordStartFrame,
        cue.startFrame,
        clip.startFrame,
      );
      const visibleEnd = Math.min(
        wordEndFrame,
        cue.endFrame,
        clip.endFrame,
      );
      const candidate = {
        clipIndex,
        spokenOverlap: spokenEnd - spokenStart,
        visibleOverlap: visibleEnd - visibleStart,
        spokenStart,
        spokenEnd,
        visibleStart,
        visibleEnd,
      };
      if (
        candidate.spokenOverlap <= 0
        || candidate.visibleOverlap <= 0
        || (best
          && candidate.spokenOverlap < best.spokenOverlap)
        || (best
          && candidate.spokenOverlap === best.spokenOverlap
          && candidate.visibleOverlap <= best.visibleOverlap)
      ) continue;
      best = candidate;
    }
    if (!best) continue;
    const selected = best;
    const clip = clipWindows[selected.clipIndex];
    const retained = retainedByClip[selected.clipIndex];
    retained.push({
      text: word.text,
      startFrame: clip.outputStartFrame + selected.visibleStart - clip.startFrame,
      endFrame: clip.outputStartFrame + selected.visibleEnd - clip.startFrame,
      speechStartFrame: clip.outputStartFrame + selected.spokenStart - clip.startFrame,
      speechEndFrame: clip.outputStartFrame + selected.spokenEnd - clip.startFrame,
      spaceBefore: retained.length > 0 && word.spaceBefore,
    });
  }
  return retainedByClip;
}

function cueMinimumFrames(cue: CaptionCue) {
  return cue.events.every((event) => event.activeWordIndex != null)
    ? cue.events.length
    : 1;
}

function retimeCompiledCue(cue: CaptionCue, startFrame: number, endFrame: number) {
  const activeEvents = cue.events.every((event) => event.activeWordIndex != null);
  const events = activeEvents
    ? captionEventRanges(cue.words, startFrame, endFrame).map((range) => ({
        ...cue.events.find((event) => event.activeWordIndex === range.activeWordIndex),
        ...range,
      }))
    : [{ ...cue.events[0], startFrame, endFrame }];
  cue.startFrame = startFrame;
  cue.endFrame = endFrame;
  cue.events = events;
}

function normalizeCaptionCueHandoffs(cues: CaptionCue[]) {
  cues.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
  for (let index = 0; index < cues.length - 1; index += 1) {
    const current = cues[index];
    const following = cues[index + 1];
    if (current.endFrame <= following.startFrame) continue;
    const earliestHandoff = current.startFrame + cueMinimumFrames(current);
    const handoff = Math.max(following.startFrame, earliestHandoff);
    retimeCompiledCue(current, current.startFrame, handoff);
    if (handoff <= following.startFrame) continue;
    retimeCompiledCue(
      following,
      handoff,
      Math.max(following.endFrame, handoff + cueMinimumFrames(following)),
    );
  }
}

export function editorCaptionVerticalOffsetBounds(
  spec: CaptionRenderSpec,
  scale: number,
) {
  const centerY = spec.safeArea.y + spec.safeArea.height / 2;
  const halfHeight = (
    spec.safeArea.height / 2 + spec.style.outlineWidth
  ) * scale;
  return {
    min: Math.max(
      EDITOR_SUBTITLE_OFFSET_Y_MIN,
      Math.ceil(halfHeight - centerY),
    ),
    max: Math.min(
      EDITOR_SUBTITLE_OFFSET_Y_MAX,
      Math.floor(EDITOR_RENDER_CANVAS.height - centerY - halfHeight),
    ),
  };
}

function compileTargetCaptionSpecV4(
  spec: CaptionRenderSpecV4,
  requestedLayout: EditorSubtitleLayout,
) {
  const layout = normalizeEditorSubtitleLayout(requestedLayout);
  const scale = layout.scale;
  const sourceFontSize = spec.style.fontSize;
  const targetFontSize = layout.fontSize ?? sourceFontSize * scale;
  const sourceCenterX = spec.safeArea.x + spec.safeArea.width / 2;
  const sourceCenterY = spec.safeArea.y + spec.safeArea.height / 2;
  const rawWidth = spec.safeArea.width * scale;
  const rawHeight = spec.safeArea.height * scale;
  const safeArea = {
    x: round3(540 + (sourceCenterX - 540) * scale - rawWidth / 2),
    y: round3(sourceCenterY + layout.offsetY - rawHeight / 2),
    width: round3(rawWidth),
    height: round3(rawHeight),
  };
  const targetFontId = layout.fontId || spec.font.fontId;
  const target: CaptionRenderSpecV4 = {
    ...spec,
    safeArea,
    font: editorCaptionFontSpecV4(targetFontId),
    style: {
      ...spec.style,
      fontSize: round3(targetFontSize),
      textColor: layout.color || spec.style.textColor,
      accentColor: layout.accentColor || spec.style.accentColor,
      outlineWidth: round3(
        spec.style.outlineWidth * targetFontSize / sourceFontSize,
      ),
    },
    ...(spec.layout
      ? {
          layout: {
            ...spec.layout,
            caption: { ...safeArea },
          },
        }
      : {}),
  };
  return {
    layout,
    sourceFontSize,
    target,
  };
}

export function retimeCaptionRenderSpecForEditor(
  spec: CaptionRenderSpec,
  clips: EditorVideoClip[],
  cueEdits: EditorSubtitleCueEdit[] = [],
  measure?: CaptionTextMeasurer,
  options: EditorCaptionPreviewCompileOptions = {},
): CaptionRenderSpec | null {
  const compiledTarget = spec.schemaVersion === 4 && options.layout
    ? compileTargetCaptionSpecV4(spec, options.layout)
    : null;
  const targetSpec: CaptionRenderSpec = compiledTarget?.target || spec;
  const rawMeasure = measure || (targetSpec.schemaVersion === 4
    ? (text: string, fontSize: number) => (
        measureEditorCaptionTextV4(text, fontSize, targetSpec.font.fontId)
      )
    : measureEditorCaptionText);
  let outputCursor = 0;
  const unmergedWindows: CaptionClipWindow[] = clips.flatMap((clip) => {
    const startFrame = frameAt(clip.sourceStartSeconds, spec.fps);
    const endFrame = frameAt(clip.sourceEndSeconds, spec.fps);
    if (endFrame <= startFrame) return [];
    const window = {
      startFrame,
      endFrame,
      outputStartFrame: outputCursor,
    };
    outputCursor += endFrame - startFrame;
    return [window];
  });
  const clipWindows = unmergedWindows.reduce<typeof unmergedWindows>(
    (windows, window) => {
      const previous = windows.at(-1);
      if (
        previous
        && previous.endFrame === window.startFrame
        && previous.outputStartFrame
          + previous.endFrame
          - previous.startFrame === window.outputStartFrame
      ) {
        previous.endFrame = window.endFrame;
      } else {
        windows.push({ ...window });
      }
      return windows;
    },
    [],
  );

  const v4NoopLayout = Boolean(
    compiledTarget
    && cueEdits.length === 0
    && clipWindows.length === 1
    && clipWindows[0].outputStartFrame === 0
    && Math.abs(compiledTarget.layout.offsetY) < 0.0005
    && Math.abs(compiledTarget.layout.scale - 1) < 0.0005
    && Math.abs(
      compiledTarget.target.style.fontSize - compiledTarget.sourceFontSize,
    ) < 0.0005
    && compiledTarget.target.font.fontId === spec.font.fontId
    && compiledTarget.target.style.textColor === spec.style.textColor
    && compiledTarget.target.style.accentColor === spec.style.accentColor
  );
  const v4BoundaryCueExists = Boolean(
    v4NoopLayout
    && spec.cues.some((cue) => {
      const clip = clipWindows[0];
      const intersects = cue.endFrame > clip.startFrame
        && cue.startFrame < clip.endFrame;
      return intersects && (
        cue.startFrame < clip.startFrame
        || cue.endFrame > clip.endFrame
      );
    }),
  );
  // A padded editor source deliberately contains cues before and after the
  // selected clip. Those fully excluded cues must not force the selected cues
  // through the text compiler again. Only a cue that actually crosses a cut
  // boundary requires the deterministic reflow path used by the worker.
  const preservedV4Geometry = v4NoopLayout && !v4BoundaryCueExists;
  const forceV4Reflow = Boolean(compiledTarget && !preservedV4Geometry);
  if (
    forceV4Reflow
    && spec.cues.some((cue) => cue.words.some((word) => (
      word.startFrame == null || word.endFrame == null
    )))
  ) {
    throw new Error("V4 caption reflow requires word timing frames.");
  }

  const everyV4CueIsContained = preservedV4Geometry && spec.cues.every((cue) => (
    cue.startFrame >= clipWindows[0].startFrame
    && cue.endFrame <= clipWindows[0].endFrame
  ));
  if (
    preservedV4Geometry
    && everyV4CueIsContained
    && clipWindows[0].startFrame === 0
  ) {
    return targetSpec;
  }

  const edits = new Map(cueEdits.map((edit) => [edit.cueIndex, edit.text]));
  const cues: CaptionCue[] = [];
  for (let cueIndex = 0; cueIndex < spec.cues.length; cueIndex += 1) {
    const cue = spec.cues[cueIndex];
    const sourceCueIndex = cue.sourceCueIndex ?? cueIndex;
    const editedText = edits.get(sourceCueIndex);
    if (editedText != null) {
      const retainedByClip = retainCaptionCueWordsByClip(cue, clipWindows);
      const retainedWords = retainedByClip.flat();
      if (retainedWords.length === 0) continue;
      const retainedStartFrame = Math.min(
        ...retainedWords.map((word) => word.startFrame ?? 0),
      );
      const retainedEndFrame = Math.max(
        ...retainedWords.map((word) => word.endFrame ?? 0),
      );
      if (retainedEndFrame <= retainedStartFrame) continue;
      const rebuiltCues = rebuildEditedCaptionCue(
        {
          ...cue,
          startFrame: retainedStartFrame,
          endFrame: retainedEndFrame,
        },
        editedText,
        targetSpec,
        rawMeasure,
      );
      for (const rebuilt of rebuiltCues) {
        cues.push({ ...rebuilt, sourceCueIndex });
      }
      continue;
    }

    const sourceCues = [cue];
    for (const sourceCue of sourceCues) {
      const containingClip = clipWindows.find((clip) => (
        clip.startFrame <= sourceCue.startFrame
        && clip.endFrame >= sourceCue.endFrame
      ));
      if (containingClip && !forceV4Reflow) {
        const offset = containingClip.outputStartFrame - containingClip.startFrame;
        cues.push({
          ...sourceCue,
          sourceCueIndex,
          startFrame: sourceCue.startFrame + offset,
          endFrame: sourceCue.endFrame + offset,
          words: sourceCue.words.map((word) => ({
            ...word,
            ...(word.startFrame == null ? {} : { startFrame: word.startFrame + offset }),
            ...(word.endFrame == null ? {} : { endFrame: word.endFrame + offset }),
            ...(word.speechStartFrame == null
              ? {}
              : { speechStartFrame: word.speechStartFrame + offset }),
            ...(word.speechEndFrame == null
              ? {}
              : { speechEndFrame: word.speechEndFrame + offset }),
          })),
          events: sourceCue.events.map((event) => ({
            ...event,
            startFrame: event.startFrame + offset,
            endFrame: event.endFrame + offset,
            ...(event.positions
              ? { positions: event.positions.map((position) => ({ ...position })) }
              : {}),
          })),
        });
        continue;
      }
      const retainedSourceWordsByClip = retainCaptionCueWordsByClip(
        sourceCue,
        clipWindows,
      );
      for (const retainedWords of retainedSourceWordsByClip) {
        if (retainedWords.length === 0) continue;
        const fitted = fitCaptionWords(
          retainedWords,
          targetSpec.templateId,
          targetSpec.safeArea,
          rawMeasure,
          targetSpec.schemaVersion === 4
            ? targetSpec.style.fontSize
            : undefined,
        );
        for (const rebuilt of compileCaptionWords(
          fitted,
          targetSpec,
          rawMeasure,
        )) {
          cues.push({ ...rebuilt, sourceCueIndex });
        }
      }
    }
  }

  normalizeCaptionCueHandoffs(cues);
  if (cues.some((cue, index) => (
    index > 0 && cues[index - 1].endFrame > cue.startFrame
  ))) return null;

  if (cues.length === 0) return null;
  return targetSpec.schemaVersion === 4
    ? { ...targetSpec, cues: cues as CaptionRenderSpecV4["cues"] }
    : { ...targetSpec, cues: cues as Extract<
        CaptionRenderSpec,
        { schemaVersion: 3 }
      >["cues"] };
}
