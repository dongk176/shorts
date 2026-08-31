import { CustomTemplateTitlePreview } from "@/components/custom-template-title-preview";
import { TemplateTitleV4Preview } from "@/components/template-title-v4-preview";
import { TemplateSubtitlePreview } from "@/components/template-subtitle-preview";
import { TemplateCommentPreview } from "@/components/template-comment-prototype";
import { EditorTextOverlayPaint } from "@/components/editor-text-overlay-paint";
import {
  customCanvasWidth,
  customCenteredLayerStyle,
  customCommentLayerY,
  customVideoFrameStyle,
} from "@/lib/custom-template-preview-layout";
import { editorFontFamily, resolveEditorFontFace } from "@/lib/editor-fonts";
import { isTemplateConfigV5, TEMPLATE_CANVAS, type CustomTemplate } from "@/lib/template-config";
import {
  hasTemplateDesignLayerOrder,
  templateBackgroundStyle,
  templateDesignLayerZIndex,
  templateTextRenderSpec,
} from "@/lib/template-design-preview";

function PreviewChannel({
  template,
  label,
  inCommentFlow = false,
  commentY = 0,
}: {
  template: CustomTemplate;
  label: string;
  inCommentFlow?: boolean;
  commentY?: number;
}) {
  const channel = template.config.channel;
  if (!channel.visible) return null;
  const positionedBelow = inCommentFlow && template.config.schemaVersion >= 4;
  const flowStyle = positionedBelow
    ? {
        left: "50%",
        top: customCanvasWidth(channel.y - commentY),
        transform: "translate(-50%, -50%)",
        width: customCanvasWidth(channel.maxWidth),
      }
    : inCommentFlow
      ? { width: customCanvasWidth(channel.maxWidth) }
    : customCenteredLayerStyle(channel);
  return (
    <div
      className={`${positionedBelow ? "absolute" : inCommentFlow ? "relative mx-auto mt-[2cqw] block" : "absolute"} z-30 truncate rounded px-[1.5cqw] py-[.7cqw] text-center font-bold`}
      style={{ ...flowStyle, color: channel.color, backgroundColor: channel.backgroundColor || "transparent", fontSize: customCanvasWidth(channel.fontSize), zIndex: templateDesignLayerZIndex(template.config, "channel") }}
    >
      ● {label}
    </div>
  );
}

export function CustomTemplateCanvasPreview({
  template,
  firstLine,
  secondLine,
  channelLabel,
  showUnifiedSubtitle = false,
  positionedWordsV4Enabled = false,
  titleV4Enabled = positionedWordsV4Enabled,
}: {
  template: CustomTemplate;
  firstLine: string;
  secondLine: string;
  channelLabel: string;
  showUnifiedSubtitle?: boolean;
  positionedWordsV4Enabled?: boolean;
  titleV4Enabled?: boolean;
}) {
  const config = template.config;
  const unifiedConfig = showUnifiedSubtitle && isTemplateConfigV5(config)
    ? config
    : null;
  const commentLayerEnabled = template.baseTemplateId === "comment-capture";
  const commentY = customCommentLayerY(config);
  const hasDesignOrder = hasTemplateDesignLayerOrder(config);
  return (
    <div
      className="relative mx-auto aspect-[9/16] w-full max-w-[164px] overflow-hidden rounded-lg"
      style={{ ...templateBackgroundStyle(config.background), containerType: "inline-size" }}
      aria-label={`${template.name} 쇼츠 미리보기`}
    >
      <div className="absolute bg-neutral-700" style={{ ...customVideoFrameStyle(config.video), zIndex: templateDesignLayerZIndex(config, "video") }}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
      </div>
      {titleV4Enabled
        ? <TemplateTitleV4Preview
            enabled
            templateId={template.baseTemplateId}
            title={`${firstLine}\n${secondLine}`}
            templateConfig={config}
            primaryColor={config.title.primaryColor}
            accentColor={config.title.accentColor}
            zIndex={templateDesignLayerZIndex(config, "title")}
          />
        : <CustomTemplateTitlePreview
            title={config.title}
            firstLine={firstLine}
            secondLine={secondLine}
            fontFamily={unifiedConfig ? editorFontFamily(unifiedConfig.title.fontId) : undefined}
            fontWeight={unifiedConfig ? resolveEditorFontFace(unifiedConfig.title.fontId, "title").resolvedWeight : undefined}
            movementStyle={{ zIndex: templateDesignLayerZIndex(config, "title") }}
          />}
      {unifiedConfig
        ? <TemplateSubtitlePreview
            subtitle={unifiedConfig.subtitle}
            positionedWordsV4Enabled={positionedWordsV4Enabled}
          />
        : null}
      {commentLayerEnabled
        ? <div className={`absolute inset-x-0 ${hasDesignOrder ? "" : "z-40"}`} style={{ top: `${(commentY / TEMPLATE_CANVAS.height) * 100}%` }}>
            {config.comment.visible && <div style={hasDesignOrder ? { position: "relative", zIndex: templateDesignLayerZIndex(config, "comment") } : undefined}><TemplateCommentPreview theme={config.comment.theme} size={config.comment.size} /></div>}
            <PreviewChannel template={template} label={channelLabel} inCommentFlow commentY={commentY} />
          </div>
        : <PreviewChannel template={template} label={channelLabel} />}
      {(config.textOverlays || []).map((text) => <EditorTextOverlayPaint
        key={text.id}
        textOverlay={text}
        renderSpec={templateTextRenderSpec(text)}
        zIndex={templateDesignLayerZIndex(config, `text:${text.id}`)}
      />)}
    </div>
  );
}
