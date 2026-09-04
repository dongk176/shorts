"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  TEMPLATE_CANVAS,
  COMMENT_BACKGROUND_COLOR,
  aspectHeightRatio,
  stockBackgrounds,
  TEMPLATE_PRESET_COMMENT_SAMPLE,
  templatePresetPresentation,
  templateConfigColorOptions,
  templatePresetColorOptions,
  templatePresetColors,
  isTemplateConfigV5,
  createDefaultTemplateConfig,
  videoFrameForAspect,
  type CustomTemplate,
  type TemplateConfigColor,
  type TemplatePresetColor,
  type TemplateConfig,
  type TemplateTextOverlay,
} from "@/lib/template-config";
import { videoAspectRatioOptions, type TemplateId, type VideoAspectRatio } from "@/lib/contracts";
import { CustomTemplateTitlePreview } from "@/components/custom-template-title-preview";
import { TemplateTitleV4Preview } from "@/components/template-title-v4-preview";
import {
  CUSTOM_COMMENT_Y_MAX,
  CUSTOM_COMMENT_Y_MIN,
  customCanvasWidth,
  customCenteredLayerStyle,
  customCommentCanDockToVideo,
  customCommentLayerY,
  customVideoFrameStyle,
} from "@/lib/custom-template-preview-layout";
import { CENTER_SNAP_THRESHOLD_PX, snapAxisToCenter } from "@/lib/template-editor-snap";
import { userFacingErrorMessage } from "@/lib/public-error";
import { TemplateCommentPrototype } from "@/components/template-comment-prototype";
import { TemplateSubtitlePreview } from "@/components/template-subtitle-preview";
import { editorFontFamily, editorFontOptions, resolveEditorFontFace, type EditorFontId } from "@/lib/editor-fonts";
import { isEditorRenderSpecV4Enabled } from "@/lib/editor-render-v4-feature";
import { BackgroundAssetPicker } from "@/components/background-asset-picker";
import { EditorTextOverlayPreview } from "@/components/editor-text-overlay-preview";
import { EditorTextOverlayPaint } from "@/components/editor-text-overlay-paint";
import { EditorTextOverlayControls } from "@/components/editor-text-overlay-controls";
import {
  clampCanvasDelta,
  clampCenteredOverlayOffsetAfterScale,
  clientDeltaToCanvas,
  clientRectToCanvas,
  resizeEditorTextOverlayWidth,
  snapRectCenterToCanvas,
  type EditorTextResizeEdge,
} from "@/lib/editor-overlay-preview";
import {
  addTemplateTextOverlay,
  hasTemplateDesignLayerOrder,
  moveTemplateTextLayer,
  removeTemplateTextOverlay,
  templateBackgroundStyle,
  templateDesignLayerOrder,
  templateDesignLayerZIndex,
  templateTextEditorValue,
  templateTextRenderSpec,
  TEMPLATE_TEXT_OVERLAY_LIMIT,
} from "@/lib/template-design-preview";
import { notifyTemplateLibraryChanged } from "@/lib/template-library-events";

type LayerId = "video" | "title" | "subtitle" | "channel" | "comment";
type SelectedLayerId = LayerId | `text:${string}`;
type TemplateLayerId = Exclude<LayerId, "comment">;
type TextLayerId = "title" | "channel";
type History = { past: TemplateConfig[]; present: TemplateConfig; future: TemplateConfig[] };
type CenterGuides = { x: boolean; y: boolean };
type TemplateSidebarTool =
  | "title"
  | "text"
  | "subtitle"
  | "comment"
  | "channel"
  | "background"
  | "template";

const TEMPLATE_SIDEBAR_TOOLS = [
  { id: "title", label: "후킹 제목" },
  { id: "text", label: "텍스트" },
  { id: "subtitle", label: "자막" },
  { id: "comment", label: "댓글" },
  { id: "channel", label: "채널명" },
  { id: "background", label: "배경" },
  { id: "template", label: "템플릿" },
] as const satisfies readonly { id: TemplateSidebarTool; label: string }[];

function TemplateSidebarSectionIcon({ section }: { section: TemplateSidebarTool }) {
  if (section === "title") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 5h12M10 5v10M7.3 15h5.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>;
  }
  if (section === "comment") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.25 4.25h11.5v8.5H9l-3.75 3v-3h-1Z" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 7.25h6M7 9.75h4" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    </svg>;
  }
  if (section === "subtitle") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.75 9h3.5M10.75 9h3.5M5.75 12h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>;
  }
  if (section === "text") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.25 7h7.5M10 7v6.25M7.8 13.25h4.4" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    </svg>;
  }
  if (section === "channel") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.55" />
      <path d="M4.5 16c.55-3 2.35-4.5 5.5-4.5s4.95 1.5 5.5 4.5" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    </svg>;
  }
  if (section === "background") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3.5" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.55" />
      <circle cx="7" cy="7.5" r="1.35" fill="currentColor" />
      <path d="m4.5 14 3.7-3.7 2.35 2.3 1.7-1.7 3.25 3.1" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
  }
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3.8 8h12.4M9 8v8.2" stroke="currentColor" strokeWidth="1.5" />
  </svg>;
}

function sidebarToolForLayer(layer: SelectedLayerId): TemplateSidebarTool {
  if (layer === "video") return "template";
  if (layer === "title" || layer === "subtitle" || layer === "comment" || layer === "channel") {
    return layer;
  }
  return "text";
}
const commentSizeOptions: { value: TemplateConfig["comment"]["size"]; label: string }[] = [
  { value: "small", label: "작게" },
  { value: "medium", label: "기본" },
  { value: "large", label: "크게" },
];
const commentThemeOptions = [
  { value: "dark", label: "다크 모드", background: COMMENT_BACKGROUND_COLOR, foreground: "#ffffff" },
  { value: "light", label: "화이트 모드", background: "#ffffff", foreground: "#18181b" },
] as const;
const subtitleVariantOptions = [
  { value: "highlight", label: "강조형", description: "말하는 어절을 색으로 강조" },
  { value: "pop", label: "팝형", description: "핵심 어절을 크게 강조" },
] as const;
const COMMENT_VIDEO_SNAP_THRESHOLD_PX = 18;
const COMMENT_Y_MIN = CUSTOM_COMMENT_Y_MIN;
const COMMENT_Y_MAX = CUSTOM_COMMENT_Y_MAX;
const hiddenCenterGuides: CenterGuides = { x: false, y: false };
const compactTextColors = ["#FFFFFF", "#111111", "#35E6E3"] as const satisfies readonly TemplateConfigColor[];
const compactTextBackgroundColors = ["#111111", "#FFFFFF"] as const satisfies readonly TemplateConfigColor[];
const compactBackgroundColors = [COMMENT_BACKGROUND_COLOR, "#000000", "#111111", "#FFFFFF", "#F3F0E9", "#E32626", "#2563EB"] as const satisfies readonly TemplateConfigColor[];

function cloneConfig(config: TemplateConfig) {
  return structuredClone(config);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function snapCommentYToVideo(candidateY: number, videoBottom: number, threshold: number) {
  if (videoBottom < COMMENT_Y_MIN || videoBottom > COMMENT_Y_MAX) {
    return { value: candidateY, snapped: false };
  }
  return snapAxisToCenter(candidateY, videoBottom, threshold);
}

type TemplateColorOption = { color: TemplateConfigColor; name: string };

function compactColorOptions(
  value: TemplateConfigColor | null,
  colors: readonly TemplateConfigColor[],
  options: readonly TemplateColorOption[] = templateConfigColorOptions,
) {
  const defaults = colors.map((color) => options.find((option) => option.color === color)!);
  if (!value || defaults.some((option) => option.color === value)) return defaults;
  const selected = options.find((option) => option.color === value);
  return selected ? [selected, ...defaults.slice(0, colors.length - 1)] : defaults;
}

function rendererPresetColor(
  value: TemplateConfigColor,
): value is TemplatePresetColor {
  return (templatePresetColors as readonly string[]).includes(value);
}

function ColorPalette({ value, onChange, allowNone = false, rendererOnly = false }: { value: TemplateConfigColor | null; onChange: (value: TemplateConfigColor | null) => void; allowNone?: boolean; rendererOnly?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const options: readonly TemplateColorOption[] = rendererOnly
    ? templatePresetColorOptions
    : templateConfigColorOptions;
  const visibleOptions = expanded
    ? options
    : compactColorOptions(
        value,
        allowNone ? compactTextBackgroundColors : compactTextColors,
        options,
      );
  return (
    <div className="flex flex-wrap gap-2">
      {allowNone && <button type="button" title="없음" aria-label="배경 없음" aria-pressed={value === null} onClick={() => onChange(null)} className={`flex h-8 w-8 items-center justify-center rounded-full border border-dashed text-[8px] font-bold transition ${value === null ? "border-[#ff715e] text-white ring-2 ring-[#ff715e]/25" : "border-white/35 bg-white/[.03] text-neutral-400 hover:border-white/60 hover:text-white"}`}>없음</button>}
      {visibleOptions.map((option) => (
        <button key={option.color} type="button" title={option.name} aria-label={`색상 ${option.name}`} aria-pressed={value === option.color} onClick={() => onChange(option.color)} className={`h-8 w-8 rounded-full border border-white/20 transition ${value === option.color ? "ring-2 ring-[#ff715e] ring-offset-2 ring-offset-[#19191c]" : "hover:scale-105 hover:border-white/50"}`} style={{ backgroundColor: option.color }} />
      ))}
      <button type="button" title={expanded ? "접기" : "전체 보기"} aria-label={expanded ? "색상 접기" : "색상 전체 보기"} aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#353438] text-base font-medium text-neutral-200 transition hover:border-white/40 hover:bg-[#454449]">{expanded ? "−" : "+"}</button>
    </div>
  );
}

export function TemplateEditor({
  initialTemplate,
  baseTemplateId,
  initialConfig,
  unifiedSubtitleCanaryEnabled = false,
  customTemplateDesignEnabled = false,
  suggestedName,
}: {
  initialTemplate: CustomTemplate | null;
  baseTemplateId: TemplateId;
  initialConfig: TemplateConfig;
  unifiedSubtitleCanaryEnabled?: boolean;
  customTemplateDesignEnabled?: boolean;
  suggestedName?: string;
}) {
  const commentLayerEnabled = baseTemplateId === "comment-capture";
  const [history, setHistory] = useState<History>({ past: [], present: initialConfig, future: [] });
  const initialName = initialTemplate?.name || suggestedName || "나의 템플릿";
  const [name, setName] = useState(initialName);
  const [selectedLayer, setSelectedLayer] = useState<SelectedLayerId>("title");
  const [activeSidebarTool, setActiveSidebarTool] = useState<TemplateSidebarTool>("title");
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showAllBackgroundColors, setShowAllBackgroundColors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedTemplate, setSavedTemplate] = useState(initialTemplate);
  const [centerGuides, setCenterGuides] = useState<CenterGuides>(hiddenCenterGuides);
  const [commentSnapGuide, setCommentSnapGuide] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const transactionRef = useRef<TemplateConfig | null>(null);
  const textDragCleanupRef = useRef<(() => void) | null>(null);
  const baselineRef = useRef(JSON.stringify({ name: initialName, config: initialConfig }));
  const config = history.present;
  const configRef = useRef(config);
  configRef.current = config;
  const extraTexts = config.textOverlays || [];
  const selectedExtraText = selectedLayer.startsWith("text:")
    ? extraTexts.find((text) => text.id === selectedLayer.slice(5)) || null
    : null;
  const hasDesignOrder = hasTemplateDesignLayerOrder(config);
  const previewTitleLines = isTemplateConfigV5(config) && config.subtitle.visible
    ? (["AI가 고른 오늘의", "핵심 장면"] as const)
    : templatePresetPresentation[baseTemplateId].titleLines;
  const dirty = JSON.stringify({ name, config }) !== baselineRef.current;
  const unifiedSubtitleConfigEnabled = unifiedSubtitleCanaryEnabled && isTemplateConfigV5(config);
  const positionedWordsV4Enabled = isEditorRenderSpecV4Enabled();
  const videoBottom = config.video.y + config.video.height;
  const commentCanDockToVideo = customCommentCanDockToVideo(config.video);
  const commentIsDockedToVideo = config.comment.dockedToVideo && commentCanDockToVideo;
  const commentY = customCommentLayerY(config);

  const selectLayer = useCallback((layer: SelectedLayerId) => {
    setSelectedLayer(layer);
    setActiveSidebarTool(sidebarToolForLayer(layer));
  }, []);

  const activateSidebarTool = (tool: TemplateSidebarTool) => {
    setActiveSidebarTool(tool);
    if (tool === "title" || tool === "subtitle" || tool === "comment" || tool === "channel") {
      setSelectedLayer(tool);
      return;
    }
    if (tool === "template") {
      setSelectedLayer("video");
      return;
    }
    if (tool === "text" && extraTexts[0]) {
      setSelectedLayer(`text:${extraTexts[0].id}`);
      setEditingTextId(null);
    }
  };

  const commit = useCallback((updater: (current: TemplateConfig) => TemplateConfig) => {
    setHistory((current) => {
      const next = updater(cloneConfig(current.present));
      if (JSON.stringify(next) === JSON.stringify(current.present)) return current;
      return { past: [...current.past.slice(-49), current.present], present: next, future: [] };
    });
  }, []);

  const updateTransient = useCallback((updater: (current: TemplateConfig) => TemplateConfig) => {
    setHistory((current) => ({ ...current, present: updater(cloneConfig(current.present)), future: [] }));
  }, []);

  const undo = useCallback(() => setHistory((current) => {
    const previous = current.past.at(-1);
    if (!previous) return current;
    return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future].slice(0, 50) };
  }), []);
  const redo = useCallback(() => setHistory((current) => {
    const next = current.future[0];
    if (!next) return current;
    return { past: [...current.past.slice(-49), current.present], present: next, future: current.future.slice(1) };
  }), []);

  const beginTextInteraction = useCallback(() => {
    if (!transactionRef.current) transactionRef.current = cloneConfig(configRef.current);
  }, []);
  const finishTextInteraction = useCallback(() => {
    const before = transactionRef.current;
    transactionRef.current = null;
    if (!before) return;
    setHistory((current) => JSON.stringify(before) === JSON.stringify(current.present)
      ? current
      : { past: [...current.past.slice(-49), before], present: current.present, future: [] });
  }, []);

  useEffect(() => () => textDragCleanupRef.current?.(), []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (event.isComposing || saving || backgroundBusy) return;
      event.preventDefault();
      finishTextInteraction();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [backgroundBusy, finishTextInteraction, redo, saving, undo]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const beginPointerAction = (event: ReactPointerEvent, layer: TemplateLayerId, mode: "move" | "resize" = "move") => {
    if (saving || backgroundBusy) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    selectLayer(layer);
    setCenterGuides(hiddenCenterGuides);
    event.currentTarget.setPointerCapture(event.pointerId);
    transactionRef.current = cloneConfig(config);
    const startX = event.clientX;
    const startY = event.clientY;
    const startConfig = cloneConfig(config);
    const rect = canvas.getBoundingClientRect();
    const toCanvasX = TEMPLATE_CANVAS.width / rect.width;
    const toCanvasY = TEMPLATE_CANVAS.height / rect.height;

    const move = (moveEvent: PointerEvent) => {
      const dx = Math.round((moveEvent.clientX - startX) * toCanvasX);
      const dy = Math.round((moveEvent.clientY - startY) * toCanvasY);
      const snapThresholdX = CENTER_SNAP_THRESHOLD_PX * toCanvasX;
      const snapThresholdY = CENTER_SNAP_THRESHOLD_PX * toCanvasY;

      if (mode === "move") {
        if (layer === "video") {
          const maxX = TEMPLATE_CANVAS.width - startConfig.video.width;
          const maxY = TEMPLATE_CANVAS.height - startConfig.video.height;
          const candidateX = clamp(startConfig.video.x + dx, 0, maxX);
          const candidateY = clamp(startConfig.video.y + dy, 0, maxY);
          const horizontal = snapAxisToCenter(
            candidateX + startConfig.video.width / 2,
            TEMPLATE_CANVAS.width / 2,
            snapThresholdX,
          );
          const vertical = snapAxisToCenter(
            candidateY + startConfig.video.height / 2,
            TEMPLATE_CANVAS.height / 2,
            snapThresholdY,
          );

          updateTransient((next) => {
            next.video.x = Math.round(clamp(horizontal.value - startConfig.video.width / 2, 0, maxX));
            next.video.y = Math.round(clamp(vertical.value - startConfig.video.height / 2, 0, maxY));
            return next;
          });
          setCenterGuides({ x: horizontal.snapped, y: vertical.snapped });
          return;
        }

        if (layer === "subtitle") {
          updateTransient((next) => {
            if (!isTemplateConfigV5(next)) return next;
            next.subtitle.x = TEMPLATE_CANVAS.width / 2;
            next.subtitle.y = Math.round(clamp(
              startConfig.subtitle.y + dy,
              120,
              1800,
            ));
            return next;
          });
          setCenterGuides({ x: true, y: false });
          return;
        }

        const candidateX = clamp(startConfig[layer].x + dx, 0, TEMPLATE_CANVAS.width);
        const candidateY = clamp(startConfig[layer].y + dy, 0, TEMPLATE_CANVAS.height);
        const horizontal = snapAxisToCenter(candidateX, TEMPLATE_CANVAS.width / 2, snapThresholdX);
        const vertical = snapAxisToCenter(candidateY, TEMPLATE_CANVAS.height / 2, snapThresholdY);

        updateTransient((next) => {
          next[layer].x = horizontal.value;
          next[layer].y = vertical.value;
          return next;
        });
        setCenterGuides({ x: horizontal.snapped, y: vertical.snapped });
        return;
      }

      updateTransient((next) => {
        const ratio = aspectHeightRatio(next.video.aspectRatio);
        const maxWidth = Math.min(TEMPLATE_CANVAS.width - startConfig.video.x, (TEMPLATE_CANVAS.height - startConfig.video.y) / ratio);
        const width = Math.round(clamp(startConfig.video.width + dx, 240, maxWidth));
        next.video.width = width;
        next.video.height = Math.round(width * ratio);
        return next;
      });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setCenterGuides(hiddenCenterGuides);
      const before = transactionRef.current;
      transactionRef.current = null;
      if (!before) return;
      setHistory((current) => JSON.stringify(before) === JSON.stringify(current.present)
        ? current
        : { past: [...current.past.slice(-49), before], present: current.present, future: [] });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const beginCommentPointerAction = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (saving || backgroundBusy) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    selectLayer("comment");
    event.currentTarget.setPointerCapture(event.pointerId);
    transactionRef.current = cloneConfig(config);
    const startPointerY = event.clientY;
    const startLayerY = commentY;
    const toCanvasY = TEMPLATE_CANVAS.height / canvas.getBoundingClientRect().height;

    const move = (moveEvent: PointerEvent) => {
      const deltaY = Math.round((moveEvent.clientY - startPointerY) * toCanvasY);
      const candidateY = clamp(startLayerY + deltaY, COMMENT_Y_MIN, COMMENT_Y_MAX);
      const vertical = snapCommentYToVideo(
        candidateY,
        videoBottom,
        COMMENT_VIDEO_SNAP_THRESHOLD_PX * toCanvasY,
      );
      updateTransient((next) => {
        next.comment.y = vertical.value;
        next.comment.dockedToVideo = vertical.snapped;
        return next;
      });
      setCommentSnapGuide(vertical.snapped);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setCommentSnapGuide(false);
      const before = transactionRef.current;
      transactionRef.current = null;
      if (!before) return;
      setHistory((current) => JSON.stringify(before) === JSON.stringify(current.present)
        ? current
        : { past: [...current.past.slice(-49), before], present: current.present, future: [] });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const changeAspect = (aspectRatio: VideoAspectRatio) => commit((next) => {
    const preferredWidth = Math.min(next.video.width, TEMPLATE_CANVAS.width);
    next.video = videoFrameForAspect(aspectRatio, preferredWidth);
    return next;
  });

  const updateExtraText = (
    id: string,
    patch: Partial<Omit<TemplateTextOverlay, "id">>,
    mode: "continuous" | "record" = "record",
  ) => {
    if (!customTemplateDesignEnabled || saving || backgroundBusy) return;
    const update = (next: TemplateConfig) => ({
      ...next,
      textOverlays: next.textOverlays?.map((text) => text.id === id ? { ...text, ...patch } : text),
    });
    if (mode === "continuous") {
      beginTextInteraction();
      updateTransient(update);
    } else {
      finishTextInteraction();
      commit(update);
    }
  };

  const addExtraText = () => {
    if (!customTemplateDesignEnabled || extraTexts.length >= TEMPLATE_TEXT_OVERLAY_LIMIT || saving || backgroundBusy) return;
    if (typeof crypto.randomUUID !== "function") {
      setMessage("최신 브라우저에서 텍스트를 추가해 주세요.");
      return;
    }
    const id = crypto.randomUUID();
    finishTextInteraction();
    commit((next) => addTemplateTextOverlay(next, id));
    selectLayer(`text:${id}`);
    setEditingTextId(null);
  };

  const deleteExtraText = (id: string) => {
    if (!customTemplateDesignEnabled || saving || backgroundBusy) return;
    finishTextInteraction();
    commit((next) => removeTemplateTextOverlay(next, id));
    setEditingTextId(null);
    selectLayer("title");
  };

  const beginExtraTextPointerAction = (
    id: string,
    event: ReactPointerEvent<HTMLButtonElement>,
    edge?: EditorTextResizeEdge,
  ) => {
    if (!customTemplateDesignEnabled || saving || backgroundBusy || event.button !== 0) return;
    const canvas = canvasRef.current;
    const text = configRef.current.textOverlays?.find((item) => item.id === id);
    if (!canvas || !text) return;
    event.preventDefault();
    event.stopPropagation();
    textDragCleanupRef.current?.();
    finishTextInteraction();
    beginTextInteraction();
    selectLayer(`text:${id}`);
    setCenterGuides(hiddenCenterGuides);
    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const canvasRect = canvas.getBoundingClientRect();
    const textRect = clientRectToCanvas(captureTarget.getBoundingClientRect(), canvasRect);
    captureTarget.setPointerCapture(pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const raw = clientDeltaToCanvas({ x: moveEvent.clientX - startX, y: moveEvent.clientY - startY }, canvasRect);
      if (edge) {
        const resized = resizeEditorTextOverlayWidth({
          width: text.width, offsetX: text.offset.x, deltaX: raw.x / text.scale, edge,
        });
        updateTransient((next) => ({
          ...next,
          textOverlays: next.textOverlays?.map((item) => item.id === id
            ? { ...item, width: resized.width, offset: { ...item.offset, x: resized.offsetX } }
            : item),
        }));
        return;
      }
      const snapped = snapRectCenterToCanvas(textRect, clampCanvasDelta(textRect, raw), CENTER_SNAP_THRESHOLD_PX * TEMPLATE_CANVAS.width / canvasRect.width);
      const delta = clampCanvasDelta(textRect, snapped.delta);
      updateTransient((next) => ({
        ...next,
        textOverlays: next.textOverlays?.map((item) => item.id === id
          ? { ...item, offset: { x: text.offset.x + delta.x, y: text.offset.y + delta.y } }
          : item),
      }));
      setCenterGuides(snapped.guides);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (captureTarget.hasPointerCapture(pointerId)) captureTarget.releasePointerCapture(pointerId);
      if (textDragCleanupRef.current === cleanup) textDragCleanupRef.current = null;
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      cleanup();
      setCenterGuides(hiddenCenterGuides);
      finishTextInteraction();
    };
    textDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const changeExtraTextScale = (text: TemplateTextOverlay, scale: number) => {
    const canvas = canvasRef.current;
    const element = canvas?.querySelector<HTMLElement>(`[data-editor-text-overlay-id="${text.id}"]`);
    const offset = canvas && element
      ? clampCenteredOverlayOffsetAfterScale({
          layerRect: clientRectToCanvas(element.getBoundingClientRect(), canvas.getBoundingClientRect()),
          offset: text.offset, currentScale: text.scale, nextScale: scale,
        })
      : text.offset;
    updateExtraText(text.id, { scale, offset }, "continuous");
  };

  const save = async () => {
    if (saving || backgroundBusy) return;
    finishTextInteraction();
    if (!name.trim()) { setMessage("템플릿 이름을 입력해 주세요."); return; }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(savedTemplate ? `/api/templates/${savedTemplate.id}` : "/api/templates", {
        method: savedTemplate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savedTemplate
          ? { name: name.trim(), config, version: savedTemplate.version }
          : { name: name.trim(), baseTemplateId, config }),
      });
      const payload = await response.json() as { template?: CustomTemplate; detail?: string };
      if (!response.ok || !payload.template) throw new Error(payload.detail || "템플릿을 저장하지 못했습니다.");
      setSavedTemplate(payload.template);
      setName(payload.template.name);
      setHistory({ past: [], present: payload.template.config, future: [] });
      baselineRef.current = JSON.stringify({ name: payload.template.name, config: payload.template.config });
      setMessage("템플릿을 저장했습니다. 홈의 템플릿 선택에서도 바로 사용할 수 있습니다.");
      notifyTemplateLibraryChanged();
      if (!initialTemplate) window.history.replaceState(null, "", `/templates/${payload.template.id}/edit`);
    } catch (error) {
      setMessage(userFacingErrorMessage(error, "템플릿을 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  };

  const selectedTextLayer = selectedLayer === "title" || selectedLayer === "channel" ? config[selectedLayer] : null;
  const selectedSubtitle = selectedLayer === "subtitle" && unifiedSubtitleConfigEnabled && isTemplateConfigV5(config)
    ? config.subtitle
    : null;
  const unifiedTitleFontId = unifiedSubtitleConfigEnabled && isTemplateConfigV5(config)
    ? config.title.fontId
    : undefined;
  const background = templateBackgroundStyle(config.background);
  const selectedBackgroundColor = config.background.kind === "color" ? config.background.color : null;
  const visibleBackgroundColors = showAllBackgroundColors
    ? templateConfigColorOptions
    : compactColorOptions(selectedBackgroundColor, compactBackgroundColors);

  return (
    <div className="min-h-dvh bg-[#101012] text-neutral-100">
      <div className="hidden min-h-dvh lg:block">
        <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-white/10 bg-[#171719]/95 px-5 backdrop-blur-xl">
          <div className="flex items-center gap-4"><Link href="/templates" className="text-sm font-bold text-neutral-400 hover:text-white">← 라이브러리</Link><span className="h-5 w-px bg-white/10" /><strong className="tracking-[-.03em]">Easy Cut <span className="text-[#ff715e]">템플릿 커스텀</span></strong></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { finishTextInteraction(); undo(); }} disabled={!history.past.length || saving || backgroundBusy} className="rounded-lg border border-white/10 px-3 py-2 text-sm disabled:opacity-30" aria-label="실행 취소">↶ 되돌리기</button>
            <button type="button" onClick={() => { finishTextInteraction(); redo(); }} disabled={!history.future.length || saving || backgroundBusy} className="rounded-lg border border-white/10 px-3 py-2 text-sm disabled:opacity-30" aria-label="다시 실행">↷ 복구하기</button>
          </div>
        </header>

        <main className="min-h-dvh pb-10 pl-[504px] pr-6 pt-24">
          <div className="mx-auto flex max-w-[920px] flex-col items-center">
            <div className="mb-4 flex w-full max-w-[500px] items-center justify-between text-xs font-bold text-neutral-500"><span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-emerald-300">● LIVE PREVIEW</span><span>9:16 · 1080 × 1920</span></div>
            <div className="flex min-h-[680px] w-full items-center justify-center overflow-auto">
              <div style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}>
                <div ref={canvasRef} className="relative aspect-[9/16] w-[360px] touch-none overflow-hidden rounded-[12px] shadow-[0_30px_100px_rgba(0,0,0,.65)]" style={{ ...background, containerType: "inline-size" }} onPointerDown={() => selectLayer("video")}>
                  <div onPointerDown={(event) => beginPointerAction(event, "video")} className={`absolute cursor-move overflow-hidden bg-neutral-700 ${selectedLayer === "video" ? "ring-2 ring-[#ff715e] ring-inset" : ""}`} style={{ ...customVideoFrameStyle(config.video), zIndex: templateDesignLayerZIndex(config, "video") }}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#73737c,#2c2c31_70%)]" /><div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
                    <button type="button" aria-label="영상 크기 조절" onPointerDown={(event) => beginPointerAction(event, "video", "resize")} className="absolute bottom-0 right-0 h-6 w-6 cursor-nwse-resize border-l border-t border-white bg-[#ff715e]" />
                  </div>
                  {positionedWordsV4Enabled
                    ? <TemplateTitleV4Preview
                        enabled
                        templateId={baseTemplateId}
                        title={`${previewTitleLines[0]}\n${previewTitleLines[1]}`}
                        templateConfig={config}
                        primaryColor={config.title.primaryColor}
                        accentColor={config.title.accentColor}
                        selected={selectedLayer === "title"}
                        zIndex={templateDesignLayerZIndex(config, "title")}
                        onPointerDown={(event) => beginPointerAction(event, "title")}
                      />
                    : <CustomTemplateTitlePreview
                        title={config.title}
                        firstLine={previewTitleLines[0]}
                        secondLine={previewTitleLines[1]}
                        fontFamily={unifiedTitleFontId ? editorFontFamily(unifiedTitleFontId) : undefined}
                        fontWeight={unifiedTitleFontId ? resolveEditorFontFace(unifiedTitleFontId, "title").resolvedWeight : undefined}
                        selected={selectedLayer === "title"}
                        movementStyle={{ zIndex: templateDesignLayerZIndex(config, "title") }}
                        onPointerDown={(event) => beginPointerAction(event, "title")}
                      />}
                  {unifiedSubtitleConfigEnabled && isTemplateConfigV5(config)
                    ? <TemplateSubtitlePreview
                        subtitle={config.subtitle}
                        selected={selectedLayer === "subtitle"}
                        onPointerDown={(event) => beginPointerAction(event, "subtitle")}
                        positionedWordsV4Enabled={positionedWordsV4Enabled}
                      />
                    : null}
                  {config.channel.visible && !commentLayerEnabled && <button type="button" onPointerDown={(event) => beginPointerAction(event, "channel")} className={`absolute z-30 cursor-move truncate rounded px-[1.8cqw] py-[.8cqw] text-center font-bold ${selectedLayer === "channel" ? "outline outline-2 outline-[#ff715e]" : ""}`} style={{ ...customCenteredLayerStyle(config.channel), color: config.channel.color, backgroundColor: config.channel.backgroundColor || "transparent", fontSize: customCanvasWidth(config.channel.fontSize), zIndex: templateDesignLayerZIndex(config, "channel") }}>● Easy Cut</button>}
                  {commentLayerEnabled && <div className={`absolute inset-x-0 ${hasDesignOrder ? "" : "z-40"}`} style={{ top: `${(commentY / TEMPLATE_CANVAS.height) * 100}%` }}>
                    {config.comment.visible && <div style={hasDesignOrder ? { position: "relative", zIndex: templateDesignLayerZIndex(config, "comment") } : undefined}><TemplateCommentPrototype selected={selectedLayer === "comment"} theme={config.comment.theme} size={config.comment.size} comment={TEMPLATE_PRESET_COMMENT_SAMPLE} onSelect={() => selectLayer("comment")} onPointerDown={beginCommentPointerAction} /></div>}
                    {config.channel.visible && <button type="button" onClick={() => selectLayer("channel")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); selectLayer("channel"); }} className={`${config.schemaVersion >= 4 ? "absolute left-1/2" : "relative mx-auto mt-[2cqw] block"} z-30 truncate rounded px-[1.8cqw] py-[.8cqw] text-center font-bold ${selectedLayer === "channel" ? "outline outline-2 outline-[#ff715e]" : ""}`} style={{ top: config.schemaVersion >= 4 ? customCanvasWidth(config.channel.y - commentY) : undefined, transform: config.schemaVersion >= 4 ? "translate(-50%, -50%)" : undefined, width: customCanvasWidth(config.channel.maxWidth), color: config.channel.color, backgroundColor: config.channel.backgroundColor || "transparent", fontSize: customCanvasWidth(config.channel.fontSize), zIndex: templateDesignLayerZIndex(config, "channel") }}>● Easy Cut</button>}
                  </div>}
                  {extraTexts.map((text) => customTemplateDesignEnabled
                    ? <EditorTextOverlayPreview
                        key={text.id}
                        textOverlay={templateTextEditorValue(text)}
                        renderSpec={templateTextRenderSpec(text)}
                        selected={selectedExtraText?.id === text.id}
                        editing={editingTextId === text.id}
                        zIndex={templateDesignLayerZIndex(config, `text:${text.id}`)}
                        onPointerDown={(event) => beginExtraTextPointerAction(text.id, event)}
                        onResizePointerDown={(edge, event) => beginExtraTextPointerAction(text.id, event, edge)}
                        onDelete={deleteExtraText}
                        onEditStart={(id) => { finishTextInteraction(); beginTextInteraction(); selectLayer(`text:${id}`); setEditingTextId(id); }}
                        onEditValueChange={(id, text) => updateExtraText(id, { text }, "continuous")}
                        onEditEnd={() => { finishTextInteraction(); setEditingTextId(null); }}
                      />
                    : <EditorTextOverlayPaint key={text.id} textOverlay={text} renderSpec={templateTextRenderSpec(text)} zIndex={templateDesignLayerZIndex(config, `text:${text.id}`)} />)}
                  {commentSnapGuide && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[500] h-px bg-[#35e6e3] shadow-[0_0_7px_rgba(53,230,227,.9)]" style={{ top: `${(videoBottom / TEMPLATE_CANVAS.height) * 100}%` }}><span className="absolute right-2 -translate-y-full rounded-t bg-[#35e6e3] px-1.5 py-0.5 text-[7px] font-black text-black">영상 하단에 맞춤</span></div>}
                  {centerGuides.x && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 z-[500] w-px -translate-x-1/2 bg-[#ff2bd6] shadow-[0_0_5px_rgba(255,43,214,.95)]" />}
                  {centerGuides.y && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 z-[500] h-px -translate-y-1/2 bg-[#ff2bd6] shadow-[0_0_5px_rgba(255,43,214,.95)]" />}
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-[#19191c] p-1"><button type="button" onClick={() => setZoom((value) => clamp(value - .1, .7, 1.2))} className="h-9 w-9 rounded-lg hover:bg-white/5">−</button><span className="w-14 text-center text-xs font-bold">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => clamp(value + .1, .7, 1.2))} className="h-9 w-9 rounded-lg hover:bg-white/5">＋</button></div>
          </div>
        </main>

        <aside className="fixed bottom-0 left-0 top-16 z-40 flex w-[480px] border-r border-white/10 bg-[#19191c]">
          <nav className="flex w-[88px] shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-[#111114] px-2 py-3 [scrollbar-width:none] [&_svg]:h-[23px] [&_svg]:w-[23px] [&::-webkit-scrollbar]:hidden" aria-label="템플릿 편집 도구">
            <div className="flex flex-col gap-1.5">
              {TEMPLATE_SIDEBAR_TOOLS.map((tool) => {
                const active = activeSidebarTool === tool.id;
                return <button
                  key={tool.id}
                  type="button"
                  aria-pressed={active}
                  aria-controls="template-tool-detail"
                  onClick={() => activateSidebarTool(tool.id)}
                  className={`flex min-h-[76px] w-full flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-center text-[13px] font-extrabold leading-tight tracking-[-.025em] transition ${active ? "bg-white/[.12] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]" : "text-[#aaa8b0] hover:bg-white/[.06] hover:text-white"}`}
                >
                  <span className={`grid h-[34px] w-[34px] place-items-center rounded-[10px] ${active ? "bg-white/[.16]" : "bg-white/[.07]"}`}>
                    <TemplateSidebarSectionIcon section={tool.id} />
                  </span>
                  {tool.label}
                </button>;
              })}
            </div>
          </nav>
          <div id="template-tool-detail" className="relative flex min-w-0 flex-1 flex-col bg-[#18181c]">
          <fieldset disabled={saving || backgroundBusy} className="min-h-0 flex-1 space-y-7 overflow-y-auto px-[22px] pb-32 pt-[18px]">
            <header className="border-b border-white/[.08] pb-4">
              <h1 className="text-lg font-extrabold tracking-[-.025em] text-[#f6f4f7]">{TEMPLATE_SIDEBAR_TOOLS.find((tool) => tool.id === activeSidebarTool)?.label}</h1>
              <p className="mt-1.5 text-xs leading-5 text-[#8f8e97]">오른쪽 미리보기에서 변경 내용을 실시간으로 확인하세요.</p>
            </header>

            <section hidden={activeSidebarTool !== "template"}>
              <label className="block text-[15px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">템플릿 이름<input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm font-medium text-white outline-none transition focus:border-[#ff715e]" /></label>
              <div className="mt-6 border-t border-white/10 pt-5">
                <h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">영상 프레임</h2>
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5"><h3 className="text-sm font-semibold text-neutral-200">영상 비율</h3><div className="mt-3 grid grid-cols-5 gap-1">{videoAspectRatioOptions.map((option) => <button key={option.value} type="button" onClick={() => changeAspect(option.value)} className={`rounded-lg py-2 text-[10px] font-bold transition ${config.video.aspectRatio === option.value ? "bg-white text-black" : "bg-white/5 text-neutral-400 hover:bg-white/10"}`}>{option.value}</button>)}</div><p className="mt-3 text-[11px] leading-5 text-neutral-500">프레임을 끌어 이동하고 오른쪽 아래 핸들로 비율을 유지한 채 크기를 조절하세요.</p></div>
              </div>
            </section>

            {customTemplateDesignEnabled && <section hidden={activeSidebarTool !== "text"} aria-label="템플릿 추가 텍스트">
              <div className="flex items-center justify-between gap-3"><h2 className="text-[17px] font-extrabold text-[#f2f0f4]">추가 텍스트</h2><span className="text-xs text-neutral-500">{extraTexts.length}/{TEMPLATE_TEXT_OVERLAY_LIMIT}</span></div>
              <p className="mt-1.5 text-xs leading-5 text-[#8f8e97]">완성 영상 전체에 표시됩니다. 생성 후 편집기에서 표시 시간을 바꿀 수 있습니다.</p>
              <button type="button" disabled={extraTexts.length >= TEMPLATE_TEXT_OVERLAY_LIMIT} onClick={addExtraText} className="mt-3 w-full rounded-xl border border-white/15 bg-white/[.04] py-3 text-xs font-bold text-neutral-100 hover:border-[#ff715e] disabled:opacity-40">+ 텍스트 추가</button>
              {extraTexts.length > 0 && <div className="mt-3 space-y-2" aria-label="템플릿 추가 텍스트 목록">{extraTexts.map((text, index) => <div key={text.id}>
                <button type="button" aria-pressed={selectedExtraText?.id === text.id} onClick={() => { selectLayer(`text:${text.id}`); setEditingTextId(null); }} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-xs ${selectedExtraText?.id === text.id ? "border-[#ff715e] bg-[#ff715e]/10 text-white" : "border-white/10 text-neutral-400"}`}><span aria-hidden="true" className="font-black">T</span><span className="min-w-0 truncate">{text.text.trim() || `텍스트 ${index + 1}`}</span></button>
                {selectedExtraText?.id === text.id && <EditorTextOverlayControls
                  textOverlay={text}
                  onChange={(patch, mode) => updateExtraText(text.id, patch, mode)}
                  onFontChange={(fontId) => updateExtraText(text.id, { fontId })}
                  onInteractionStart={beginTextInteraction}
                  onInteractionEnd={finishTextInteraction}
                  onDelete={() => deleteExtraText(text.id)}
                  fontOptions={editorFontOptions}
                  geometryControls={{
                    onScaleChange: (scale) => changeExtraTextScale(text, scale),
                    onWidthChange: (width) => updateExtraText(text.id, { width }, "continuous"),
                    onMoveLayer: (direction) => { finishTextInteraction(); commit((next) => moveTemplateTextLayer(next, text.id, direction, commentLayerEnabled)); },
                    canMoveForward: JSON.stringify(moveTemplateTextLayer(config, text.id, "forward", commentLayerEnabled).layerOrder) !== JSON.stringify(templateDesignLayerOrder(config)),
                    canMoveBackward: JSON.stringify(moveTemplateTextLayer(config, text.id, "backward", commentLayerEnabled).layerOrder) !== JSON.stringify(templateDesignLayerOrder(config)),
                  }}
                />}
              </div>)}</div>}
            </section>}

            {!customTemplateDesignEnabled && <section hidden={activeSidebarTool !== "text"} aria-label="텍스트 설정 안내">
              <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-xs leading-6 text-neutral-400">추가 텍스트 기능은 현재 공개 범위에 포함되지 않습니다. 기존 템플릿 요소는 그대로 유지됩니다.</p>
            </section>}

            {selectedTextLayer && (activeSidebarTool === "title" || activeSidebarTool === "channel") && <section><h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">{selectedLayer === "title" ? "제목 스타일" : "채널명 스타일"}</h2><div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold text-neutral-200">레이어 표시</span><button type="button" onClick={() => commit((next) => { next[selectedLayer as TextLayerId].visible = !selectedTextLayer.visible; return next; })} className={`rounded-full px-3 py-1 text-xs font-bold ${selectedTextLayer.visible ? "bg-emerald-400 text-black" : "bg-white/10 text-neutral-400"}`}>{selectedTextLayer.visible ? "켜짐" : "꺼짐"}</button></div>
              {selectedLayer === "title" && unifiedTitleFontId && <label className="mt-5 block border-t border-white/10 pt-4 text-sm font-semibold text-neutral-200">후킹 제목 폰트
                <select
                  aria-label="후킹 제목 폰트"
                  value={unifiedTitleFontId}
                  onChange={(event) => commit((next) => {
                    if (isTemplateConfigV5(next)) next.title.fontId = event.target.value as EditorFontId;
                    return next;
                  })}
                  className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-[#242429] px-3 text-sm font-extrabold text-white outline-none transition focus:border-[#ff715e]"
                  style={{ fontFamily: editorFontFamily(unifiedTitleFontId) }}
                >
                  {editorFontOptions.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
                </select>
                <span className="mt-2 block text-[11px] font-medium leading-5 text-neutral-500">저장한 폰트가 홈 미리보기와 완성 영상의 후킹 제목에 적용됩니다.</span>
              </label>}
              <label className="mt-5 block border-t border-white/10 pt-4 text-sm font-semibold text-neutral-200">글자 크기 <span className="float-right text-sm text-[#ff9b8d]">{selectedTextLayer.fontSize}px</span><input type="range" min={selectedLayer === "channel" ? 20 : 24} max={selectedLayer === "title" ? 96 : 64} value={selectedTextLayer.fontSize} onChange={(event) => commit((next) => { next[selectedLayer as TextLayerId].fontSize = Number(event.target.value); return next; })} className="mt-3 w-full accent-[#ff715e]" /></label>
              {selectedLayer === "title" ? <>
                <div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-sm font-semibold text-neutral-200">1행 제목</h3><div className="mt-3 grid grid-cols-2 gap-5"><div><p className="text-xs font-semibold text-neutral-400">글자색</p><div className="mt-2"><ColorPalette key="title-line-1-text" value={config.title.primaryColor} onChange={(color) => { if (color) commit((next) => { next.title.primaryColor = color; return next; }); }} /></div></div><div><p className="text-xs font-semibold text-neutral-400">배경색</p><div className="mt-2"><ColorPalette key="title-line-1-background" allowNone value={config.title.primaryBackgroundColor} onChange={(color) => commit((next) => { next.title.primaryBackgroundColor = color; return next; })} /></div></div></div></div>
                <div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-sm font-semibold text-neutral-200">2행 제목</h3><div className="mt-3 grid grid-cols-2 gap-5"><div><p className="text-xs font-semibold text-neutral-400">글자색</p><div className="mt-2"><ColorPalette key="title-line-2-text" value={config.title.accentColor} onChange={(color) => { if (color) commit((next) => { next.title.accentColor = color; return next; }); }} /></div></div><div><p className="text-xs font-semibold text-neutral-400">배경색</p><div className="mt-2"><ColorPalette key="title-line-2-background" allowNone value={config.title.accentBackgroundColor} onChange={(color) => commit((next) => { next.title.accentBackgroundColor = color; return next; })} /></div></div></div></div>
              </> : <div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-sm font-semibold text-neutral-200">채널명</h3>{commentLayerEnabled && <p className="mt-1.5 text-[11px] leading-5 text-neutral-500">댓글 카드 크기가 바뀌어도 채널명은 항상 카드 아래로 자동 정렬됩니다.</p>}<div className="mt-3 grid grid-cols-2 gap-5"><div><p className="text-xs font-semibold text-neutral-400">글자색</p><div className="mt-2"><ColorPalette key="channel-color" value={config.channel.color} onChange={(color) => { if (color) commit((next) => { next.channel.color = color; return next; }); }} /></div></div><div><p className="text-xs font-semibold text-neutral-400">배경색</p><div className="mt-2"><ColorPalette key="channel-background" allowNone value={config.channel.backgroundColor} onChange={(color) => commit((next) => { next.channel.backgroundColor = color; return next; })} /></div></div></div></div>}
            </div></section>}

            {activeSidebarTool === "subtitle" && selectedSubtitle && <section>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">자막 스타일</h2>
                <span className="rounded-full border border-[#35e6e3]/25 bg-[#35e6e3]/10 px-2.5 py-1 text-[10px] font-bold text-[#74efec]">영상에 적용</span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-[#8f8e97]">이 설정은 템플릿 미리보기와 링크로 만든 영상에 동일하게 적용됩니다.</p>
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-200">자막 표시</span>
                  <button
                    type="button"
                    onClick={() => commit((next) => {
                      if (isTemplateConfigV5(next)) next.subtitle.visible = !next.subtitle.visible;
                      return next;
                    })}
                    className={`rounded-full px-3 py-1 text-xs font-bold ${selectedSubtitle.visible ? "bg-emerald-400 text-black" : "bg-white/10 text-neutral-400"}`}
                  >
                    {selectedSubtitle.visible ? "켜짐" : "꺼짐"}
                  </button>
                </div>

                <div className="mt-5 border-t border-white/10 pt-4">
                  <h3 className="text-sm font-semibold text-neutral-200">자막 방식</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {subtitleVariantOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selectedSubtitle.variant === option.value}
                        onClick={() => commit((next) => {
                          if (isTemplateConfigV5(next)) next.subtitle.variant = option.value;
                          return next;
                        })}
                        className={`rounded-xl border px-3 py-3 text-left transition ${selectedSubtitle.variant === option.value ? "border-[#ff715e] bg-[#ff715e]/10 text-white" : "border-white/10 bg-white/[.03] text-neutral-400 hover:border-white/30 hover:text-white"}`}
                      >
                        <strong className="block text-xs">{option.label}</strong>
                        <span className="mt-1 block text-[10px] leading-4 text-neutral-500">{option.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <label className="mt-5 block border-t border-white/10 pt-4 text-sm font-semibold text-neutral-200">폰트
                  <select
                    aria-label="자막 폰트"
                    value={selectedSubtitle.fontId}
                    onChange={(event) => commit((next) => {
                      if (isTemplateConfigV5(next)) next.subtitle.fontId = event.target.value as EditorFontId;
                      return next;
                    })}
                    className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-[#242429] px-3 text-sm font-extrabold text-white outline-none transition focus:border-[#ff715e]"
                    style={{ fontFamily: editorFontFamily(selectedSubtitle.fontId) }}
                  >
                    {editorFontOptions.map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
                  </select>
                </label>

                <label className="mt-5 block border-t border-white/10 pt-4 text-sm font-semibold text-neutral-200">글자 크기 <span className="float-right text-sm text-[#ff9b8d]">{selectedSubtitle.fontSize}px</span>
                  <input
                    type="range"
                    min={24}
                    max={120}
                    value={selectedSubtitle.fontSize}
                    onChange={(event) => commit((next) => {
                      if (isTemplateConfigV5(next)) next.subtitle.fontSize = Number(event.target.value);
                      return next;
                    })}
                    className="mt-3 w-full accent-[#ff715e]"
                  />
                </label>

                <label className="mt-5 block border-t border-white/10 pt-4 text-sm font-semibold text-neutral-200">세로 위치 <span className="float-right text-sm text-[#ff9b8d]">{Math.round((selectedSubtitle.y / TEMPLATE_CANVAS.height) * 100)}%</span>
                  <input
                    type="range"
                    min={120}
                    max={1800}
                    step={10}
                    value={selectedSubtitle.y}
                    onChange={(event) => commit((next) => {
                      if (isTemplateConfigV5(next)) {
                        next.subtitle.x = TEMPLATE_CANVAS.width / 2;
                        next.subtitle.y = Number(event.target.value);
                      }
                      return next;
                    })}
                    className="mt-3 w-full accent-[#ff715e]"
                  />
                </label>
                <p className="mt-2 text-[11px] leading-5 text-neutral-500">가로 위치는 영상 중앙에 고정됩니다. 미리보기의 자막을 위아래로 끌어도 됩니다.</p>

                <div className="mt-5 grid grid-cols-2 gap-5 border-t border-white/10 pt-4">
                  <div><p className="text-xs font-semibold text-neutral-400">기본 글자색</p><div className="mt-2"><ColorPalette key="subtitle-text-color" value={selectedSubtitle.color} onChange={(color) => { if (color) commit((next) => { if (isTemplateConfigV5(next)) next.subtitle.color = color; return next; }); }} /></div></div>
                  <div><p className="text-xs font-semibold text-neutral-400">강조 글자색</p><div className="mt-2"><ColorPalette key="subtitle-accent-color" value={selectedSubtitle.accentColor} rendererOnly onChange={(color) => { if (color && rendererPresetColor(color)) commit((next) => { if (isTemplateConfigV5(next)) next.subtitle.accentColor = color; return next; }); }} /></div></div>
                </div>

                <div className="mt-5 rounded-lg border border-emerald-300/20 bg-emerald-300/[.06] px-3 py-2.5 text-[11px] leading-5 text-emerald-100/75">템플릿을 저장하면 선택한 자막 상태·위치·폰트·크기·색상이 함께 저장됩니다.</div>
              </div>
            </section>}

            {activeSidebarTool === "subtitle" && !selectedSubtitle && <section>
              <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-xs leading-6 text-neutral-400">이 템플릿에는 편집 가능한 자막 레이어가 없습니다.</p>
            </section>}

            {activeSidebarTool === "comment" && selectedLayer === "comment" && commentLayerEnabled && <section>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">댓글 레이아웃</h2>
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">렌더링 적용</span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-[#8f8e97]">예시 문구는 편집용으로 고정되며, 저장한 모드·크기·위치가 실제 댓글에 적용됩니다.</p>
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-200">레이어 표시</span>
                  <button type="button" onClick={() => commit((next) => { next.comment.visible = !next.comment.visible; return next; })} className={`rounded-full px-3 py-1 text-xs font-bold ${config.comment.visible ? "bg-emerald-400 text-black" : "bg-white/10 text-neutral-400"}`}>{config.comment.visible ? "켜짐" : "꺼짐"}</button>
                </div>

                <div className="mt-5 border-t border-white/10 pt-4">
                  <h3 className="text-sm font-semibold text-neutral-200">댓글 모드</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {commentThemeOptions.map((option) => <button key={option.value} type="button" onClick={() => commit((next) => { next.comment.theme = option.value; return next; })} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${config.comment.theme === option.value ? "border-[#ff715e] bg-[#ff715e]/10 text-white" : "border-white/10 bg-white/[.03] text-neutral-400 hover:border-white/30 hover:text-white"}`}><span className="h-5 w-8 border border-white/15" style={{ backgroundColor: option.background }}><span className="mx-auto mt-[8px] block h-px w-4" style={{ backgroundColor: option.foreground }} /></span>{option.label}</button>)}
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-neutral-500">두 모드 모두 가로 여백 없이 캔버스 너비 전체를 채우며 모서리는 각지게 유지합니다.</p>
                </div>

                <div className="mt-5 border-t border-white/10 pt-4">
                  <h3 className="text-sm font-semibold text-neutral-200">댓글 크기</h3>
                  <div className="mt-3 grid grid-cols-3 gap-1.5">{commentSizeOptions.map((option) => <button key={option.value} type="button" onClick={() => commit((next) => { next.comment.size = option.value; return next; })} className={`rounded-lg py-2.5 text-xs font-bold transition ${config.comment.size === option.value ? "bg-white text-black" : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"}`}>{option.label}</button>)}</div>
                  <p className="mt-2 text-[11px] leading-5 text-neutral-500">크기를 바꾸면 프로필·문구·반응 버튼과 안쪽 여백이 함께 줄고, 카드 높이도 내용에 맞춰 자동 조절됩니다.</p>
                </div>

                <label className="mt-5 block border-t border-white/10 pt-4 text-sm font-semibold text-neutral-200">세로 위치 <span className="float-right text-sm text-[#ff9b8d]">{Math.round((commentY / TEMPLATE_CANVAS.height) * 100)}%</span><input type="range" min={COMMENT_Y_MIN} max={COMMENT_Y_MAX} step={10} value={commentY} onChange={(event) => { const vertical = snapCommentYToVideo(Number(event.target.value), videoBottom, 30); commit((next) => { next.comment.y = vertical.value; next.comment.dockedToVideo = vertical.snapped; return next; }); }} className="mt-3 w-full accent-[#ff715e]" /></label>
                <p className={`mt-2 text-[11px] leading-5 ${commentIsDockedToVideo ? "font-semibold text-[#74efec]" : "text-neutral-500"}`}>{commentIsDockedToVideo ? "영상 하단에 자석처럼 붙어 있습니다." : "슬라이더를 쓰거나 댓글 카드를 끌어 영상 하단 가까이 가져가 보세요."}</p>

                <div className="mt-5 rounded-lg border border-emerald-300/20 bg-emerald-300/[.06] px-3 py-2.5 text-[11px] leading-5 text-emerald-100/75">저장하면 댓글 카드와 채널명 배치가 완성 영상에도 같은 설정으로 적용됩니다.</div>
              </div>
            </section>}

            {activeSidebarTool === "comment" && !commentLayerEnabled && <section>
              <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-xs leading-6 text-neutral-400">댓글 설정은 댓글 캡처 템플릿에서 사용할 수 있습니다.</p>
            </section>}

            <section hidden={activeSidebarTool !== "background"}><h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">배경</h2><p className="mt-1.5 text-xs leading-5 text-[#8f8e97]">완성 영상과 같은 9:16 비율로 배경을 비교하세요.</p><div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5">
              {customTemplateDesignEnabled && <div className="mb-6 border-b border-white/10 pb-5"><BackgroundAssetPicker
                value={config.background}
                disabled={saving}
                onBusyChange={setBackgroundBusy}
                onSelect={(background) => commit((next) => ({ ...next, background }))}
                onRestore={() => commit((next) => ({ ...next, background: createDefaultTemplateConfig(baseTemplateId).background }))}
              /></div>}
              <h3 className="text-sm font-semibold text-neutral-200">이미지 배경</h3><div className="mt-3 grid grid-cols-3 gap-2">{stockBackgrounds.map((asset) => <button key={asset.id} type="button" title={asset.label} aria-label={`${asset.label} 배경 선택`} aria-pressed={config.background.kind === "image" && config.background.assetId === asset.id} onClick={() => commit((next) => { next.background = { kind: "image", assetId: asset.id }; return next; })} className={`relative aspect-[9/16] overflow-hidden rounded-lg border transition ${config.background.kind === "image" && config.background.assetId === asset.id ? "border-[#ff715e] ring-2 ring-[#ff715e]/25" : "border-white/10 hover:border-white/35"}`}><span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${asset.src})` }} /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-black/20 px-1 py-1.5 text-[9px] font-bold leading-3 text-white">{asset.label}</span></button>)}</div>
              <div className="mt-6 border-t border-white/10 pt-5"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-neutral-200">단색 배경</h3><button type="button" aria-expanded={showAllBackgroundColors} onClick={() => setShowAllBackgroundColors((current) => !current)} className="text-[11px] font-bold text-[#ff9b8d] transition hover:text-white">{showAllBackgroundColors ? "접기" : "전체 보기"}</button></div><div className="mt-3 grid grid-cols-3 gap-2">{visibleBackgroundColors.map((option) => <button key={option.color} type="button" title={option.name} aria-label={`${option.name} 단색 배경 선택`} aria-pressed={selectedBackgroundColor === option.color} onClick={() => commit((next) => { next.background = { kind: "color", color: option.color }; return next; })} className={`relative aspect-[9/16] overflow-hidden rounded-lg border transition ${selectedBackgroundColor === option.color ? "border-[#ff715e] ring-2 ring-[#ff715e]/25" : "border-white/10 hover:border-white/35"}`} style={{ backgroundColor: option.color }}><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-black/20 px-1 py-1.5 text-[9px] font-bold leading-3 text-white">{option.name}</span></button>)}</div></div>
            </div></section>
          </fieldset>
          <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#19191c]/95 p-5 backdrop-blur-xl"><button type="button" disabled={saving || backgroundBusy || !dirty} onClick={() => void save()} className="h-12 w-full rounded-xl bg-[#ff715e] text-sm font-black text-white transition hover:bg-[#ff8a78] disabled:bg-neutral-700 disabled:text-neutral-400">{backgroundBusy ? "배경 이미지 확인 중…" : saving ? "저장 중..." : savedTemplate ? "템플릿 저장" : "내 템플릿으로 저장"}</button>{message && <p className="mt-2 text-center text-[11px] leading-4 text-neutral-400">{message}</p>}</div>
          </div>
        </aside>
      </div>
      <div className="grid min-h-dvh place-items-center px-6 text-center lg:hidden"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#ff715e]/10 text-2xl">▣</div><h1 className="mt-5 text-lg font-black">템플릿 편집은 데스크톱에서 이용해 주세요</h1><p className="mt-2 text-sm leading-6 text-neutral-500">1024px 이상의 화면에서 위치 이동과 크기 조절을 정확하게 사용할 수 있습니다.</p><Link href="/templates" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-black">템플릿 라이브러리로</Link></div></div>
    </div>
  );
}
