"use client";

import {
  useEffect,
  useMemo,
  useState,
  type PointerEventHandler,
} from "react";
import { EditorTitleV4Preview } from "@/components/editor-title-v4-preview";
import type {
  TemplateId,
  TitleTextStyle,
  VideoAspectRatio,
} from "@/lib/contracts";
import type { EditorFontId } from "@/lib/editor-fonts";
import {
  createEditorRenderTitleSpecV4,
  type EditorRenderTitleSpecV4,
} from "@/lib/editor-render-spec";
import type { TemplateConfig } from "@/lib/template-config";
import { createTemplateTitleV4DocumentInput } from "@/lib/template-title-v4-document";

const EMPTY_TITLE_STYLES: TitleTextStyle[] = [];

export function TemplateTitleV4Preview({
  enabled,
  templateId,
  title,
  templateConfig = null,
  videoAspectRatio,
  textStyles = EMPTY_TITLE_STYLES,
  fontId,
  primaryColor,
  accentColor,
  selected = false,
  onPointerDown,
}: {
  enabled: boolean;
  templateId: TemplateId;
  title: string;
  templateConfig?: TemplateConfig | null;
  videoAspectRatio?: VideoAspectRatio;
  textStyles?: TitleTextStyle[];
  fontId?: EditorFontId;
  primaryColor: string;
  accentColor: string;
  selected?: boolean;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  const editorDocument = useMemo(() => createTemplateTitleV4DocumentInput({
    templateId,
    title,
    templateConfig,
    videoAspectRatio,
    textStyles,
    fontId,
  }), [fontId, templateConfig, templateId, textStyles, title, videoAspectRatio]);
  const requestKey = useMemo(
    () => JSON.stringify(editorDocument),
    [editorDocument],
  );
  const [result, setResult] = useState<{
    key: string;
    spec: EditorRenderTitleSpecV4 | null;
  } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      return;
    }
    let cancelled = false;
    void createEditorRenderTitleSpecV4(editorDocument)
      .then((spec) => {
        if (!cancelled) setResult({ key: requestKey, spec });
      })
      .catch(() => {
        // Exact font loading/measurement is mandatory for v4. Do not hide a
        // fallback to the legacy CSS preview behind the v4 feature flag.
        if (!cancelled) setResult({ key: requestKey, spec: null });
      });
    return () => { cancelled = true; };
  }, [editorDocument, enabled, requestKey]);

  const spec = result?.key === requestKey ? result.spec : null;
  if (!enabled || !spec) return null;
  return <EditorTitleV4Preview
    spec={spec}
    sourceTitle={title}
    textStyles={textStyles}
    primaryColor={primaryColor}
    accentColor={accentColor}
    selected={selected}
    onPointerDown={onPointerDown}
  />;
}
