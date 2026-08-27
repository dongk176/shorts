import {
  POSITIONED_SUBTITLE_WORD_GAP_PX,
  centeredAdvanceWordBoxes,
} from "@/components/positioned-subtitle-layout";
import { measureEditorCaptionTextV4 } from "@/lib/editor-caption-preview";
import {
  editorCaptionCssToAssBaselineOffsetEmById,
  editorCaptionCssToAssScaleById,
  editorWordSpaceAdvanceEmById,
} from "@/lib/editor-fonts";
import type { TemplateConfigV5 } from "@/lib/template-config";

export type TemplateSubtitlePreviewWord = {
  text: string;
  active: boolean;
  spaceBefore: boolean;
};

export function compileTemplateSubtitlePreviewGeometryV4(
  subtitle: TemplateConfigV5["subtitle"],
  previewWords: readonly TemplateSubtitlePreviewWord[],
  measure: (text: string, fontSize: number) => number = (text, fontSize) => (
    measureEditorCaptionTextV4(text, fontSize, subtitle.fontId)
  ),
) {
  const rawWidths = previewWords.map((word) => (
    measure(word.text, subtitle.fontSize)
  ));
  const cssToAssScale = editorCaptionCssToAssScaleById[subtitle.fontId];
  const cssToAssBaselineOffsetEm =
    editorCaptionCssToAssBaselineOffsetEmById[subtitle.fontId];
  const separatorAdvanceWidth = subtitle.fontSize
    * editorWordSpaceAdvanceEmById[subtitle.fontId]
    * cssToAssScale;
  const rawPhraseWidth = rawWidths.reduce((total, width, index) => (
    total
      + width * cssToAssScale
      + (index > 0 && previewWords[index].spaceBefore
        ? separatorAdvanceWidth
        : 0)
  ), 0);
  return {
    cssToAssScale,
    cssToAssBaselineOffsetEm,
    rawPhraseWidth,
    separatorAdvanceWidth,
    positions: centeredAdvanceWordBoxes(
      previewWords.map((word, index) => ({
        advanceWidth: rawWidths[index]
          * cssToAssScale
          * (word.active && subtitle.variant === "pop" ? 1.12 : 1),
        gapBefore: word.spaceBefore ? POSITIONED_SUBTITLE_WORD_GAP_PX : 0,
      })),
      subtitle.x,
      subtitle.y,
    ),
  };
}
