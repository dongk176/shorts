import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { EditorTitleV4Preview } from "@/components/editor-title-v4-preview";
import {
  FlowSubtitleWords,
  PositionedSubtitleWords,
  type PositionedSubtitleWord,
  type PositionedSubtitleWordBox,
} from "@/components/positioned-subtitle-words";
import type {
  TemplateId,
  TitleTextStyle,
  VideoAspectRatio,
} from "@/lib/contracts";
import {
  ensureEditorFontFaceV4Loaded,
  resolveEditorFontFaceV4,
  type EditorFontId,
} from "@/lib/editor-fonts";
import {
  compileEditorRenderTitleSpecV4,
  type EditorRenderTitleSpecV4,
} from "@/lib/editor-render-spec";
import type { TemplateConfig, TemplateConfigV5 } from "@/lib/template-config";
import {
  compileTemplateSubtitlePreviewGeometryV4,
  type TemplateSubtitlePreviewWord,
} from "@/lib/template-subtitle-preview-v4";
import { createTemplateTitleV4DocumentInput } from "@/lib/template-title-v4-document";
import "@/app/editor-v2.css";
import "./parity.css";

type BrowserParityFixture = {
  schemaVersion: 1;
  canvas: { width: number; height: number };
  title?: {
    spec: EditorRenderTitleSpecV4;
    compilerInput: {
      templateId: TemplateId;
      title: string;
      templateConfig: TemplateConfig | null;
      videoAspectRatio: VideoAspectRatio;
      textStyles: TitleTextStyle[];
      fontId: EditorFontId;
    };
    sourceTitle: string;
    textStyles: TitleTextStyle[];
    primaryColor: string;
    accentColor: string;
  };
  caption?: {
    mode?: "positioned-pop" | "flow-highlight";
    words: PositionedSubtitleWord[];
    positions?: PositionedSubtitleWordBox[];
    activeWordIndex: number;
    activeWordScale: number;
    layoutScale: number;
    offsetY: number;
    cssToAssScale: number;
    cssToAssBaselineOffsetEm: number;
    textColor: string;
    accentColor: string;
    outlineColor: string;
    outlineWidth: number;
    fontFamily: string;
    fontWeight: number;
    fontId: EditorFontId;
    compilerInput: {
      subtitle: TemplateConfigV5["subtitle"];
      previewWords: TemplateSubtitlePreviewWord[];
    };
    centerX?: number;
    centerY?: number;
    fontSize?: number;
    scaleX?: number;
    lines?: number[][];
    wordSeparator?: string;
    separatorAdvanceWidth?: number;
  };
};

type CompiledCaptionGeometry = ReturnType<
  typeof compileTemplateSubtitlePreviewGeometryV4
> & { scaleX: number };

declare global {
  interface Window {
    __editorV4BrowserParityCompilerEvidence?: {
      titleSpec: EditorRenderTitleSpecV4 | null;
      captionGeometry: CompiledCaptionGeometry | null;
    };
  }
}

function FlowHighlightCaption({
  fixture,
  fontFamily,
  fontWeight,
  scaleX,
  separatorAdvanceWidth,
  baselineOffsetEm,
}: {
  fixture: NonNullable<BrowserParityFixture["caption"]>;
  fontFamily: string;
  fontWeight: number;
  scaleX: number;
  separatorAdvanceWidth: number;
  baselineOffsetEm: number;
}) {
  const canvasCqw = (pixels: number) => `${pixels / 10.8}cqw`;
  const lines = fixture.lines || [fixture.words.map((_, index) => index)];
  return <span
    data-browser-parity-flow-caption=""
    className="absolute whitespace-nowrap text-center"
    style={{
      left: `${(fixture.centerX || 540) / 10.8}%`,
      top: `${(
        (fixture.centerY || 960)
        + (fixture.fontSize || fixture.words[0]?.fontSize || 72)
          * baselineOffsetEm
      ) / 19.2}%`,
      color: fixture.textColor,
      fontFamily,
      fontSize: canvasCqw(
        (fixture.fontSize || fixture.words[0]?.fontSize || 72)
          * fixture.cssToAssScale,
      ),
      fontWeight,
      lineHeight: 1,
      paintOrder: "stroke fill",
      textRendering: "geometricPrecision",
      WebkitFontSmoothing: "antialiased",
      WebkitTextStroke: `${canvasCqw(fixture.outlineWidth * 2)} ${fixture.outlineColor}`,
      transform: `translate(-50%, -50%) scaleX(${scaleX})`,
    }}
  >
    <FlowSubtitleWords
      words={fixture.words}
      lines={lines}
      activeWordIndex={fixture.activeWordIndex}
      separatorAdvanceWidth={separatorAdvanceWidth}
      textColor={fixture.textColor}
      accentColor={fixture.accentColor}
      pixelToCss={canvasCqw}
    />
  </span>;
}

function BrowserParityScene({ fixture }: { fixture: BrowserParityFixture }) {
  const [fontsReady, setFontsReady] = useState(false);
  const [compiledTitleSpec, setCompiledTitleSpec] = useState<
    EditorRenderTitleSpecV4 | null
  >(null);
  const [compiledCaptionGeometry, setCompiledCaptionGeometry] = useState<
    CompiledCaptionGeometry | null
  >(null);
  const captionFace = useMemo(
    () => fixture.caption
      ? resolveEditorFontFaceV4(fixture.caption.fontId, "title")
      : null,
    [fixture.caption],
  );

  useEffect(() => {
    let cancelled = false;
    setFontsReady(false);
    setCompiledTitleSpec(null);
    setCompiledCaptionGeometry(null);
    const requests = [];
    if (fixture.title) {
      requests.push(ensureEditorFontFaceV4Loaded(
        fixture.title.spec.font,
        fixture.title.sourceTitle,
      ));
    }
    if (captionFace && fixture.caption) requests.push(ensureEditorFontFaceV4Loaded(
      captionFace,
      fixture.caption.words.map((word) => word.text).join(""),
    ));
    void Promise.all(requests).then(async () => {
      await document.fonts.ready;
      if (cancelled) return;
      let titleSpec: EditorRenderTitleSpecV4 | null = null;
      if (fixture.title) {
        const input = fixture.title.compilerInput;
        const documentInput = createTemplateTitleV4DocumentInput(input);
        const context = document.createElement("canvas").getContext("2d");
        if (!context) throw new Error("Browser title compiler canvas is unavailable.");
        titleSpec = compileEditorRenderTitleSpecV4(
          documentInput,
          (text, fontSize, exactFont) => {
            context.font = `${exactFont.resolvedWeight} ${fontSize}px ${exactFont.family}`;
            const measured = context.measureText(text);
            return {
              width: measured.width,
              actualBoundingBoxAscent: measured.actualBoundingBoxAscent,
              actualBoundingBoxDescent: measured.actualBoundingBoxDescent,
            };
          },
        );
      }
      let captionGeometry: CompiledCaptionGeometry | null = null;
      if (fixture.caption) {
        const input = fixture.caption.compilerInput;
        const geometry = compileTemplateSubtitlePreviewGeometryV4(
          input.subtitle,
          input.previewWords,
        );
        const maximumWidth = input.subtitle.maxWidth - 14;
        captionGeometry = {
          ...geometry,
          scaleX: geometry.rawPhraseWidth > maximumWidth
            ? Math.round(Math.min(
                100,
                maximumWidth / geometry.rawPhraseWidth * 100,
              )) / 100
            : 1,
        };
      }
      window.__editorV4BrowserParityCompilerEvidence = {
        titleSpec,
        captionGeometry,
      };
      setCompiledTitleSpec(titleSpec);
      setCompiledCaptionGeometry(captionGeometry);
      setFontsReady(true);
    }).catch((error: unknown) => {
      document.documentElement.dataset.browserParityError = error instanceof Error
        ? error.message
        : String(error);
    });
    return () => { cancelled = true; };
  }, [captionFace, fixture]);

  useEffect(() => {
    if (!fontsReady) return;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const compilerTitleLines = document.querySelectorAll(
          "[data-browser-compiler-title] [data-editor-v4-title-preview] svg text",
        );
        const storedTitleLines = document.querySelectorAll(
          "[data-browser-stored-title] [data-editor-v4-title-preview] svg text",
        );
        const compilerCaptionWords = document.querySelectorAll(
          "[data-browser-compiler-caption] [data-positioned-subtitle-word], "
          + "[data-browser-compiler-caption] [data-flow-subtitle-word]",
        );
        const storedCaptionWords = document.querySelectorAll(
          "[data-browser-stored-caption] [data-positioned-subtitle-word], "
          + "[data-browser-stored-caption] [data-flow-subtitle-word]",
        );
        if (
          compilerTitleLines.length === (compiledTitleSpec?.lineBoxes.length || 0)
          && storedTitleLines.length === (fixture.title?.spec.lineBoxes.length || 0)
          && compilerCaptionWords.length === (fixture.caption?.words.length || 0)
          && storedCaptionWords.length === (fixture.caption?.words.length || 0)
        ) {
          document.documentElement.dataset.browserParityReady = "true";
        } else {
          document.documentElement.dataset.browserParityError =
            "The parity scene did not mount every title/caption box.";
        }
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [compiledTitleSpec, fixture, fontsReady]);

  const canvasCqw = (pixels: number) => `${pixels / 10.8}cqw`;
  const captionTextStyle = fixture.caption ? {
    paintOrder: "stroke fill",
    textRendering: "geometricPrecision",
    WebkitFontSmoothing: "antialiased",
    WebkitTextStroke: `${canvasCqw(fixture.caption.outlineWidth * 2)} ${fixture.caption.outlineColor}`,
  } satisfies CSSProperties : undefined;

  return <main
    data-browser-parity-scene=""
    style={{
      width: fixture.canvas.width,
      height: fixture.canvas.height,
    }}
  >
    {fixture.title && compiledTitleSpec && <div data-browser-compiler-title="">
      <EditorTitleV4Preview
      spec={compiledTitleSpec}
      sourceTitle={fixture.title.sourceTitle}
      textStyles={fixture.title.textStyles}
      primaryColor={fixture.title.primaryColor}
      accentColor={fixture.title.accentColor}
      />
    </div>}
    {fixture.title && <div
      data-browser-stored-title=""
      className="absolute inset-0"
      style={{ visibility: "hidden" }}
    >
      <EditorTitleV4Preview
        spec={fixture.title.spec}
        sourceTitle={fixture.title.sourceTitle}
        textStyles={fixture.title.textStyles}
        primaryColor={fixture.title.primaryColor}
        accentColor={fixture.title.accentColor}
      />
    </div>}
    {fontsReady && fixture.caption
      && (fixture.caption.mode || "positioned-pop") === "positioned-pop"
      && compiledCaptionGeometry && captionFace && <div data-browser-compiler-caption="">
      <PositionedSubtitleWords
      words={fixture.caption.words}
      positions={compiledCaptionGeometry.positions}
      activeWordIndex={fixture.caption.activeWordIndex}
      activeWordScale={fixture.caption.activeWordScale}
      canvasWidth={fixture.canvas.width}
      canvasHeight={fixture.canvas.height}
      layoutScale={fixture.caption.layoutScale}
      offsetY={fixture.caption.offsetY}
      cssToAssScale={compiledCaptionGeometry.cssToAssScale}
      cssToAssBaselineOffsetEm={compiledCaptionGeometry.cssToAssBaselineOffsetEm}
      textColor={fixture.caption.textColor}
      accentColor={fixture.caption.accentColor}
      fontFamily={captionFace.family}
      fontWeight={captionFace.resolvedWeight}
      textStyle={captionTextStyle}
      />
    </div>}
    {fontsReady && fixture.caption?.mode === "flow-highlight" && captionFace
      && compiledCaptionGeometry && <div data-browser-compiler-caption="">
      <FlowHighlightCaption
        fixture={fixture.caption}
        fontFamily={captionFace.family}
        fontWeight={captionFace.resolvedWeight}
        scaleX={compiledCaptionGeometry.scaleX}
        separatorAdvanceWidth={compiledCaptionGeometry.separatorAdvanceWidth}
        baselineOffsetEm={compiledCaptionGeometry.cssToAssBaselineOffsetEm}
      />
    </div>}
    {fontsReady && fixture.caption && captionFace && <div
      data-browser-stored-caption=""
      className="absolute inset-0"
      style={{ visibility: "hidden" }}
    >
      {(fixture.caption.mode || "positioned-pop") === "positioned-pop"
        && fixture.caption.positions
        ? <PositionedSubtitleWords
          words={fixture.caption.words}
          positions={fixture.caption.positions}
          activeWordIndex={fixture.caption.activeWordIndex}
          activeWordScale={fixture.caption.activeWordScale}
          canvasWidth={fixture.canvas.width}
          canvasHeight={fixture.canvas.height}
          layoutScale={fixture.caption.layoutScale}
          offsetY={fixture.caption.offsetY}
          cssToAssScale={fixture.caption.cssToAssScale}
          cssToAssBaselineOffsetEm={fixture.caption.cssToAssBaselineOffsetEm}
          textColor={fixture.caption.textColor}
          accentColor={fixture.caption.accentColor}
          fontFamily={captionFace.family}
          fontWeight={captionFace.resolvedWeight}
          textStyle={captionTextStyle}
        />
        : <FlowHighlightCaption
          fixture={fixture.caption}
          fontFamily={captionFace.family}
          fontWeight={captionFace.resolvedWeight}
          scaleX={fixture.caption.scaleX || 1}
          separatorAdvanceWidth={fixture.caption.separatorAdvanceWidth || 0}
          baselineOffsetEm={fixture.caption.cssToAssBaselineOffsetEm}
        />}
    </div>}
  </main>;
}

async function boot() {
  const response = await fetch("/__editor_v4_parity_fixture.json", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  const fixture = await response.json() as BrowserParityFixture;
  if (fixture.schemaVersion !== 1) throw new Error("Unsupported parity fixture");
  createRoot(document.getElementById("root")!).render(
    <BrowserParityScene fixture={fixture} />,
  );
}

void boot().catch((error: unknown) => {
  document.documentElement.dataset.browserParityError = error instanceof Error
    ? error.message
    : String(error);
});
